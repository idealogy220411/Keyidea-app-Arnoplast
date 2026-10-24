import { describe, expect, it } from 'vitest';
import type { AttachedCategory, AttachedLanguage, AttachedProduct } from '../src/associate';
import type { RawArticle } from '../src/extract';
import { mergeLanguages, slugify } from '../src/merge';
import type { Issue } from '../src/types';

const ANCHOR = { spreadIndex: 0, x: 0, y: 0 };

const article = (code: string, description = `Descrizione ${code}`): RawArticle => ({
  code,
  description,
  perPack: 10,
  perBox: 100,
  perPallet: 1000,
});

type ProductSpec = Partial<AttachedProduct> & { name: string; codes: string[] };

/** Prodotto con un articolo per codice; `categoryOrder` predefinito 0. */
const product = ({ name, codes, ...rest }: ProductSpec): AttachedProduct => ({
  name,
  categoryOrder: 0,
  materials: [],
  features: [],
  dimensions: [],
  articles: codes.map((code) => article(code)),
  optionalCodes: [],
  anchor: ANCHOR,
  imageLinks: [],
  drawingLinks: [],
  ...rest,
});

const category = (name: string, order: number, imageLink: string | null = null): AttachedCategory => ({
  name,
  order,
  anchor: ANCHOR,
  imageLink,
});

const language = (
  lang: string,
  categories: AttachedCategory[],
  products: AttachedProduct[],
  issues: Issue[] = [],
): AttachedLanguage => ({ lang, categories, products, issues });

const PRISMA_CODES = ['1807-1351', '1807-1352'];

/** Linea di prova con un solo prodotto Prisma in italiano, più le lingue indicate. */
const prismaLine = (...others: AttachedLanguage[]) =>
  mergeLanguages([
    language('it', [category('COPRIPALO', 0)], [product({ name: 'COPRIPALO PRISMA', codes: PRISMA_CODES })]),
    ...others,
  ]);

const prismaIn = (lang: string, name: string, codes = PRISMA_CODES) =>
  language(lang, [category('POST CAPS', 0)], [product({ name, codes })]);

