import { describe, expect, it } from 'vitest';
import type { ConverterConfig } from '../src/config';
import { extractLanguage, type LanguageExtract } from '../src/extract';
import { readIdml } from '../src/idml/read';
import type { StoryItem } from '../src/types';
import { buildIdml, buildRawIdml, type TestFrame } from './helpers/build-idml';

const config: ConverterConfig = {
  languages: ['it', 'en'],
  lines: {
    agricoltura: { name: { it: 'Agricoltura', en: 'Agriculture' } },
    garden: { name: { it: 'Garden', en: 'Garden' } },
    olive: { name: { it: 'Raccolta olive', en: 'Olive harvesting' } },
  },
  styles: {
    category: 'Titolo categoria',
    product: 'Titolo prodotto',
    feature: 'Caratteristiche',
    dimension: 'Dimensioni',
    material: 'Bollino materiale',
  },
  articleColumns: ['code', 'description', 'perPack', 'perBox', 'perPallet'],
  optionalPattern: '\\(optional\\)',
  drawingExtensions: ['.ai', '.pdf', '.eps', '.svg'],
};

const category = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.category, text });
const product = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.product, text });
const feature = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.feature, text });
const dimension = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.dimension, text });
const material = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.material, text });
const table = (...rows: string[][]): StoryItem => ({ kind: 'table', rows });

const HEADER = ['COD.', 'DESCRIZIONE', 'CONF.', 'IMB.', 'PALLET'];

function frame(x: number, y: number, ...items: StoryItem[]): TestFrame {
  return { kind: 'text', x, y, w: 300, h: 100, items };
}

/** Estrae la lingua dagli spread indicati (un elenco di frame per spread). */
async function extract(
  spreads: TestFrame[][],
  changes: Partial<ConverterConfig> = {},
  lang = 'it',
): Promise<LanguageExtract> {
  const doc = await readIdml(await buildIdml({ spreads: spreads.map((frames) => ({ frames })) }));
  return extractLanguage(doc, { ...config, ...changes }, lang);
}

