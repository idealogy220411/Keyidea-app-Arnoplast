import { describe, expect, it } from 'vitest';
import { attachImages, type AttachedLanguage } from '../src/associate';
import type { ConverterConfig } from '../src/config';
import { extractLanguage } from '../src/extract';
import { readIdml } from '../src/idml/read';
import type { Issue, StoryItem } from '../src/types';
import { buildIdml, type TestFrame, type TestPage } from './helpers/build-idml';

const config: ConverterConfig = {
  languages: ['it', 'en'],
  lines: {
    agricoltura: { name: { it: 'Agricoltura', en: 'Agriculture' } },
    garden: { name: { it: 'Garden', en: 'Garden' } },
    olive: { name: { it: 'Raccolta olive', en: 'Olive harvesting' } },
  },
  categories: {
    agricoltura: [
      { id: 'copripalo', name: { it: 'COPRIPALO', en: 'POST CAPS' } },
      { id: 'placchette', name: { it: 'PLACCHETTE', en: 'PLATES' } },
    ],
    garden: [],
    olive: [],
  },
  styles: {
    product: 'TITOLO',
    entry: 'CARATTERTISTICHE',
    featuresHeading: { it: 'CARATTERISTICHE', en: 'FEATURES' },
    dimensionsHeading: { it: 'DIMENSIONI', en: 'DIMENSIONS' },
    optionalFixingHeading: { it: 'OPTIONAL DI FISSAGGIO', en: 'FIXING OPTIONS' },
  },
  articleColumns: ['code', 'description', 'perPack', 'perBox', 'perPallet'],
  optionalPattern: '\\(optional\\)',
  drawingExtensions: ['.ai', '.pdf', '.eps', '.svg'],
  qrFilenamePattern: 'qr',
};

/** Etichetta di categoria o bollino materiale: senza stile di carattere, riconosciuti dal solo contenuto. */
const category = (text: string): StoryItem => ({ kind: 'paragraph', style: '', text });
const material = (text: string): StoryItem => ({ kind: 'paragraph', style: '', text });
const product = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.product, text });

/** URI di un collegamento, come lo scrive InDesign. */
const uri = (name: string): string => `file:/Users/grafico/Lavori/Links/${name}`;

/** Frame di testo con i paragrafi indicati; `x`/`y` sono il suo angolo in alto a sinistra. */
const titles = (x: number, y: number, ...items: StoryItem[]): TestFrame => ({
  kind: 'text',
  x,
  y,
  w: 300,
  h: 100,
  items,
});

/** Frame immagine; per i collegamenti con spazi o accenti si passa il nome già codificato. */
const image = (name: string, x: number, y: number, w = 200, h = 100): TestFrame => ({
  kind: 'image',
  link: uri(name),
  x,
  y,
  w,
  h,
});

type SpreadSpec = { frames: TestFrame[]; pages?: TestPage[] };

/** Due pagine affiancate, ciascuna larga 600 e alta 800. */
const FACING: TestPage[] = [
  { x: 0, y: 0, w: 600, h: 800 },
  { x: 600, y: 0, w: 600, h: 800 },
];

async function attach(spreads: SpreadSpec[]): Promise<AttachedLanguage> {
  const doc = await readIdml(await buildIdml({ spreads }));
  return attachImages(doc, extractLanguage(doc, config, 'it', 'agricoltura'), config);
}

