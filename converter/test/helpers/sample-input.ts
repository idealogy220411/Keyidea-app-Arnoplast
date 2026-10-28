import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import sharp from 'sharp';
import type { StoryItem } from '../../src/types';
import { buildIdml, type TestFrame } from './build-idml';

const PDF_FIXTURE = fileURLToPath(new URL('../fixtures/disegno.pdf', import.meta.url));

/** Indirizzo del video codificato nel QR di prova. */
export const SAMPLE_VIDEO_URL = 'https://youtu.be/abc123';

export type SampleInputOptions = {
  /** Nomi di collegamenti in più, aggiunti come foto del prodotto nell'IDML di ogni lingua (i file non vengono creati). */
  extraLinks?: string[];
  /** File in più (nome → contenuto), scritti nella cartella `Links` di ogni lingua. */
  extraFiles?: Record<string, Buffer | string>;
};

/** Testi di una lingua del catalogo di prova. */
type SampleTexts = {
  category: string;
  product: string;
  head: string[];
  features: string[];
  dimensions: string[];
  descriptions: string[];
};

// Nomi degli stili di `converter/catalogo.config.yaml`: come nel file reale, un solo stile di carattere
// per i titoli (che apre anche le intestazioni di caratteristiche/dimensioni) e uno per le righe sotto;
// la categoria e il materiale non hanno stile (si riconoscono dal contenuto).
const STYLES = {
  product: 'TITOLO',
  entry: 'CARATTERTISTICHE',
} as const;
const FEATURES_HEADING = { it: 'CARATTERISTICHE', en: 'FEATURES' } as const;
const DIMENSIONS_HEADING = { it: 'DIMENSIONI', en: 'DIMENSIONS' } as const;

const TEXTS: Record<'it' | 'en', SampleTexts> = {
  it: {
    category: 'COPRIPALO',
    product: 'COPRIPALO PRISMA',
    head: ['COD.', 'DESCRIZIONE', 'PZ/CONF', 'PZ/SCATOLA', 'PZ/PALLET'],
    features: ['• viteria certificata 8.8'],
    dimensions: ['• dimensioni: 215x115x120 mm'],
    descriptions: ['Copripalo Prisma 7x7 cm', 'Copripalo Prisma 8x8 cm'],
  },
  en: {
    category: 'POST CAPS',
    product: 'POST CAP PRISMA',
    head: ['CODE', 'DESCRIPTION', 'PCS/PACK', 'PCS/BOX', 'PCS/PALLET'],
    features: ['• certified 8.8 bolts'],
    dimensions: ['• dimensions: 215x115x120 mm'],
    descriptions: ['Post cap Prisma 7x7 cm', 'Post cap Prisma 8x8 cm'],
  },
};

/** URI di un collegamento, come lo scrive InDesign (il percorso è quello del Mac del grafico). */
const uri = (name: string): string => `file:/Users/grafico/Lavori/Links/${name}`;

const paragraph = (style: string, text: string): StoryItem => ({ kind: 'paragraph', style, text });

const textFrame = (x: number, y: number, items: StoryItem[]): TestFrame => ({ kind: 'text', x, y, w: 300, h: 100, items });

const imageFrame = (name: string, x: number, y: number, w: number, h: number): TestFrame => ({
  kind: 'image',
  link: uri(name),
  x,
  y,
  w,
  h,
});

/**
 * IDML di una lingua: una pagina di apertura con la categoria (senza stile, come nel file reale) e la sua
 * foto, poi la pagina del prodotto. Il materiale (senza stile) e le intestazioni di caratteristiche/dimensioni
 * (stesso stile del titolo, testo per lingua) riproducono la struttura trovata nel pacchetto reale.
 */
function idmlFor(lang: 'it' | 'en', texts: SampleTexts, extraLinks: string[]): Promise<string> {
  const table: StoryItem = {
    kind: 'table',
    rows: [
      texts.head,
      ['1807-1351', texts.descriptions[0], '40', '40', '640'],
      ['1807-1352', texts.descriptions[1], '30', '30', '480'],
    ],
  };
  return buildIdml({
    spreads: [
      {
        frames: [textFrame(0, 100, [paragraph('', texts.category)]), imageFrame('apertura.png', 300, 200, 400, 300)],
      },
      {
        frames: [
          textFrame(0, 100, [
            paragraph(STYLES.product, texts.product),
            paragraph('', 'PP'),
            paragraph(STYLES.product, FEATURES_HEADING[lang]),
            ...texts.features.map((text) => paragraph(STYLES.entry, text)),
            paragraph(STYLES.product, DIMENSIONS_HEADING[lang]),
            ...texts.dimensions.map((text) => paragraph(STYLES.entry, text)),
            table,
          ]),
          imageFrame('foto.png', 400, 150, 200, 100),
          imageFrame('qr.png', 400, 300, 100, 100),
          imageFrame('disegno.pdf', 400, 450, 200, 100),
          ...extraLinks.map((name, index) => imageFrame(name, 400, 600 + index * 150, 200, 100)),
        ],
      },
    ],
  });
}

const solidPng = (background: string): Promise<Buffer> =>
  sharp({ create: { width: 800, height: 600, channels: 3, background } })
    .png()
    .toBuffer();

/**
 * Scrive in `dir` un pacchetto di prova per la linea di un catalogo, nella forma che si aspetta `buildLine`:
 * `<dir>/it/catalogo.idml` + `<dir>/it/Links/…` e lo stesso in `<dir>/en/`.
 *
 * Contiene la categoria «COPRIPALO» con la foto di apertura e il prodotto «COPRIPALO PRISMA»
 * («POST CAP PRISMA» in inglese) con due articoli (`1807-1351`, `1807-1352`), una foto PNG,
 * un QR code PNG che codifica un video YouTube e un disegno PDF. Restituisce `dir`.
 */
export async function makeSampleInput(dir: string, options: SampleInputOptions = {}): Promise<string> {
  const { extraLinks = [], extraFiles = {} } = options;
  const files: Record<string, Buffer | string> = {
    'apertura.png': await solidPng('#2980b9'),
    'foto.png': await solidPng('#c0392b'),
    'qr.png': await QRCode.toBuffer(SAMPLE_VIDEO_URL, { type: 'png', width: 300 }),
    ...extraFiles,
  };

  for (const lang of ['it', 'en'] as const) {
    const linksDir = join(dir, lang, 'Links');
    await mkdir(linksDir, { recursive: true });
    await copyFile(await idmlFor(lang, TEXTS[lang], extraLinks), join(dir, lang, 'catalogo.idml'));
    await copyFile(PDF_FIXTURE, join(linksDir, 'disegno.pdf'));
    for (const [name, content] of Object.entries(files)) await writeFile(join(linksDir, name), content);
  }
  return dir;
}
