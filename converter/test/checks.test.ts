import type { Article, LineData, Product } from '@arnoplast/schema';
import { describe, expect, it } from 'vitest';
import { checkLine } from '../src/checks';

const image = (name: string) => ({ thumb: `${name}-400.webp`, detail: `${name}-1600.webp`, width: 400, height: 300 });

const article = (code: string, description = `Articolo ${code}`): Article => ({
  code,
  description: { it: description },
  perPack: 10,
  perBox: 100,
  perPallet: 1000,
});

const product = (id: string, name: string, categoryId: string, articles: Article[]): Product => ({
  id,
  categoryId,
  name: { it: name },
  materials: ['PP'],
  features: { it: [] },
  dimensions: { it: [] },
  images: [image(id)],
  drawings: [],
  videoUrl: null,
  optionalCodes: [],
  articles,
});

/** Linea valida con 2 categorie e 3 prodotti, senza codici in comune. Ogni chiamata ne crea una nuova da modificare. */
function makeLine(change?: (line: LineData) => void): LineData {
  const line: LineData = {
    format: 1,
    line: 'agricoltura',
    edition: '2026.1',
    languages: ['it'],
    name: { it: 'Agricoltura' },
    categories: [
      { id: 'copripalo', name: { it: 'COPRIPALO' }, order: 0, image: image('copripalo'), productIds: ['prisma', 'qubo'] },
      { id: 'accessori', name: { it: 'ACCESSORI' }, order: 1, image: image('accessori'), productIds: ['zephiro'] },
    ],
    products: [
      product('prisma', 'Prisma', 'copripalo', [article('1807-1351'), article('1807-1352')]),
      product('qubo', 'Qubo', 'copripalo', [article('1807-1361')]),
      product('zephiro', 'Zephiro', 'accessori', [article('1807-1371')]),
    ],
  };
  change?.(line);
  return line;
}

const errorsOf = (line: LineData) => checkLine(line).filter((issue) => issue.level === 'error');
const warningsOf = (line: LineData) => checkLine(line).filter((issue) => issue.level === 'warning');

describe('checkLine', () => {
  it('reports nothing for a valid line', () => {
    expect(checkLine(makeLine())).toEqual([]);
  });

  it('allows a shared accessory code across products', () => {
    const line = makeLine((l) => {
      l.products[0].articles.push(article('1807-0751', 'Mon-block'));
      l.products[1].articles.push(article('1807-0751', 'Mon-block'));
    });

    expect(checkLine(line)).toEqual([]);
  });

  it('warns when shared code descriptions differ', () => {
    const line = makeLine((l) => {
      l.products[0].articles.push(article('1807-0751', 'Mon-block 40'));
      l.products[1].articles.push(article('1807-0751', 'Mon-block 50'));
    });

    const issues = checkLine(line);

    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].message).toContain('1807-0751');
    expect(issues[0].message).toContain('Prisma');
    expect(issues[0].message).toContain('Qubo');
    expect(issues[0].where).toBe('1807-0751');
  });

  it('warns once per shared code, not once per pair of products', () => {
    const line = makeLine((l) => {
      l.products[0].articles.push(article('1807-0751', 'Mon-block 40'));
      l.products[1].articles.push(article('1807-0751', 'Mon-block 50'));
      l.products[2].articles.push(article('1807-0751', 'Mon-block 60'));
    });

    const issues = checkLine(line);

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('Zephiro');
  });

  it('does not warn when only whitespace differs in the shared code descriptions', () => {
    const line = makeLine((l) => {
      l.products[0].articles.push(article('1807-0751', 'Mon-block'));
      l.products[1].articles.push(article('1807-0751', ' Mon-block '));
    });

    expect(checkLine(line)).toEqual([]);
  });

  it('errors on duplicate code in one product', () => {
    const line = makeLine((l) => {
      l.products[0].articles.push(article('1807-1351'));
    });

    const issues = checkLine(line);

    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('error');
    expect(issues[0].message).toContain('1807-1351');
    expect(issues[0].where).toBe('products.0.articles.2.code');
  });

  it('reports a product without articles as a single error', () => {
    const line = makeLine((l) => {
      l.products[2].articles = [];
    });

    const issues = checkLine(line);

    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('error');
    expect(issues[0].message).toContain('zephiro');
    expect(issues[0].where).toBe('products.2.articles');
  });

  it('maps each schema issue to one error whose where is the field path', () => {
    const line = makeLine((l) => {
      l.edition = '2026';
    });

    expect(checkLine(line)).toEqual([
      { level: 'error', message: expect.stringContaining('2026'), where: 'edition' },
    ]);
  });

  it('reports every schema issue, one error each', () => {
    const line = makeLine((l) => {
      // Un riferimento a una categoria inesistente viene segnalato da entrambi i lati (prodotto e categoria).
      l.products[1].categoryId = 'fantasma';
      l.languages = ['en'];
    });

    const errors = errorsOf(line);

    expect(errors.map((error) => error.where).sort()).toEqual(
      ['categories.0.productIds.1', 'languages', 'products.1.categoryId'].sort(),
    );
    expect(warningsOf(line)).toEqual([]);
  });

  it('warns on product without images', () => {
    const line = makeLine((l) => {
      l.products[1].images = [];
    });

    const issues = checkLine(line);

    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].message).toContain('Qubo');
    expect(issues[0].where).toBe('qubo');
  });

  it('warns on category without opening image', () => {
    const line = makeLine((l) => {
      l.categories[1].image = null;
    });

    const issues = checkLine(line);

    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe('warning');
    expect(issues[0].message).toContain('ACCESSORI');
    expect(issues[0].where).toBe('accessori');
  });

  it('still reports warnings when the schema check fails', () => {
    const line = makeLine((l) => {
      l.edition = 'bozza';
      l.products[0].images = [];
      l.categories[0].image = null;
    });

    expect(errorsOf(line)).toHaveLength(1);
    expect(warningsOf(line).map((warning) => warning.where)).toEqual(['prisma', 'copripalo']);
  });

  it('does not throw on malformed input', () => {
    expect(() => checkLine({} as LineData)).not.toThrow();
    expect(errorsOf({} as LineData).length).toBeGreaterThan(0);

    const broken = makeLine((l) => {
      (l.products[0] as { articles: unknown }).articles = undefined;
      (l.products[1] as { name: unknown }).name = undefined;
    });
    expect(() => checkLine(broken)).not.toThrow();
  });
});
