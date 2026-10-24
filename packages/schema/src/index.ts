import { z } from 'zod';

// Identifiers and formats shared by the converter and the app.

export const LINE_IDS = ['agricoltura', 'garden', 'olive'] as const;
export type LineId = (typeof LINE_IDS)[number];

export const MATERIALS = ['FE', 'FV', 'PA', 'PET', 'PE', 'PP', 'PVC'] as const;
export type Material = (typeof MATERIALS)[number];

export const ARTICLE_CODE_RE = /^\d{4}-\d{4}[A-Z]{0,3}$/;
export const EDITION_RE = /^\d{4}\.\d+$/;
export const LANG_RE = /^[a-z]{2}$/;
export const REFERENCE_LANG = 'it';

export const MAX_PREVIOUS_EDITIONS = 5;

// Checked with a regular expression instead of `z.url()`: zod's URL check relies on
// the `URL` class, which React Native implements only partially.
const HTTP_URL_RE = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

const quote = (value: unknown) => `«${String(value)}»`;

function localized<T extends z.ZodType>(valueSchema: T) {
  return z.record(z.string(), valueSchema).superRefine((record, ctx) => {
    for (const lang of Object.keys(record)) {
      if (!LANG_RE.test(lang)) {
        ctx.addIssue({
          code: 'custom',
          path: [lang],
          message: `Codice lingua non valido: ${quote(lang)} (servono due lettere minuscole, per esempio «en»)`,
        });
      }
    }
    if (!Object.hasOwn(record, REFERENCE_LANG)) {
      ctx.addIssue({
        code: 'custom',
        message: `Manca il testo nella lingua di riferimento ${quote(REFERENCE_LANG)}`,
      });
    }
  });
}

const localizedTextSchema = localized(z.string());
const localizedListSchema = localized(z.array(z.string()));

const articleCodeSchema = z.string().regex(ARTICLE_CODE_RE, {
  error: (issue) =>
    `Codice articolo non valido: ${quote(issue.input)} (servono 4 cifre, un trattino, 4 cifre ed eventuali lettere maiuscole, per esempio 1807-1351)`,
});

const editionSchema = z.string().regex(EDITION_RE, {
  error: (issue) => `Edizione non valida: ${quote(issue.input)} (formato atteso anno.numero, per esempio 2026.1)`,
});

const languageSchema = z.string().regex(LANG_RE, {
  error: (issue) => `Codice lingua non valido: ${quote(issue.input)} (servono due lettere minuscole, per esempio «en»)`,
});

const lineIdSchema = z.enum(LINE_IDS, {
  error: (issue) => `Linea sconosciuta: ${quote(issue.input)} (ammesse: ${LINE_IDS.join(', ')})`,
});

const materialSchema = z.enum(MATERIALS, {
  error: (issue) => `Materiale sconosciuto: ${quote(issue.input)} (ammessi: ${MATERIALS.join(', ')})`,
});

const httpUrlSchema = z.string().regex(HTTP_URL_RE, {
  error: (issue) => `Indirizzo non valido: ${quote(issue.input)} (sono ammessi solo indirizzi http o https)`,
});

const isoDateTimeSchema = z.iso.datetime({ offset: true });

const imageRefSchema = z.object({
  thumb: z.string().min(1),
  detail: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const quantitySchema = z.number().int().positive().nullable();

const articleSchema = z.object({
  code: articleCodeSchema,
  description: localizedTextSchema,
  perPack: quantitySchema,
  perBox: quantitySchema,
  perPallet: quantitySchema,
});

const productSchema = z
  .object({
    id: z.string().min(1),
    categoryId: z.string().min(1),
    name: localizedTextSchema,
    materials: z.array(materialSchema),
    features: localizedListSchema,
    dimensions: localizedListSchema,
    images: z.array(imageRefSchema),
    drawings: z.array(imageRefSchema),
    videoUrl: httpUrlSchema.nullable(),
    optionalCodes: z.array(articleCodeSchema),
    articles: z.array(articleSchema),
  })
  .superRefine((product, ctx) => {
    if (product.articles.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['articles'],
        message: `Il prodotto ${quote(product.id)} non ha articoli`,
      });
    }
    const seen = new Set<string>();
    product.articles.forEach((article, index) => {
      if (seen.has(article.code)) {
        ctx.addIssue({
          code: 'custom',
          path: ['articles', index, 'code'],
          message: `Codice articolo ${quote(article.code)} ripetuto nel prodotto ${quote(product.id)}`,
        });
      }
      seen.add(article.code);
    });
  });

const categorySchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  order: z.number().int(),
  image: imageRefSchema.nullable(),
  productIds: z.array(z.string().min(1)),
});

export const lineDataSchema = z
  .object({
    format: z.literal(1),
    line: lineIdSchema,
    edition: editionSchema,
    languages: z.array(languageSchema).refine((languages) => languages.includes(REFERENCE_LANG), {
      error: `L'elenco delle lingue deve contenere la lingua di riferimento ${quote(REFERENCE_LANG)}`,
    }),
    name: localizedTextSchema,
    categories: z.array(categorySchema),
    products: z.array(productSchema),
  })
  .superRefine((line, ctx) => {
    const categoriesById = new Map<string, (typeof line.categories)[number]>();
    line.categories.forEach((category, index) => {
      if (categoriesById.has(category.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['categories', index, 'id'],
          message: `Identificativo di categoria ripetuto: ${quote(category.id)}`,
        });
      } else {
        categoriesById.set(category.id, category);
      }
    });

    const productsById = new Map<string, (typeof line.products)[number]>();
    line.products.forEach((product, index) => {
      if (productsById.has(product.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['products', index, 'id'],
          message: `Identificativo di prodotto ripetuto: ${quote(product.id)}`,
        });
      } else {
        productsById.set(product.id, product);
      }
    });

    line.products.forEach((product, index) => {
      const category = categoriesById.get(product.categoryId);
      if (!category) {
        ctx.addIssue({
          code: 'custom',
          path: ['products', index, 'categoryId'],
          message: `Il prodotto ${quote(product.id)} fa riferimento alla categoria inesistente ${quote(product.categoryId)}`,
        });
      } else if (!category.productIds.includes(product.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['products', index, 'categoryId'],
          message: `Il prodotto ${quote(product.id)} non è elencato nella sua categoria ${quote(category.id)}`,
        });
      }
    });

    line.categories.forEach((category, categoryIndex) => {
      category.productIds.forEach((productId, productIndex) => {
        const product = productsById.get(productId);
        const path = ['categories', categoryIndex, 'productIds', productIndex];
        if (!product) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `La categoria ${quote(category.id)} elenca il prodotto inesistente ${quote(productId)}`,
          });
        } else if (product.categoryId !== category.id) {
          ctx.addIssue({
            code: 'custom',
            path,
            message: `La categoria ${quote(category.id)} elenca il prodotto ${quote(productId)}, che appartiene alla categoria ${quote(product.categoryId)}`,
          });
        }
      });
    });
  });

const lineEntrySchema = z.object({
  edition: editionSchema,
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, {
    error: (issue) => `Impronta sha256 non valida: ${quote(issue.input)} (servono 64 caratteri esadecimali minuscoli)`,
  }),
  publishedAt: isoDateTimeSchema,
  previous: z.array(editionSchema).max(MAX_PREVIOUS_EDITIONS, {
    error: `Al massimo ${MAX_PREVIOUS_EDITIONS} edizioni precedenti`,
  }),
});

export const indexSchema = z.object({
  format: z.literal(1),
  generatedAt: isoDateTimeSchema,
  contacts: z.object({
    email: z.string().min(1),
    whatsapp: z.string().min(1),
  }),
  lines: z.partialRecord(lineIdSchema, lineEntrySchema),
});

export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type LocalizedList = z.infer<typeof localizedListSchema>;
export type ImageRef = z.infer<typeof imageRefSchema>;
export type Article = z.infer<typeof articleSchema>;
export type Product = z.infer<typeof productSchema>;
export type Category = z.infer<typeof categorySchema>;
export type LineData = z.infer<typeof lineDataSchema>;
export type LineEntry = z.infer<typeof lineEntrySchema>;
export type IndexFile = z.infer<typeof indexSchema>;

/** Validates a line data file. Throws a `ZodError` if the data is not valid. */
export function parseLineData(json: unknown): LineData {
  return lineDataSchema.parse(json);
}

/** Validates the index file. Throws a `ZodError` if the data is not valid. */
export function parseIndex(json: unknown): IndexFile {
  return indexSchema.parse(json);
}
