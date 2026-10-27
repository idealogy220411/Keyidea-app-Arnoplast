import { ARTICLE_CODE_RE, MATERIALS, type Material } from '@arnoplast/schema';
import type { ConverterConfig } from './config';
import { pageIndexAt } from './pages';
import type { IdmlDocument, IdmlSpread, Issue, TextFrame } from './types';

export type RawArticle = {
  code: string;
  description: string;
  perPack: number | null;
  perBox: number | null;
  perPallet: number | null;
};

/** Posizione del frame di testo che contiene il titolo (angolo in alto a sinistra, coordinate dello spread). */
export type Anchor = { spreadIndex: number; x: number; y: number };

export type RawProduct = {
  name: string;
  categoryOrder: number;
  materials: Material[];
  features: string[];
  dimensions: string[];
  articles: RawArticle[];
  optionalCodes: string[];
  anchor: Anchor;
};

export type RawCategory = { name: string; order: number; anchor: Anchor };

export type LanguageExtract = {
  lang: string;
  categories: RawCategory[];
  products: RawProduct[];
  issues: Issue[];
};

/** Intestazioni della colonna dei codici nelle lingue del catalogo (confronto senza maiuscole). */
const CODE_HEADINGS = new Set(['COD.', 'CODE', 'CÓDIGO', 'CODICE']);

/** Nome con cui le colonne delle quantità compaiono nei messaggi. */
const QUANTITY_LABELS = { perPack: 'confezione', perBox: 'imballo', perPallet: 'pallet' } as const;
type QuantityColumn = keyof typeof QUANTITY_LABELS;

const quote = (value: unknown) => `«${String(value)}»`;

/** Spazi (anche a-capo forzati e spazi non divisibili) ridotti a uno solo, senza spazi ai bordi. */
const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Toglie il punto elenco iniziale: `•` e `▪` sempre, `-` solo se seguito da uno spazio (`-30°C` resta). */
const withoutBullet = (text: string): string => text.replace(/^(?:[•▪]\s*|-\s+)/, '');

const isMaterial = (text: string): text is Material => (MATERIALS as readonly string[]).includes(text);

/**
 * Frame di testo dello spread in ordine di lettura: prima la pagina che contiene l'angolo in alto a sinistra del
 * frame (le pagine affiancate di uno spread contengono prodotti diversi: un titolo più in basso sulla pagina
 * sinistra non deve venire dopo uno più in alto sulla pagina destra), poi dall'alto in basso, poi da sinistra
 * a destra.
 */
function readingOrder(spread: IdmlSpread): TextFrame[] {
  return spread.frames
    .filter((frame): frame is TextFrame => frame.kind === 'text')
    .sort((a, b) => {
      const pageA = pageIndexAt(spread.pages, a.bounds.x, a.bounds.y);
      const pageB = pageIndexAt(spread.pages, b.bounds.x, b.bounds.y);
      return pageA - pageB || a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x;
    });
}

type Quantity = { value: number | null; problem: 'non numerico' | 'zero' | null };

/** `-`, `–` e cella vuota: assente. Numeri interi, anche con i punti delle migliaia (`1.024`). */
function parseQuantity(cell: string): Quantity {
  const text = tidy(cell);
  if (text === '' || text === '-' || text === '–') return { value: null, problem: null };
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text)) return { value: null, problem: 'non numerico' };
  const value = Number(text.replaceAll('.', ''));
  // Lo schema vuole interi positivi: 0 non è una quantità valida.
  return value > 0 ? { value, problem: null } : { value: null, problem: 'zero' };
}

