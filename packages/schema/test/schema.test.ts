import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseIndex, parseLineData } from '../src/index';

type Json = Record<string, any>;

function article(code: string): Json {
  return {
    code,
    description: { it: `Articolo ${code}` },
    perPack: 10,
    perBox: 100,
    perPallet: 1000,
  };
}

function validProduct(id = 'agricoltura/copripalo-prisma', categoryId = 'agricoltura/copripali'): Json {
  return {
    id,
    categoryId,
    name: { it: 'Copripalo Prisma' },
    materials: ['PE'],
    features: { it: ['Resistente ai raggi UV'] },
    dimensions: { it: ['7x7 cm'] },
    images: [{ thumb: 'img/ab12-400.webp', detail: 'img/ab12-1600.webp', width: 1600, height: 1200 }],
    drawings: [],
    videoUrl: null,
    optionalCodes: [],
    articles: [article('1807-1351')],
  };
}

function validLine(): Json {
  return {
    format: 1,
    line: 'agricoltura',
    edition: '2026.1',
    languages: ['it', 'en'],
    name: { it: 'Agricoltura', en: 'Agriculture' },
    categories: [
      {
        id: 'agricoltura/copripali',
        name: { it: 'Copripali' },
        order: 1,
        image: null,
        productIds: ['agricoltura/copripalo-prisma'],
      },
    ],
    products: [validProduct()],
  };
}

function validIndex(previous: string[] = []): Json {
  return {
    format: 1,
    generatedAt: '2026-10-24T12:00:00.000Z',
    contacts: { email: 'info@example.com', whatsapp: '390000000000' },
    lines: {
      agricoltura: {
        edition: '2026.7',
        path: 'agricoltura/2026.7/data.json',
        sha256: 'a'.repeat(64),
        publishedAt: '2026-10-24T12:00:00.000Z',
        previous,
      },
    },
  };
}

function errorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    return (error as ZodError).issues.map((issue) => issue.message).join('\n');
  }
  throw new Error('Expected the call to throw a ZodError');
}

describe('parseLineData', () => {
  it('accepts a valid line', () => {
    const line = parseLineData(validLine());
    expect(line.edition).toBe('2026.1');
  });

  it('requires italian in localized text', () => {
    const line = validLine();
    line.name = { en: 'X' };
    expect(() => parseLineData(line)).toThrow(ZodError);
  });

  it('rejects bad article code', () => {
    const line = validLine();
    line.products[0].articles[0].code = '1807-135';
    expect(errorMessage(() => parseLineData(line))).toContain('1807-135');
  });

  it('accepts suffixed codes', () => {
    const line = validLine();
    line.products[0].articles = [article('1807-1310GZ'), article('1807-0308GR')];
    expect(parseLineData(line).products[0]?.articles).toHaveLength(2);
  });

  it('rejects product without articles', () => {
    const line = validLine();
    line.products[0].articles = [];
    expect(() => parseLineData(line)).toThrow(ZodError);
  });

  it('rejects unknown material', () => {
    const line = validLine();
    line.products[0].materials = ['ABS'];
    expect(() => parseLineData(line)).toThrow(ZodError);
  });

  it('rejects dangling category reference', () => {
    const line = validLine();
    line.categories[0].productIds = ['inesistente'];
    expect(errorMessage(() => parseLineData(line))).toContain('inesistente');
  });

  it('rejects duplicate code within one product', () => {
    const line = validLine();
    line.products[0].articles = [article('1807-1351'), article('1807-1351')];
    expect(errorMessage(() => parseLineData(line))).toContain('1807-1351');
  });

  it('accepts same code in two products', () => {
    const line = validLine();
    line.products[0].articles = [article('1807-1351'), article('1807-0751')];
    const second = validProduct('agricoltura/copripalo-qubo');
    second.name = { it: 'Copripalo Qubo' };
    second.articles = [article('1807-0751')];
    line.products.push(second);
    line.categories[0].productIds.push(second.id);
    expect(parseLineData(line).products).toHaveLength(2);
  });

  it('rejects non-youtube-like url', () => {
    const line = validLine();
    line.products[0].videoUrl = 'ftp://x';
    expect(() => parseLineData(line)).toThrow(ZodError);
  });

  it('accepts an https video url', () => {
    const line = validLine();
    line.products[0].videoUrl = 'https://youtu.be/abc123';
    expect(parseLineData(line).products[0]?.videoUrl).toBe('https://youtu.be/abc123');
  });

  it('rejects duplicate product ids', () => {
    const line = validLine();
    line.products.push(validProduct());
    expect(errorMessage(() => parseLineData(line))).toContain('agricoltura/copripalo-prisma');
  });

  it('rejects duplicate category ids', () => {
    const line = validLine();
    line.categories.push({ ...line.categories[0], productIds: [] });
    expect(errorMessage(() => parseLineData(line))).toContain('agricoltura/copripali');
  });

  it('rejects product with unknown category', () => {
    const line = validLine();
    line.products[0].categoryId = 'agricoltura/altra';
    expect(errorMessage(() => parseLineData(line))).toContain('agricoltura/altra');
  });

  it('rejects product missing from its category', () => {
    const line = validLine();
    line.categories[0].productIds = [];
    expect(errorMessage(() => parseLineData(line))).toContain('agricoltura/copripalo-prisma');
  });

  it('rejects languages without italian', () => {
    const line = validLine();
    line.languages = ['en'];
    expect(() => parseLineData(line)).toThrow(ZodError);
  });
});

describe('parseIndex', () => {
  it('accepts a valid index', () => {
    const five = ['2026.6', '2026.5', '2026.4', '2026.3', '2026.2'];
    const index = parseIndex(validIndex(five));
    expect(index.lines.agricoltura?.previous).toHaveLength(5);

    const six = [...five, '2026.1'];
    expect(() => parseIndex(validIndex(six))).toThrow(ZodError);
  });
});