describe('mergeLanguages', () => {
  it('matches products across languages by codes', () => {
    const result = prismaLine(prismaIn('en', 'POST CAP PRISMA'));

    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toEqual({ it: 'COPRIPALO PRISMA', en: 'POST CAP PRISMA' });
    expect(result.issues).toEqual([]);
  });

  it('merges article descriptions per code', () => {
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [
        product({
          name: 'POST CAP PRISMA',
          codes: [],
          // Righe in ordine diverso rispetto all'italiano: contano i codici, non la posizione.
          articles: [article('1807-1352', 'Cap 80x80'), article('1807-1351', 'Cap 60x60')],
        }),
      ],
    );
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({
          name: 'COPRIPALO PRISMA',
          codes: [],
          articles: [article('1807-1351', 'Coprip. 60x60'), article('1807-1352', 'Coprip. 80x80')],
        }),
      ],
    );

    const result = mergeLanguages([italian, english]);

    expect(result.products[0].articles.map((a) => [a.code, a.description])).toEqual([
      ['1807-1351', { it: 'Coprip. 60x60', en: 'Cap 60x60' }],
      ['1807-1352', { it: 'Coprip. 80x80', en: 'Cap 80x80' }],
    ]);
  });

  it('leaves out the description key when the matched product lacks the code', () => {
    const result = prismaLine(prismaIn('en', 'POST CAP PRISMA', ['1807-1351', '1807-9999']));

    const [first, second] = result.products[0].articles;
    expect(first.description).toEqual({ it: 'Descrizione 1807-1351', en: 'Descrizione 1807-1351' });
    expect(second.description).toEqual({ it: 'Descrizione 1807-1352' });
  });

  it('takes quantities, materials, optional codes and links from the Italian product', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({
          name: 'COPRIPALO PRISMA',
          codes: [],
          materials: ['PE', 'FE'],
          optionalCodes: ['1807-1352'],
          imageLinks: ['file:/a/foto.jpg'],
          drawingLinks: ['file:/a/disegno.pdf'],
          articles: [{ code: '1807-1351', description: 'Coprip.', perPack: null, perBox: 4, perPallet: 80 }],
        }),
      ],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [
        product({
          name: 'POST CAP PRISMA',
          codes: [],
          materials: ['PP'],
          optionalCodes: ['1807-9999'],
          imageLinks: ['file:/a/foto-en.jpg'],
          articles: [{ code: '1807-1351', description: 'Cap', perPack: 1, perBox: 2, perPallet: 3 }],
        }),
      ],
    );

    const [merged] = mergeLanguages([italian, english]).products;

    expect(merged.materials).toEqual(['PE', 'FE']);
    expect(merged.optionalCodes).toEqual(['1807-1352']);
    expect(merged.imageLinks).toEqual(['file:/a/foto.jpg']);
    expect(merged.drawingLinks).toEqual(['file:/a/disegno.pdf']);
    expect(merged.articles[0]).toMatchObject({ code: '1807-1351', perPack: null, perBox: 4, perPallet: 80 });
  });

  it('takes features and dimensions per language from the matched product', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({ name: 'COPRIPALO PRISMA', codes: PRISMA_CODES, features: ['Robusto'], dimensions: ['Ø 6 cm'] }),
        product({ name: 'COPRIPALO QUBO', codes: ['1807-2000'] }),
      ],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [product({ name: 'POST CAP PRISMA', codes: PRISMA_CODES, features: ['Sturdy'], dimensions: [] })],
    );

    const [prisma, qubo] = mergeLanguages([italian, english]).products;

    expect(prisma.features).toEqual({ it: ['Robusto'], en: ['Sturdy'] });
    expect(prisma.dimensions).toEqual({ it: ['Ø 6 cm'], en: [] });
    // Nessuna corrispondenza in inglese: la chiave `en` manca, l'app userà l'italiano.
    expect(qubo.name).toEqual({ it: 'COPRIPALO QUBO' });
    expect(qubo.features).toEqual({ it: [] });
    expect(qubo.dimensions).toEqual({ it: [] });
  });

  it('warns on product only in foreign language', () => {
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [
        product({ name: 'POST CAP PRISMA', codes: PRISMA_CODES }),
        product({ name: 'POST CAP ALIEN', codes: ['9999-0001'] }),
      ],
    );

    const result = prismaLine(english);

    expect(result.products).toHaveLength(1);
    expect(JSON.stringify(result.products)).not.toContain('ALIEN');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'en' });
    expect(result.issues[0].message).toContain('solo in en');
    expect(result.issues[0].message).toContain('POST CAP ALIEN');
  });

  it('warns on missing translation', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({ name: 'COPRIPALO PRISMA', codes: PRISMA_CODES }),
        product({ name: 'COPRIPALO QUBO', codes: ['1807-2000'] }),
      ],
    );

    const result = mergeLanguages([italian, prismaIn('en', 'POST CAP PRISMA')]);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ level: 'warning', where: 'en' });
    expect(result.issues[0].message).toContain('traduzione mancante (en)');
    expect(result.issues[0].message).toContain('COPRIPALO QUBO');
    expect(result.products).toHaveLength(2);
  });

  it('translates category names by majority', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({ name: 'COPRIPALO PRISMA', codes: ['1807-0001'] }),
        product({ name: 'COPRIPALO QUBO', codes: ['1807-0002'] }),
        product({ name: 'COPRIPALO ZEPHIRO', codes: ['1807-0003'] }),
      ],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0), category('ACCESSORIES', 1)],
      [
        product({ name: 'POST CAP PRISMA', codes: ['1807-0001'], categoryOrder: 0 }),
        product({ name: 'POST CAP QUBO', codes: ['1807-0002'], categoryOrder: 0 }),
        product({ name: 'POST CAP ZEPHIRO', codes: ['1807-0003'], categoryOrder: 1 }),
      ],
    );

    const result = mergeLanguages([italian, english]);

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].name).toEqual({ it: 'COPRIPALO', en: 'POST CAPS' });
  });

  it('keeps the first category name on a tie and leaves the key out without matches', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0), category('ACCESSORI', 1)],
      [
        product({ name: 'COPRIPALO PRISMA', codes: ['1807-0001'], categoryOrder: 0 }),
        product({ name: 'COPRIPALO QUBO', codes: ['1807-0002'], categoryOrder: 0 }),
        product({ name: 'MON-BLOCK', codes: ['1807-0751'], categoryOrder: 1 }),
      ],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0), category('POST CAPS 2', 1)],
      [
        product({ name: 'POST CAP PRISMA', codes: ['1807-0001'], categoryOrder: 0 }),
        product({ name: 'POST CAP QUBO', codes: ['1807-0002'], categoryOrder: 1 }),
      ],
    );

    const result = mergeLanguages([italian, english]);

    expect(result.categories[0].name).toEqual({ it: 'COPRIPALO', en: 'POST CAPS' });
    expect(result.categories[1].name).toEqual({ it: 'ACCESSORI' });
  });

  it('slugifies with suffix on duplicates', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({ name: 'COPRIPALO', codes: ['1807-0001'] }),
        product({ name: 'COPRIPALO', codes: ['1807-0002'] }),
        product({ name: 'COPRIPALO', codes: ['1807-0003'] }),
      ],
    );

    const result = mergeLanguages([italian]);

    expect(result.products.map((p) => p.id)).toEqual(['copripalo', 'copripalo-2', 'copripalo-3']);
    expect(result.categories[0].productIds).toEqual(['copripalo', 'copripalo-2', 'copripalo-3']);
  });

  it('falls back to a generic id when the name has no letters or digits', () => {
    const italian = language(
      'it',
      [category('***', 0), category('???', 1)],
      [
        product({ name: '®', codes: ['1807-0001'], categoryOrder: 0 }),
        product({ name: '™', codes: ['1807-0002'], categoryOrder: 1 }),
      ],
    );

    const result = mergeLanguages([italian]);

    expect(result.categories.map((c) => c.id)).toEqual(['categoria', 'categoria-2']);
    expect(result.products.map((p) => [p.id, p.categoryId])).toEqual([
      ['prodotto', 'categoria'],
      ['prodotto-2', 'categoria-2'],
    ]);
  });

  it('builds categories from the Italian ones with their products in reading order', () => {
    const italian = language(
      'it',
      [category('Accessori, PET e ricambi', 3, 'file:/a/cat.jpg'), category('COPRIPALO', 5)],
      [
        product({ name: 'Mon-block', codes: ['1807-0751'], categoryOrder: 3 }),
        product({ name: 'COPRIPALO PRISMA', codes: ['1807-0001'], categoryOrder: 5 }),
        product({ name: 'Tappo', codes: ['1807-0002'], categoryOrder: 3 }),
      ],
    );

    const result = mergeLanguages([italian]);

    expect(result.categories).toEqual([
      {
        id: 'accessori-pet-e-ricambi',
        name: { it: 'Accessori, PET e ricambi' },
        order: 3,
        imageLink: 'file:/a/cat.jpg',
        productIds: ['mon-block', 'tappo'],
      },
      { id: 'copripalo', name: { it: 'COPRIPALO' }, order: 5, imageLink: null, productIds: ['copripalo-prisma'] },
    ]);
    expect(result.products.map((p) => [p.id, p.categoryId])).toEqual([
      ['mon-block', 'accessori-pet-e-ricambi'],
      ['copripalo-prisma', 'copripalo'],
      ['tappo', 'accessori-pet-e-ricambi'],
    ]);
  });

  it('adds a suffix to category ids that slugify identically', () => {
    const italian = language(
      'it',
      [category('Accessori', 0), category('ACCESSORI!', 1)],
      [
        product({ name: 'UNO', codes: ['1807-0001'], categoryOrder: 0 }),
        product({ name: 'DUE', codes: ['1807-0002'], categoryOrder: 1 }),
      ],
    );

    const result = mergeLanguages([italian]);

    expect(result.categories.map((c) => c.id)).toEqual(['accessori', 'accessori-2']);
    expect(result.products.map((p) => p.categoryId)).toEqual(['accessori', 'accessori-2']);
  });

  it('matches the Italian product that shares the most codes, ties going to the first', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [
        product({ name: 'UNO', codes: ['1807-0001', '1807-0002'] }),
        product({ name: 'DUE', codes: ['1807-0002', '1807-0003', '1807-0004'] }),
        product({ name: 'TRE', codes: ['1807-0005'] }),
        product({ name: 'QUATTRO', codes: ['1807-0005'] }),
      ],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [
        // 1 codice con UNO, 2 con DUE: vince DUE.
        product({ name: 'TWO', codes: ['1807-0002', '1807-0003'] }),
        // Un codice sia con TRE sia con QUATTRO: a parità vince il primo.
        product({ name: 'THREE', codes: ['1807-0005'] }),
      ],
    );

    const result = mergeLanguages([italian, english]);

    expect(result.products.map((p) => p.name)).toEqual([
      { it: 'UNO' },
      { it: 'DUE', en: 'TWO' },
      { it: 'TRE', en: 'THREE' },
      { it: 'QUATTRO' },
    ]);
  });

  it('keeps only the best of several foreign products matching the same Italian product', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [product({ name: 'UNO', codes: ['1807-0001', '1807-0002', '1807-0003'] })],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [
        product({ name: 'ONE-A', codes: ['1807-0001'] }),
        product({ name: 'ONE-B', codes: ['1807-0001', '1807-0002'] }),
        product({ name: 'ONE-C', codes: ['1807-0003', '1807-0002'] }),
      ],
    );

    const result = mergeLanguages([italian, english]);

    // ONE-B e ONE-C condividono 2 codici: a parità vince il primo, ONE-B.
    expect(result.products[0].name).toEqual({ it: 'UNO', en: 'ONE-B' });
    expect(result.issues.map((issue) => issue.message)).toEqual([
      'prodotto presente solo in en: ONE-A',
      'prodotto presente solo in en: ONE-C',
    ]);
    expect(result.issues.every((issue) => issue.level === 'warning' && issue.where === 'en')).toBe(true);
  });

  it('lists the Italian language first and then the others in input order', () => {
    const result = mergeLanguages([
      prismaIn('es', 'TAPA PRISMA'),
      language('it', [category('COPRIPALO', 0)], [product({ name: 'COPRIPALO PRISMA', codes: PRISMA_CODES })]),
      prismaIn('en', 'POST CAP PRISMA'),
    ]);

    expect(result.languages).toEqual(['it', 'es', 'en']);
    expect(result.products[0].name).toEqual({ it: 'COPRIPALO PRISMA', es: 'TAPA PRISMA', en: 'POST CAP PRISMA' });
  });

  it('carries language issues with language prefix', () => {
    const italian = language(
      'it',
      [category('COPRIPALO', 0)],
      [product({ name: 'COPRIPALO PRISMA', codes: PRISMA_CODES })],
      [{ level: 'warning', message: 'Materiale sconosciuto «XX»', where: 'spread 1' }],
    );
    const english = language(
      'en',
      [category('POST CAPS', 0)],
      [product({ name: 'POST CAP PRISMA', codes: PRISMA_CODES }), product({ name: 'POST CAP ALIEN', codes: ['9999-0001'] })],
      [
        { level: 'error', message: 'Tabella illeggibile', where: 'spread 3' },
        { level: 'warning', message: 'Senza posizione' },
      ],
    );

    const result = mergeLanguages([english, italian]);

    expect(result.issues).toEqual([
      { level: 'warning', message: 'Materiale sconosciuto «XX»', where: 'it: spread 1' },
      { level: 'error', message: 'Tabella illeggibile', where: 'en: spread 3' },
      { level: 'warning', message: 'Senza posizione', where: 'en' },
      expect.objectContaining({ level: 'warning', where: 'en', message: expect.stringContaining('solo in en') }),
    ]);
    // Gli avvisi delle lingue di partenza non vengono modificati.
    expect(italian.issues[0].where).toBe('spread 1');
  });

  it('throws when the Italian language is missing', () => {
    expect(() => mergeLanguages([prismaIn('en', 'POST CAP PRISMA')])).toThrow(/italiano/);
    expect(() => mergeLanguages([])).toThrow(/italiano/);
  });
});

describe('slugify', () => {
  it('slugify strips accents', () => {
    expect(slugify('Accessori, PET e ricambi')).toBe('accessori-pet-e-ricambi');
    expect(slugify('Ø 6cm')).toBe('6cm');
    expect(slugify('Più Robustezza è così')).toBe('piu-robustezza-e-cosi');
    // Anche gli accenti già scomposti (come li salva il Mac).
    expect(slugify('Più')).toBe('piu');
  });

  it('collapses separators and trims dashes', () => {
    expect(slugify('  --COPRIPALO   /  PRISMA--  ')).toBe('copripalo-prisma');
    expect(slugify('®™')).toBe('');
  });
});