describe('attachImages', () => {
  it('assigns images to the nearest product title above', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 100, category('COPRIPALO'), product('COPRIPALO PRISMA'), material('PP')),
          titles(0, 500, product('COPRIPALO QUBO'), material('PP')),
          image('prisma.jpg', 400, 150),
          image('qubo.jpg', 400, 600),
        ],
      },
    ]);

    expect(result.products.map((p) => p.imageLinks)).toEqual([[uri('prisma.jpg')], [uri('qubo.jpg')]]);
    expect(result.issues).toEqual([]);
  });

  it('assigns an image above the first title to the first product of its page', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 300, category('COPRIPALO'), product('COPRIPALO PRISMA'), material('PP')),
          titles(0, 600, product('COPRIPALO QUBO'), material('PP')),
          image('testata.jpg', 400, 50),
        ],
      },
    ]);

    expect(result.products.map((p) => p.imageLinks)).toEqual([[uri('testata.jpg')], []]);
  });

  it('separates drawings by extension', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          image('esploso.ai', 400, 0),
          image('foto.jpg', 400, 200),
        ],
      },
    ]);

    expect(result.products[0].drawingLinks).toEqual([uri('esploso.ai')]);
    expect(result.products[0].imageLinks).toEqual([uri('foto.jpg')]);
  });

  it('matches drawing extensions case-insensitively on the decoded file name', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          image('tavola%20tecnica.PDF', 400, 0),
          image('senza-estensione', 400, 200),
        ],
      },
    ]);

    expect(result.products[0].drawingLinks).toEqual([uri('tavola%20tecnica.PDF')]);
    expect(result.products[0].imageLinks).toEqual([uri('senza-estensione')]);
  });

  it('keeps reading order within a product', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          image('c.jpg', 700, 400),
          image('a.jpg', 300, 100),
          image('b.jpg', 600, 100),
          image('d.jpg', 300, 400),
        ],
      },
    ]);

    expect(result.products[0].imageLinks).toEqual([uri('a.jpg'), uri('b.jpg'), uri('d.jpg'), uri('c.jpg')]);
  });

  it('uses opener photo for category', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 0, category('COPRIPALO')),
          image('piccola.jpg', 0, 400, 100, 100),
          image('grande.jpg', 300, 300, 400, 300),
        ],
      },
    ]);

    expect(result.categories.map((c) => c.imageLink)).toEqual([uri('grande.jpg')]);
    expect(result.issues).toEqual([]);
  });

  it('leaves the category image empty when its page has a product', async () => {
    const result = await attach([
      {
        frames: [titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')), image('foto.jpg', 400, 200)],
      },
    ]);

    expect(result.categories[0].imageLink).toBeNull();
    expect(result.products[0].imageLinks).toEqual([uri('foto.jpg')]);
  });

  it('carries images to previous product on continuation spread', async () => {
    const result = await attach([
      {
        frames: [
          titles(0, 100, category('COPRIPALO'), product('COPRIPALO PRISMA'), material('PP')),
          titles(0, 500, product('COPRIPALO QUBO'), material('PP')),
          image('qubo-1.jpg', 400, 600),
        ],
      },
      { frames: [image('qubo-3.jpg', 100, 300), image('qubo-2.jpg', 100, 50)] },
    ]);

    expect(result.products[0].imageLinks).toEqual([]);
    expect(result.products[1].imageLinks).toEqual([uri('qubo-1.jpg'), uri('qubo-2.jpg'), uri('qubo-3.jpg')]);
  });

  it('carries images across several continuation spreads', async () => {
    const result = await attach([
      { frames: [titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA'))] },
      { frames: [] },
      { frames: [image('prisma-3.jpg', 100, 100)] },
    ]);

    expect(result.products[0].imageLinks).toEqual([uri('prisma-3.jpg')]);
  });

  it('drops images before the first product with a warning', async () => {
    const result = await attach([
      { frames: [image('orfana.jpg', 100, 100)] },
      { frames: [titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA'))] },
    ]);

    expect(result.products[0].imageLinks).toEqual([]);
    expect(result.issues).toEqual([
      { level: 'warning', message: expect.stringContaining('orfana.jpg'), where: 'spread 1' },
    ]);
  });

  it('assigns images per page on facing pages', async () => {
    const result = await attach([
      {
        pages: FACING,
        frames: [
          titles(50, 100, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          titles(650, 100, product('COPRIPALO QUBO')),
          image('foto-qubo.jpg', 650, 300),
          image('foto-prisma.jpg', 50, 300),
        ],
      },
    ]);

    expect(result.products.map((p) => p.imageLinks)).toEqual([[uri('foto-prisma.jpg')], [uri('foto-qubo.jpg')]]);
  });

  it('uses opener photo when the product is on the facing page', async () => {
    const result = await attach([
      {
        pages: FACING,
        frames: [
          titles(50, 100, category('COPRIPALO')),
          titles(650, 100, product('COPRIPALO PRISMA')),
          image('apertura.jpg', 50, 300, 400, 300),
          image('prisma.jpg', 650, 300),
        ],
      },
    ]);

    expect(result.categories[0].imageLink).toBe(uri('apertura.jpg'));
    expect(result.products[0].imageLinks).toEqual([uri('prisma.jpg')]);
    expect(result.issues).toEqual([]);
  });

  it('reads a product across facing pages in page order', async () => {
    const result = await attach([
      {
        pages: FACING,
        frames: [
          titles(50, 100, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          image('destra.jpg', 650, 50),
          image('sinistra.jpg', 50, 400),
        ],
      },
    ]);

    expect(result.products[0].imageLinks).toEqual([uri('sinistra.jpg'), uri('destra.jpg')]);
  });

  it('uses the nearest page for frames outside every page', async () => {
    const result = await attach([
      {
        pages: FACING,
        frames: [
          titles(50, 100, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          titles(650, 100, product('COPRIPALO QUBO')),
          image('fuori-destra.jpg', 1300, 300),
          image('fuori-sinistra.jpg', -400, 300),
        ],
      },
    ]);

    expect(result.products.map((p) => p.imageLinks)).toEqual([[uri('fuori-sinistra.jpg')], [uri('fuori-destra.jpg')]]);
  });

  it('uses the nearest page for a title outside every page', async () => {
    const result = await attach([
      {
        pages: FACING,
        frames: [
          titles(50, 100, category('COPRIPALO'), product('COPRIPALO PRISMA')),
          titles(1250, 100, product('COPRIPALO QUBO')),
          image('foto-qubo.jpg', 650, 300),
        ],
      },
    ]);

    expect(result.products.map((p) => p.imageLinks)).toEqual([[], [uri('foto-qubo.jpg')]]);
  });

  it('does not carry images across a new category opener', async () => {
    const result = await attach([
      { frames: [titles(0, 100, category('COPRIPALO'), product('COPRIPALO PRISMA'))] },
      { frames: [titles(0, 100, category('PLACCHETTE')), image('apertura.jpg', 100, 300, 400, 300)] },
      { frames: [image('orfana.jpg', 100, 300)] },
    ]);

    expect(result.categories.map((c) => c.imageLink)).toEqual([null, uri('apertura.jpg')]);
    expect(result.products[0].imageLinks).toEqual([]);
    expect(result.issues).toEqual([
      { level: 'warning', message: expect.stringContaining('orfana.jpg'), where: 'spread 3' },
    ]);
  });

  it('keeps the extraction data and does not modify it', async () => {
    const doc = await readIdml(
      await buildIdml({
        spreads: [{ frames: [titles(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')), image('foto.jpg', 400, 0)] }],
      }),
    );
    const extracted = extractLanguage(doc, config, 'it', 'agricoltura');
    const issue: Issue = { level: 'warning', message: 'avviso di estrazione', where: 'spread 1' };

    const result = attachImages(doc, { ...extracted, issues: [issue] }, config);

    expect(result.lang).toBe('it');
    expect(result.issues).toEqual([issue]);
    expect(result.products[0]).toMatchObject({ name: 'COPRIPALO PRISMA', anchor: extracted.products[0].anchor });
    expect(result.categories[0]).toMatchObject({ name: 'COPRIPALO', order: 0 });
    expect(extracted.products[0]).not.toHaveProperty('imageLinks');
    expect(extracted.categories[0]).not.toHaveProperty('imageLink');
  });
});