/** Un solo prodotto con la categoria, il titolo e gli elementi indicati. */
function oneProduct(...items: StoryItem[]): TestFrame[][] {
  return [[frame(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA'), ...items)]];
}

describe('extractLanguage', () => {
  it('extracts category and product hierarchy', async () => {
    const result = await extract([
      [
        frame(
          0,
          0,
          category('COPRIPALO'),
          product('COPRIPALO PRISMA'),
          { kind: 'paragraph', style: 'Testo corrente', text: 'testo che non interessa' },
          product('COPRIPALO QUBO'),
        ),
      ],
    ]);
    expect(result.lang).toBe('it');
    expect(result.categories).toEqual([{ name: 'COPRIPALO', order: 0, anchor: { spreadIndex: 0, x: 0, y: 0 } }]);
    expect(result.products.map((p) => p.name)).toEqual(['COPRIPALO PRISMA', 'COPRIPALO QUBO']);
    expect(result.products.map((p) => p.categoryOrder)).toEqual([0, 0]);
    expect(result.issues).toEqual([]);
  });

  it('numbers categories in reading order', async () => {
    const result = await extract([
      [frame(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA'))],
      [frame(0, 0, category('PLACCHETTE'), product('PLACCHETTA ROMA'))],
    ]);
    expect(result.categories.map((c) => [c.name, c.order])).toEqual([
      ['COPRIPALO', 0],
      ['PLACCHETTE', 1],
    ]);
    expect(result.products.map((p) => p.categoryOrder)).toEqual([0, 1]);
  });

  it('extracts features and dimensions without bullets', async () => {
    const result = await extract(
      oneProduct(
        feature('• viteria certificata 8.8'),
        feature('  ▪   coperchio  in PP  '),
        feature('- resistente a -30°C'),
        feature('resistente ai raggi UV'),
        feature('-30°C / +60°C'),
        dimension('• 7x7 cm'),
        dimension('- altezza   120 cm'),
      ),
    );
    expect(result.products[0].features).toEqual([
      'viteria certificata 8.8',
      'coperchio in PP',
      'resistente a -30°C',
      'resistente ai raggi UV',
      '-30°C / +60°C',
    ]);
    expect(result.products[0].dimensions).toEqual(['7x7 cm', 'altezza 120 cm']);
    expect(result.issues).toEqual([]);
  });

  it('parses article table by position', async () => {
    const rows = [
      ['1807-1351', 'Coprip Prisma 7x7 (senza viteria)', '40', '40', '640'],
      ...Array.from({ length: 11 }, (_, i) => [`1807-${1352 + i}`, `Coprip Prisma ${i + 2}`, '40', '40', '640']),
    ];
    const result = await extract(oneProduct(table(HEADER, rows[0], ['', '', '', '', ''], ...rows.slice(1))));
    const articles = result.products[0].articles;
    expect(articles).toHaveLength(12);
    expect(articles[0]).toEqual({
      code: '1807-1351',
      description: 'Coprip Prisma 7x7 (senza viteria)',
      perPack: 40,
      perBox: 40,
      perPallet: 640,
    });
    expect(articles.map((a) => a.code)).toEqual(rows.map((row) => row[0]));
    expect(result.issues).toEqual([]);
  });

  it('reads the columns in the order set by the configuration', async () => {
    const result = await extract(
      oneProduct(table(['DESCRIZIONE', 'PALLET', 'ALTRO', 'COD.', 'CONF.'], ['Coprip Prisma 7x7', '640', 'x', '1807-1351', '40'])),
      { articleColumns: ['description', 'perPallet', 'ignore', 'code', 'perPack'] },
    );
    expect(result.products[0].articles).toEqual([
      { code: '1807-1351', description: 'Coprip Prisma 7x7', perPack: 40, perBox: null, perPallet: 640 },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('parses dash, empty and non-numeric cells', async () => {
    const result = await extract(
      oneProduct(
        table(
          HEADER,
          ['1807-1357', 'Viteria per Cp (4pz.)', '40', '200', '-'],
          ['1807-1358', 'Vite M6', '', '–', '640'],
          ['1807-1359', 'Rondella', '40', 'n.d.', '640'],
        ),
      ),
    );
    const [viteria, vite, rondella] = result.products[0].articles;
    expect(viteria).toMatchObject({ perPack: 40, perBox: 200, perPallet: null });
    expect(vite).toMatchObject({ perPack: null, perBox: null, perPallet: 640 });
    expect(rondella).toMatchObject({ perPack: 40, perBox: null, perPallet: 640 });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'spread 1' });
    expect(result.issues[0].message).toContain('n.d.');
    expect(result.issues[0].message).toContain('1807-1359');
  });

  it('removes thousands dots and rejects decimals', async () => {
    const result = await extract(
      oneProduct(table(HEADER, ['1807-1360', 'Pallet grande', '1.024', '12.345.678', '1.5'])),
    );
    expect(result.products[0].articles[0]).toMatchObject({ perPack: 1024, perBox: 12345678, perPallet: null });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].message).toContain('1.5');
  });

  it('maps zero quantities to null with a warning', async () => {
    const result = await extract(oneProduct(table(HEADER, ['1807-1361', 'Cappuccio', '0', '40', '640'])));
    expect(result.products[0].articles[0]).toMatchObject({ perPack: null, perBox: 40, perPallet: 640 });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'spread 1' });
    expect(result.issues[0].message).toContain('1807-1361');
  });

  it('warns on rows whose first cell is neither a code nor a known heading', async () => {
    const result = await extract(
      oneProduct(
        table(
          ['COD.', 'DESCRIZIONE', 'CONF.', 'IMB.', 'PALLET'],
          ['CODE', 'DESCRIPTION', 'PACK', 'BOX', 'PALLET'],
          ['CÓDIGO', 'DESCRIPCIÓN', 'ENV.', 'CAJA', 'PALÉ'],
          ['codice', 'Descrizione', '', '', ''],
          ['', '', '', '', ''],
          ['1807-1351', 'Coprip Prisma 7x7', '40', '40', '640'],
          ['TOTALE', '', '', '', ''],
          ['1807-135', 'Codice troppo corto', '40', '40', '640'],
        ),
      ),
    );
    expect(result.products[0].articles.map((a) => a.code)).toEqual(['1807-1351']);
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((i) => i.level)).toEqual(['warning', 'warning']);
    expect(result.issues[0].message).toContain('TOTALE');
    expect(result.issues[1].message).toContain('1807-135');
  });

  it('accepts codes with letter suffixes', async () => {
    const result = await extract(
      oneProduct(table(HEADER, ['1807-1310GZ', 'Zincato', '10', '10', '100'], ['1807-0308GR', 'Grigio', '10', '10', '100'])),
    );
    expect(result.products[0].articles.map((a) => a.code)).toEqual(['1807-1310GZ', '1807-0308GR']);
    expect(result.issues).toEqual([]);
  });

  it('marks optional codes', async () => {
    const result = await extract(
      oneProduct(
        table(
          HEADER,
          ['2008-0015', 'Dado M6', '10', '10', '100'],
          ['2008-0016', 'Dado a griffe M6 (optional)', '10', '10', '100'],
          ['2008-0017', 'Dado a griffe M8 (OPTIONAL)', '10', '10', '100'],
        ),
      ),
    );
    expect(result.products[0].optionalCodes).toEqual(['2008-0016', '2008-0017']);
    expect(result.products[0].articles).toHaveLength(3);
  });

  it('uses the configured optional pattern', async () => {
    const result = await extract(
      oneProduct(table(HEADER, ['2008-0016', 'Dado a griffe M6 (a richiesta)', '10', '10', '100'])),
      { optionalPattern: 'a richiesta' },
    );
    expect(result.products[0].optionalCodes).toEqual(['2008-0016']);
  });

  it('reads material badges', async () => {
    const result = await extract(oneProduct(material('PP'), material(' PET '), material('PP')));
    expect(result.products[0].materials).toEqual(['PP', 'PET']);
    expect(result.issues).toEqual([]);
  });

  it('warns on unknown material', async () => {
    const result = await extract(oneProduct(material('ABS')));
    expect(result.products[0].materials).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'spread 1' });
    expect(result.issues[0].message).toContain('ABS');
  });

  it('replaces the materials read with the overrides', async () => {
    const spreads = [
      [
        frame(
          0,
          0,
          category('COPRIPALO'),
          product('COPRIPALO PRISMA'),
          material('PE'),
          product('COPRIPALO QUBO'),
          material('PET'),
        ),
      ],
    ];
    const result = await extract(spreads, { overrides: { materials: { 'COPRIPALO PRISMA': ['PP', 'FE'] } } });
    expect(result.products.map((p) => p.materials)).toEqual([['PP', 'FE'], ['PET']]);
  });

  it('warns on content outside a product', async () => {
    const result = await extract([
      [frame(0, 0, category('COPRIPALO'))],
      [
        frame(
          0,
          0,
          feature('• viteria certificata 8.8'),
          dimension('7x7 cm'),
          table(HEADER, ['1807-1351', 'Coprip Prisma 7x7', '40', '40', '640']),
          material('PP'),
        ),
        frame(0, 300, product('COPRIPALO PRISMA')),
      ],
    ]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ features: [], dimensions: [], articles: [], materials: [] });
    expect(result.issues).toHaveLength(4);
    expect(result.issues.map((i) => i.level)).toEqual(['warning', 'warning', 'warning', 'warning']);
    expect(result.issues.map((i) => i.where)).toEqual(['spread 2', 'spread 2', 'spread 2', 'spread 2']);
  });

  it('does not attach content after a new category to the previous product', async () => {
    const result = await extract([
      [
        frame(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')),
        frame(0, 200, category('PLACCHETTE'), feature('testo prima del prodotto')),
      ],
    ]);
    expect(result.products[0].features).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].where).toBe('spread 1');
  });

  it('reports a product before any category as an error', async () => {
    const result = await extract([[frame(0, 0, product('COPRIPALO PRISMA'), feature('viteria'))]]);
    expect(result.categories).toEqual([]);
    expect(result.products).toEqual([]);
    expect(result.issues[0]).toMatchObject({ level: 'error', where: 'spread 1' });
    expect(result.issues[0].message).toContain('COPRIPALO PRISMA');
  });

  it('orders products by spread then position', async () => {
    const result = await extract([
      [
        frame(0, 400, product('PRODOTTO BASSO A SINISTRA')),
        frame(600, 100, product('PRODOTTO ALTO A DESTRA')),
        frame(0, 0, category('COPRIPALO')),
      ],
      [frame(0, 0, product('PRODOTTO DEL SECONDO SPREAD'))],
    ]);
    expect(result.products.map((p) => p.name)).toEqual([
      'PRODOTTO ALTO A DESTRA',
      'PRODOTTO BASSO A SINISTRA',
      'PRODOTTO DEL SECONDO SPREAD',
    ]);
  });

  it('reads frames with the same height from left to right', async () => {
    const result = await extract([
      [
        frame(600, 100, product('PRODOTTO A DESTRA')),
        frame(0, 100, product('PRODOTTO A SINISTRA')),
        frame(0, 0, category('COPRIPALO')),
      ],
    ]);
    expect(result.products.map((p) => p.name)).toEqual(['PRODOTTO A SINISTRA', 'PRODOTTO A DESTRA']);
  });

  it('anchors titles on the frame that holds them', async () => {
    const result = await extract([
      [frame(0, 0, category('COPRIPALO'))],
      [frame(40, 70, product('COPRIPALO PRISMA')), frame(640, 90, product('COPRIPALO QUBO'))],
    ]);
    expect(result.categories[0].anchor).toEqual({ spreadIndex: 0, x: 0, y: 0 });
    expect(result.products.map((p) => p.anchor)).toEqual([
      { spreadIndex: 1, x: 40, y: 70 },
      { spreadIndex: 1, x: 640, y: 90 },
    ]);
  });

  it('reads a threaded story once, anchored on its first frame', async () => {
    const style = (name: string, text: string): string =>
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${name}"><CharacterStyleRange><Content>${text}</Content><Br/></CharacterStyleRange></ParagraphStyleRange>`;
    const path = (x0: number, y0: number, x1: number, y1: number): string => {
      const anchors = [
        [x0, y0],
        [x0, y1],
        [x1, y1],
        [x1, y0],
      ]
        .map(([x, y]) => `<PathPointType Anchor="${x} ${y}"/>`)
        .join('');
      return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${anchors}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
    };
    const file = await buildRawIdml({
      stories: {
        s1: style('Titolo categoria', 'COPRIPALO') + style('Titolo prodotto', 'COPRIPALO PRISMA') + style('Caratteristiche', 'viteria'),
      },
      spreads: [
        // f2 è il secondo anello del filo, ma ha la `y` minore: nell'ordine di lettura viene per primo
        `<TextFrame Self="f2" ParentStory="s1" PreviousTextFrame="f1" ItemTransform="1 0 0 1 200 10">${path(0, 0, 100, 50)}</TextFrame>` +
          `<TextFrame Self="f1" ParentStory="s1" NextTextFrame="f2" ItemTransform="1 0 0 1 30 20">${path(0, 0, 100, 50)}</TextFrame>`,
      ],
    });
    const result = extractLanguage(await readIdml(file), config, 'it');
    expect(result.products).toHaveLength(1);
    expect(result.products[0].features).toEqual(['viteria']);
    expect(result.products[0].anchor).toEqual({ spreadIndex: 0, x: 200, y: 10 });
    expect(result.categories[0].anchor).toEqual({ spreadIndex: 0, x: 200, y: 10 });
  });
});