/** Legge le righe di una tabella articoli e le aggiunge al prodotto. */
function readArticleTable(
  rows: string[][],
  product: RawProduct,
  config: ConverterConfig,
  optionalPattern: RegExp,
  warn: (message: string) => void,
): void {
  const columns = config.articleColumns;
  const cellOf = (row: string[], column: ConverterConfig['articleColumns'][number]): string => {
    const index = columns.indexOf(column);
    return index < 0 ? '' : tidy(row[index] ?? '');
  };

  /** Vero se la cella è un numero (con o senza i punti delle migliaia): non conta `-`, `–` o vuota. */
  const isNumericCell = (cell: string): boolean => {
    const text = tidy(cell);
    return text !== '' && text !== '-' && text !== '–' && /^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(text);
  };

  for (const row of rows) {
    const code = cellOf(row, 'code');
    if (!ARTICLE_CODE_RE.test(code)) {
      if (code === '') {
        const description = cellOf(row, 'description');
        const hasContent =
          description !== '' ||
          (Object.keys(QUANTITY_LABELS) as QuantityColumn[]).some((column) => isNumericCell(cellOf(row, column)));
        if (hasContent) warn(`riga della tabella senza codice ignorata: ${quote(description)}`);
      } else if (!CODE_HEADINGS.has(code.normalize('NFC').toUpperCase())) {
        warn(`Riga della tabella saltata nel prodotto ${quote(product.name)}: ${quote(code)} non è un codice articolo`);
      }
      continue;
    }

    const description = cellOf(row, 'description');
    const article: RawArticle = { code, description, perPack: null, perBox: null, perPallet: null };
    for (const column of Object.keys(QUANTITY_LABELS) as QuantityColumn[]) {
      const cell = cellOf(row, column);
      const { value, problem } = parseQuantity(cell);
      article[column] = value;
      if (problem) {
        const place = `nella colonna ${quote(QUANTITY_LABELS[column])} dell'articolo ${code} (prodotto ${quote(product.name)})`;
        warn(
          problem === 'zero'
            ? `Quantità 0 ${place}: trattata come assente`
            : `Valore non numerico ${quote(cell)} ${place}: trattato come assente`,
        );
      }
    }
    product.articles.push(article);
    if (optionalPattern.test(description) && !product.optionalCodes.includes(code)) {
      product.optionalCodes.push(code);
    }
  }
}

/**
 * Estrae categorie, prodotti e articoli di una lingua dal documento IDML.
 * Ordine di lettura: spread in ordine; nello spread i frame di testo dall'alto in basso e da sinistra a destra;
 * ogni storia si legge una sola volta, dal suo primo frame.
 */
export function extractLanguage(doc: IdmlDocument, config: ConverterConfig, lang: string): LanguageExtract {
  const categories: RawCategory[] = [];
  const products: RawProduct[] = [];
  const issues: Issue[] = [];
  const optionalPattern = new RegExp(config.optionalPattern, 'i');
  const readStories = new Set<string>();
  const { styles } = config;
  let current: RawProduct | undefined;

  for (const spread of doc.spreads) {
    const where = `spread ${spread.index + 1}`;
    const warn = (message: string): void => {
      issues.push({ level: 'warning', message, where });
    };
    const misplaced = (what: string): void => warn(`${what} compare prima del titolo di un prodotto: ignorato`);

    for (const frame of readingOrder(spread)) {
      if (readStories.has(frame.storyId)) continue;
      readStories.add(frame.storyId);
      const anchor: Anchor = { spreadIndex: spread.index, x: frame.bounds.x, y: frame.bounds.y };

      for (const item of doc.stories.get(frame.storyId)?.items ?? []) {
        if (item.kind === 'table') {
          if (current) readArticleTable(item.rows, current, config, optionalPattern, warn);
          else misplaced('Una tabella');
          continue;
        }

        const text = tidy(item.text);
        if (item.style === styles.category) {
          categories.push({ name: text, order: categories.length, anchor });
          current = undefined;
        } else if (item.style === styles.product) {
          const category = categories.at(-1);
          if (category) {
            current = {
              name: text,
              categoryOrder: category.order,
              materials: [],
              features: [],
              dimensions: [],
              articles: [],
              optionalCodes: [],
              anchor,
            };
            products.push(current);
          } else {
            current = undefined;
            issues.push({
              level: 'error',
              message: `Il prodotto ${quote(text)} compare prima della prima categoria: ignorato`,
              where,
            });
          }
        } else if (item.style === styles.feature || item.style === styles.dimension) {
          const entry = withoutBullet(text);
          if (entry === '') continue;
          if (!current) misplaced(`Il testo ${quote(entry)} (stile ${quote(item.style)})`);
          else (item.style === styles.feature ? current.features : current.dimensions).push(entry);
        } else if (item.style === styles.material) {
          if (!current) misplaced(`Il bollino ${quote(text)}`);
          else if (!isMaterial(text)) warn(`Materiale sconosciuto ${quote(text)} nel prodotto ${quote(current.name)}`);
          else if (!current.materials.includes(text)) current.materials.push(text);
        }
      }
    }
  }

  // Correzioni a mano: la chiave è il nome del prodotto in italiano.
  const forced = config.overrides?.materials ?? {};
  for (const product of products) {
    if (Object.hasOwn(forced, product.name)) product.materials = [...forced[product.name]];
  }

  return { lang, categories, products, issues };
}
