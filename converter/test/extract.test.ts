import { describe, expect, it } from 'vitest';
import type { ConverterConfig } from '../src/config';
import { extractLanguage, type LanguageExtract } from '../src/extract';
import { readIdml } from '../src/idml/read';
import type { StoryItem } from '../src/types';
import { buildIdml, buildRawIdml, type TestFrame, type TestPage } from './helpers/build-idml';

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

/** Frame senza alcuno stile di carattere: come lo sono, nel file reale, le etichette di categoria e i bollini materiale. */
const unstyled = (text: string): StoryItem => ({ kind: 'paragraph', style: '', text });
/** Etichetta di categoria (ripresa a margine pagina): riconosciuta dal solo contenuto, senza stile. */
const category = unstyled;
/** Bollino materiale (PP, PE, …): riconosciuto dal solo contenuto, senza stile. */
const material = unstyled;
/** Frame nello stile di titolo: titolo di prodotto, oppure una delle intestazioni che gli somigliano. */
const titled = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.product, text });
const product = titled;
const featuresHeading = (): StoryItem => titled(config.styles.featuresHeading.it);
const dimensionsHeading = (): StoryItem => titled(config.styles.dimensionsHeading.it);
const optionalHeading = (): StoryItem => titled(config.styles.optionalFixingHeading.it);
/** Riga di caratteristica o di dimensione (lo stesso stile per entrambe: il significato lo decide l'intestazione). */
const entry = (text: string): StoryItem => ({ kind: 'paragraph', style: config.styles.entry, text });
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
  return extractLanguage(doc, { ...config, ...changes }, lang, 'agricoltura');
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
          { kind: 'paragraph', style: 'tab_nome', text: 'testo che non interessa' },
          product('COPRIPALO QUBO'),
          material('PP'),
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

  it('ignores a repeated category label on later pages of the same section', async () => {
    const result = await extract([
      [frame(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA'))],
      [frame(0, 0, category('COPRIPALO'), product('COPRIPALO QUBO'))],
    ]);
    expect(result.categories).toHaveLength(1);
    expect(result.products.map((p) => p.categoryOrder)).toEqual([0, 0]);
  });

  it('reactivates a category already declared earlier in the document instead of duplicating it', async () => {
    // Caso reale: la pagina indice, all'inizio del documento, elenca già tutte le categorie dichiarate
    // (etichette senza stile, come quelle a margine pagina) prima di qualunque prodotto. Senza riattivare
    // la categoria già vista, ogni sezione reale produrrebbe una categoria duplicata e i prodotti
    // finirebbero attaccati all'ultima categoria dell'indice invece che a quella giusta.
    const result = await extract([
      // pagina indice: entrambe le categorie dichiarate, senza nessun prodotto
      [frame(0, 0, category('COPRIPALO'), category('PLACCHETTE'))],
      // sezione reale di COPRIPALO
      [frame(0, 100, category('COPRIPALO'), product('COPRIPALO PRISMA'))],
      // sezione reale di PLACCHETTE
      [frame(0, 200, category('PLACCHETTE'), product('PLACCHETTA ROMA'))],
    ]);
    expect(result.categories.map((c) => c.name)).toEqual(['COPRIPALO', 'PLACCHETTE']);
    // l'ancora segue l'ultima comparsa (la sezione reale), non la pagina indice
    expect(result.categories[0].anchor).toEqual({ spreadIndex: 1, x: 0, y: 100 });
    expect(result.categories[1].anchor).toEqual({ spreadIndex: 2, x: 0, y: 200 });
    expect(result.products.map((p) => [p.name, p.categoryOrder])).toEqual([
      ['COPRIPALO PRISMA', 0],
      ['PLACCHETTA ROMA', 1],
    ]);
  });

  it('extracts features and dimensions without bullets, recognizing the headings by text', async () => {
    const result = await extract(
      oneProduct(
        featuresHeading(),
        entry('• viteria certificata 8.8'),
        entry('  ▪   coperchio  in PP  '),
        entry('- resistente a -30°C'),
        entry('resistente ai raggi UV'),
        entry('-30°C / +60°C'),
        dimensionsHeading(),
        entry('• 7x7 cm'),
        entry('- altezza   120 cm'),
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

  it('recognizes the headings without regard to case', async () => {
    const result = await extract(oneProduct(titled('caratteristiche'), entry('viteria certificata')));
    expect(result.products[0].features).toEqual(['viteria certificata']);
  });

  it('warns on an entry row outside any heading', async () => {
    const result = await extract(oneProduct(entry('viteria certificata')));
    expect(result.products[0].features).toEqual([]);
    expect(result.products[0].dimensions).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'spread 1' });
    expect(result.issues[0].message).toContain('viteria certificata');
  });

  it('treats a pure-title frame that is neither a heading nor an optional label as a new product', async () => {
    // Come nel file reale, il nuovo prodotto ha un contenuto proprio (qui un bollino materiale): un titolo
    // «puro» senza nessun contenuto proprio è invece un optional di fissaggio del prodotto corrente (vedi
    // «resolves a pending title at the table as a fixing option», sotto).
    const result = await extract(oneProduct(featuresHeading(), entry('viteria'), product('COPRIPALO QUBO'), material('PP')));
    expect(result.products.map((p) => p.name)).toEqual(['COPRIPALO PRISMA', 'COPRIPALO QUBO']);
    expect(result.products[0].features).toEqual(['viteria']);
    expect(result.products[1].materials).toEqual(['PP']);
  });

  it('keeps reading features after a title repeated right before the heading (real file: COPRIPALO MONVISO)', async () => {
    // Nel file reale il titolo compare due volte di seguito subito prima di «CARATTERISTICHE» (una svista del
    // grafico, non un secondo prodotto). Il titolo ripetuto finisce in sospeso (vedi «treats a pure-title
    // frame…» sopra) e si risolve solo alla prima riga di contenuto vera; quella risoluzione non deve
    // cancellare la sezione «CARATTERISTICHE» già riconosciuta, altrimenti tutte le sue righe vengono scartate.
    const result = await extract(
      oneProduct(product('COPRIPALO PRISMA'), featuresHeading(), entry('viteria certificata'), entry('resistente agli urti')),
    );
    expect(result.products.map((p) => p.name)).toEqual(['COPRIPALO PRISMA']);
    expect(result.products[0].features).toEqual(['viteria certificata', 'resistente agli urti']);
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

  it('warns about a row without a code but with other content, and ignores a fully empty row', async () => {
    const result = await extract(
      oneProduct(
        table(
          HEADER,
          ['', 'Descrizione senza codice', '40', '40', '640'],
          ['', '', '', '', ''],
          ['', '', '10', '', ''],
          ['1807-1362', 'Articolo vero', '40', '40', '640'],
        ),
      ),
    );
    expect(result.products[0].articles).toEqual([
      { code: '1807-1362', description: 'Articolo vero', perPack: 40, perBox: 40, perPallet: 640 },
    ]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'spread 1' });
    expect(result.issues[0].message).toBe('riga della tabella senza codice ignorata: «Descrizione senza codice»');
    expect(result.issues[1].message).toBe('riga della tabella senza codice ignorata: «»');
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
          ['CÓDIGO', 'DESCRIPCIÓN', 'ENV.', 'CAJA', 'PALÉ'],
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

  it('accepts codes with letter suffixes, in either letter case', async () => {
    // Il cliente scrive il suffisso a volte maiuscolo, a volte minuscolo (visto nel file reale: «1807-0108gr»).
    const result = await extract(
      oneProduct(
        table(
          HEADER,
          ['1807-1310GZ', 'Zincato', '10', '10', '100'],
          ['1807-0308GR', 'Grigio', '10', '10', '100'],
          ['1807-0108gr', 'Grigio', '10', '10', '100'],
        ),
      ),
    );
    expect(result.products[0].articles.map((a) => a.code)).toEqual(['1807-1310GZ', '1807-0308GR', '1807-0108gr']);
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

  it('reads material badges by content, with no character style', async () => {
    const result = await extract(oneProduct(material('PP'), material(' PET '), material('PP')));
    expect(result.products[0].materials).toEqual(['PP', 'PET']);
    expect(result.issues).toEqual([]);
  });

  it('ignores unstyled text that matches neither a declared category nor a material code', async () => {
    const result = await extract(oneProduct(unstyled('(optional)'), unstyled('ABS'), unstyled('Esempio schematico')));
    expect(result.products[0].materials).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('replaces the materials read with the overrides', async () => {
    // PRISMA e QUBO su due pagine (spread) distinte: nel file reale un prodotto sta sempre su una sola
    // pagina, ed è il cambio di pagina a chiudere il prodotto precedente prima di aprire il successivo.
    const spreads = [
      [frame(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA'), material('PE'))],
      [frame(0, 0, product('COPRIPALO QUBO'), material('PET'))],
    ];
    const result = await extract(spreads, { overrides: { materials: { 'COPRIPALO PRISMA': ['PP', 'FE'] } } });
    expect(result.products.map((p) => p.materials)).toEqual([['PP', 'FE'], ['PET']]);
  });

  it('collects the fixing-option labels that follow the heading as text, not as separate products', async () => {
    const result = await extract(
      oneProduct(
        optionalHeading(),
        titled('VITERIA STANDARD 4 PZ'),
        titled('VITERIA GZ'),
        table(HEADER, ['1807-1357', 'Viteria per Cp (4pz.)', '40', '200', '-']),
      ),
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0].fixingOptions).toEqual(['VITERIA STANDARD 4 PZ', 'VITERIA GZ']);
    expect(result.products[0].articles).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('resolves the fixing-option labels at the change of page, even when the table comes before the heading', async () => {
    // Struttura esatta della pagina di Copripalo Prisma nel file reale: le etichette «VITERIA...» e la
    // tabella degli articoli stanno SOPRA l'intestazione «OPTIONAL DI FISSAGGIO» (la posizione sulla pagina
    // non segue l'ordine logico). Il prodotto successivo è su una pagina diversa.
    const result = await extract([
      [
        frame(
          0,
          0,
          category('COPRIPALO'),
          product('COPRIPALO PRISMA'),
          titled('VITERIA STANDARD 4 PZ'),
          table(HEADER, ['1807-1357', 'Viteria per Cp (4pz.)', '40', '200', '-']),
          optionalHeading(),
        ),
      ],
      [frame(0, 0, product('COPRIPALO QUBO'))],
    ]);
    expect(result.products.map((p) => p.name)).toEqual(['COPRIPALO PRISMA', 'COPRIPALO QUBO']);
    expect(result.products[0].fixingOptions).toEqual(['VITERIA STANDARD 4 PZ']);
    expect(result.products[0].articles).toHaveLength(1);
  });

  it('resolves a pending title at the table as a fixing option, even without ever seeing the heading', async () => {
    // Caso reale: nella pagina di Copripalo Reno le etichette «VITERIA...» non hanno nessuna intestazione
    // «OPTIONAL DI FISSAGGIO» sopra di sé (compare per altri prodotti, non per questo): alla tabella, che è
    // sempre quella del prodotto aperto, sono comunque il suo optional di fissaggio, non prodotti a sé stanti.
    const result = await extract(
      oneProduct(titled('VITERIA RETE PIANA'), titled('VITERIA GZ'), table(HEADER, ['1807-1357', 'Viteria', '40', '200', '-'])),
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0].fixingOptions).toEqual(['VITERIA RETE PIANA', 'VITERIA GZ']);
    expect(result.products[0].articles).toHaveLength(1);
  });

  it('resolves a pending title at the next material badge or entry row as a new product, even after the heading', async () => {
    // Un bollino materiale o una riga di caratteristica/dimensione è sempre contenuto proprio di un prodotto
    // vero (un optional di fissaggio è solo un nome, senza caratteristiche né materiale propri): la loro
    // comparsa scioglie un titolo in sospeso come nuovo prodotto, anche se l'intestazione optional era già
    // comparsa per il prodotto precedente.
    const result = await extract(
      oneProduct(
        optionalHeading(),
        titled('VITERIA GZ'),
        table(HEADER, ['1807-1357', 'Viteria per Cp (4pz.)', '40', '200', '-']),
        titled('COPRIPALO QUBO'),
        material('PP'),
      ),
    );
    expect(result.products.map((p) => p.name)).toEqual(['COPRIPALO PRISMA', 'COPRIPALO QUBO']);
    expect(result.products[0].fixingOptions).toEqual(['VITERIA GZ']);
    expect(result.products[1].materials).toEqual(['PP']);
  });

  it('reports a fixing-option label before any product as an error, like any other misplaced content', async () => {
    const result = await extract([[frame(0, 0, category('COPRIPALO'), optionalHeading(), titled('VITERIA GZ'))]]);
    expect(result.products).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning' });
    expect(result.issues[0].message).toContain('VITERIA GZ');
  });

  it('warns on content outside a product', async () => {
    const result = await extract([
      [frame(0, 0, category('COPRIPALO'))],
      [
        frame(
          0,
          0,
          featuresHeading(),
          entry('viteria certificata 8.8'),
          dimensionsHeading(),
          entry('7x7 cm'),
          table(HEADER, ['1807-1351', 'Coprip Prisma 7x7', '40', '40', '640']),
        ),
        frame(0, 300, product('COPRIPALO PRISMA')),
      ],
    ]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ features: [], dimensions: [], articles: [] });
    expect(result.issues).toHaveLength(3);
    expect(result.issues.map((i) => i.level)).toEqual(['warning', 'warning', 'warning']);
    expect(result.issues.map((i) => i.where)).toEqual(['spread 2', 'spread 2', 'spread 2']);
  });

  it('attaches a material badge found before any product to the next one opened on the same page', async () => {
    // Caso reale: nella pagina di Copripalo Prisma il bollino materiale sta una frazione di punto più in alto
    // del titolo che lo segue, quindi nell'ordine di lettura risulta prima che un prodotto sia aperto: è
    // comunque il materiale di quel prodotto, non un errore da segnalare.
    const result = await extract([[frame(0, 0, category('COPRIPALO'), material('PP'), product('COPRIPALO PRISMA'))]]);
    expect(result.products[0].materials).toEqual(['PP']);
    expect(result.issues).toEqual([]);
  });

  it('does not attach content after a new category to the previous product', async () => {
    const result = await extract([
      [
        frame(0, 0, category('COPRIPALO'), product('COPRIPALO PRISMA')),
        frame(0, 200, category('PLACCHETTE'), featuresHeading(), entry('testo prima del prodotto')),
      ],
    ]);
    expect(result.products[0].features).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].where).toBe('spread 1');
  });

  it('reports a product before any category as an error', async () => {
    const result = await extract([[frame(0, 0, product('COPRIPALO PRISMA'), featuresHeading(), entry('viteria'))]]);
    expect(result.categories).toEqual([]);
    expect(result.products).toEqual([]);
    expect(result.issues[0]).toMatchObject({ level: 'error', where: 'spread 1' });
    expect(result.issues[0].message).toContain('COPRIPALO PRISMA');
  });

  it('orders products by spread then position', async () => {
    const result = await extract([
      [
        frame(0, 400, product('PRODOTTO BASSO A SINISTRA'), material('PP')),
        frame(600, 100, product('PRODOTTO ALTO A DESTRA'), material('PP')),
        frame(0, 0, category('COPRIPALO')),
      ],
      [frame(0, 0, product('PRODOTTO DEL SECONDO SPREAD'), material('PP'))],
    ]);
    expect(result.products.map((p) => p.name)).toEqual([
      'PRODOTTO ALTO A DESTRA',
      'PRODOTTO BASSO A SINISTRA',
      'PRODOTTO DEL SECONDO SPREAD',
    ]);
  });

  it('reads the left page of a spread before the right one, even with a lower title', async () => {
    // Due pagine affiancate (0-595 e 595-1190): la categoria è sulla pagina sinistra ma più in basso (y 400)
    // del titolo del prodotto sulla pagina destra (y 100). Senza tener conto della pagina, l'ordine per sola y
    // metterebbe il prodotto prima della categoria (errore: "prodotto prima della categoria").
    const PAGES: TestPage[] = [
      { x: 0, y: 0, w: 595, h: 842 },
      { x: 595, y: 0, w: 595, h: 842 },
    ];
    const doc = await readIdml(
      await buildIdml({
        spreads: [
          {
            pages: PAGES,
            frames: [frame(50, 400, category('COPRIPALO')), frame(650, 100, product('COPRIPALO PRISMA'))],
          },
        ],
      }),
    );
    const result = extractLanguage(doc, config, 'it', 'agricoltura');

    expect(result.issues).toEqual([]);
    expect(result.categories.map((c) => c.name)).toEqual(['COPRIPALO']);
    expect(result.products.map((p) => p.name)).toEqual(['COPRIPALO PRISMA']);
  });

  it('does not interleave the frames of two products on facing pages', async () => {
    // Pagina sinistra: titolo e caratteristiche di PRISMA. Pagina destra: titolo e tabella di QUBO.
    // Ordinando solo per y (ignorando la pagina) le caratteristiche di PRISMA (y 700) finirebbero dopo
    // il titolo di QUBO (y 100), e verrebbero assegnate a QUBO invece che a PRISMA.
    const PAGES: TestPage[] = [
      { x: 0, y: 0, w: 595, h: 842 },
      { x: 595, y: 0, w: 595, h: 842 },
    ];
    const doc = await readIdml(
      await buildIdml({
        spreads: [
          {
            pages: PAGES,
            frames: [
              frame(0, 0, category('COPRIPALO')),
              frame(50, 50, product('COPRIPALO PRISMA')),
              frame(50, 700, featuresHeading(), entry('viteria certificata')),
              frame(650, 100, product('COPRIPALO QUBO')),
              frame(650, 300, table(HEADER, ['1807-2000', 'Qubo', '1', '1', '1'])),
            ],
          },
        ],
      }),
    );
    const result = extractLanguage(doc, config, 'it', 'agricoltura');

    const [prisma, qubo] = result.products;
    expect(prisma.name).toBe('COPRIPALO PRISMA');
    expect(prisma.features).toEqual(['viteria certificata']);
    expect(prisma.articles).toEqual([]);
    expect(qubo.name).toBe('COPRIPALO QUBO');
    expect(qubo.features).toEqual([]);
    expect(qubo.articles).toHaveLength(1);
  });

  it('reads frames with the same height from left to right', async () => {
    const result = await extract([
      [
        frame(600, 100, product('PRODOTTO A DESTRA'), material('PP')),
        frame(0, 100, product('PRODOTTO A SINISTRA'), material('PP')),
        frame(0, 0, category('COPRIPALO')),
      ],
    ]);
    expect(result.products.map((p) => p.name)).toEqual(['PRODOTTO A SINISTRA', 'PRODOTTO A DESTRA']);
  });

  it('anchors titles on the frame that holds them', async () => {
    const result = await extract([
      [frame(0, 0, category('COPRIPALO'))],
      [
        frame(40, 70, product('COPRIPALO PRISMA'), material('PP')),
        frame(640, 90, product('COPRIPALO QUBO'), material('PP')),
      ],
    ]);
    expect(result.categories[0].anchor).toEqual({ spreadIndex: 0, x: 0, y: 0 });
    expect(result.products.map((p) => p.anchor)).toEqual([
      { spreadIndex: 1, x: 40, y: 70 },
      { spreadIndex: 1, x: 640, y: 90 },
    ]);
  });

  it('reads a threaded story once, anchored on its first frame', async () => {
    const style = (name: string, text: string): string =>
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange${name ? ` AppliedCharacterStyle="CharacterStyle/${name}"` : ''}><Content>${text}</Content><Br/></CharacterStyleRange></ParagraphStyleRange>`;
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
        s1:
          style('', 'COPRIPALO') +
          style('TITOLO', 'COPRIPALO PRISMA') +
          style('TITOLO', 'CARATTERISTICHE') +
          style('CARATTERTISTICHE', 'viteria'),
      },
      spreads: [
        // f2 è il secondo anello del filo, ma ha la `y` minore: nell'ordine di lettura viene per primo
        `<TextFrame Self="f2" ParentStory="s1" PreviousTextFrame="f1" ItemTransform="1 0 0 1 200 10">${path(0, 0, 100, 50)}</TextFrame>` +
          `<TextFrame Self="f1" ParentStory="s1" NextTextFrame="f2" ItemTransform="1 0 0 1 30 20">${path(0, 0, 100, 50)}</TextFrame>`,
      ],
    });
    const result = extractLanguage(await readIdml(file), config, 'it', 'agricoltura');
    expect(result.products).toHaveLength(1);
    expect(result.products[0].features).toEqual(['viteria']);
    expect(result.products[0].anchor).toEqual({ spreadIndex: 0, x: 200, y: 10 });
    expect(result.categories[0].anchor).toEqual({ spreadIndex: 0, x: 200, y: 10 });
  });
});
