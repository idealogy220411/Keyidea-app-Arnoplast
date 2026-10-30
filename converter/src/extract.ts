import { ARTICLE_CODE_RE, MATERIALS, type LineId, type Material } from '@arnoplast/schema';
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
  /** Optional di fissaggio: nomi letti dall'elenco che segue l'intestazione «OPTIONAL DI FISSAGGIO» (testo, non codici). */
  fixingOptions: string[];
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

/** Confronto testuale senza badare a maiuscole/minuscole (il testo è già passato da `tidy`). */
const foldedEquals = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** «Modalità» in corso nel prodotto corrente, aperta da un'intestazione: decide dove vanno le righe `styles.entry`. */
type Mode = 'features' | 'dimensions' | undefined;

/** Titolo «puro» (stile `styles.product`, non un'intestazione) incontrato mentre un prodotto è già aperto: non si
 * sa ancora se è un nuovo prodotto o il nome di un optional di fissaggio del prodotto corrente. `owner` è il
 * prodotto aperto in quel momento: la decisione, per quanto rinviata, si applica sempre a quello, non a
 * qualunque prodotto sia `current` quando arriva (che nel frattempo può essere cambiato). */
type PendingTitle = { text: string; anchor: Anchor; where: string; owner: RawProduct };

/**
 * Estrae categorie, prodotti e articoli di una lingua dal documento IDML.
 * Ordine di lettura: spread in ordine; nello spread i frame di testo dall'alto in basso e da sinistra a destra;
 * ogni storia si legge una sola volta, dal suo primo frame.
 *
 * Nel file reale non esistono stili di paragrafo personalizzati, né uno stile dedicato per categorie e materiali:
 * il titolo di prodotto (e le intestazioni che gli somigliano) si riconoscono dallo stile di carattere
 * `styles.product`; le righe di caratteristiche/dimensioni dallo stile `styles.entry`, con il significato deciso
 * dall'ultima intestazione incontrata; categorie e materiali dal solo contenuto di un frame senza stile.
 */
export function extractLanguage(doc: IdmlDocument, config: ConverterConfig, lang: string, line: LineId): LanguageExtract {
  const categories: RawCategory[] = [];
  const products: RawProduct[] = [];
  const issues: Issue[] = [];
  const optionalPattern = new RegExp(config.optionalPattern, 'i');
  const readStories = new Set<string>();
  const { styles } = config;
  const categoryDefs = config.categories[line] ?? [];
  const matchCategory = (text: string) => categoryDefs.find((c) => c.name[lang] !== undefined && foldedEquals(c.name[lang], text));
  const featuresHeadingText = styles.featuresHeading[lang];
  const dimensionsHeadingText = styles.dimensionsHeading[lang];
  const optionalFixingHeadingText = styles.optionalFixingHeading[lang];

  let current: RawProduct | undefined;
  /** Categoria attiva: non necessariamente l'ultima pushata in `categories` (si può tornare a una già vista). */
  let activeCategory: RawCategory | undefined;
  let mode: Mode;
  /**
   * Titoli «puri» in attesa di una decisione (vedi `PendingTitle`) e se, da quando sono in sospeso, è comparsa
   * l'intestazione «OPTIONAL DI FISSAGGIO» (usato solo per un avviso, vedi sotto: non decide più da solo).
   * Due fatti, verificati sul file reale, decidono, in quest'ordine di priorità:
   * - una vera riga di caratteristica/dimensione o un bollino materiale: è sempre contenuto proprio di un
   *   prodotto (un optional di fissaggio è solo un nome, senza caratteristiche né materiale propri), quindi un
   *   titolo ancora in sospeso a questo punto è un nuovo prodotto vero e proprio;
   * - una **tabella**, un cambio di categoria, un cambio di pagina (un prodotto reale sta sempre su una sola
   *   pagina) o la fine del documento: a questo punto un titolo ancora in sospeso non ha mai avuto un
   *   contenuto proprio (altrimenti sarebbe già stato risolto dal punto sopra), quindi è un optional di
   *   fissaggio del prodotto aperto (vedi `owner`). Questo vale anche quando l'intestazione non è ancora
   *   comparsa, o non compare affatto: nel file reale non è garantito né l'ordine (nella pagina di Copripalo
   *   Prisma viene dopo le sue etichette) né la presenza (nella pagina di Copripalo Reno manca del tutto).
   */
  let pendingTitles: PendingTitle[] = [];
  let sawOptionalHeading = false;
  /**
   * Bollini materiale incontrati senza un prodotto corrente, in attesa del prossimo titolo. Caso reale: il
   * bollino sta, nella pagina, una frazione di punto più in alto del titolo che lo segue (0.4pt circa nel
   * file analizzato), quindi nell'ordine di lettura risulta prima del titolo anche se è chiaramente il
   * materiale di quel prodotto, non di quello (chiuso) della pagina precedente.
   */
  let pendingMaterials: Material[] = [];

  /** Apre un nuovo prodotto, applicandogli i bollini materiale eventualmente in attesa. */
  function openProduct(text: string, anchor: Anchor): RawProduct {
    const product: RawProduct = {
      name: text,
      categoryOrder: activeCategory!.order,
      materials: [...new Set(pendingMaterials)],
      features: [],
      dimensions: [],
      articles: [],
      optionalCodes: [],
      fixingOptions: [],
      anchor,
    };
    pendingMaterials = [];
    products.push(product);
    return product;
  }

  /** I titoli in sospeso diventano gli optional di fissaggio del loro prodotto (`owner`). */
  function pendingTitlesAreFixingOptions(): void {
    for (const { text, owner } of pendingTitles) owner.fixingOptions.push(text);
    pendingTitles = [];
    sawOptionalHeading = false;
  }

  /** I titoli in sospeso sono prodotti veri e propri, aperti in sequenza (l'ultimo resta quello corrente). */
  function pendingTitlesAreProducts(): void {
    for (const { text, anchor, where, owner } of pendingTitles) {
      // Lo stesso titolo ripetuto subito dopo (visto nel file reale, probabilmente una svista del grafico):
      // non è un secondo prodotto. Non tocca `mode`: se compare subito prima di «CARATTERISTICHE»/«DIMENSIONI»
      // (come nel file reale), il prodotto corrente resta lo stesso e il contenuto che segue va ancora letto.
      if (text === owner.name) continue;
      mode = undefined;
      if (activeCategory) {
        current = openProduct(text, anchor);
      } else {
        issues.push({ level: 'error', message: `Il prodotto ${quote(text)} compare prima della prima categoria: ignorato`, where });
      }
    }
    pendingTitles = [];
    sawOptionalHeading = false;
  }

  /** Risoluzione di riserva (cambio di categoria, cambio di pagina, fine documento): mai avuto contenuto proprio. */
  function resolvePendingTitles(): void {
    if (pendingTitles.length > 0) pendingTitlesAreFixingOptions();
    sawOptionalHeading = false;
  }

  /** Spread e pagina (dentro lo spread) del frame letto in precedenza: un cambio segna la fine di un prodotto. */
  let lastPageKey: string | undefined;

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

      const pageKey = `${spread.index}:${pageIndexAt(spread.pages, frame.bounds.x, frame.bounds.y)}`;
      if (lastPageKey !== undefined && pageKey !== lastPageKey) {
        resolvePendingTitles();
        current = undefined;
        mode = undefined;
        pendingMaterials = [];
      }
      lastPageKey = pageKey;

      for (const item of doc.stories.get(frame.storyId)?.items ?? []) {
        if (item.kind === 'table') {
          if (pendingTitles.length > 0) pendingTitlesAreFixingOptions();
          mode = undefined;
          if (current) readArticleTable(item.rows, current, config, optionalPattern, warn);
          else misplaced('Una tabella');
          continue;
        }

        const text = tidy(item.text);

        if (item.style === styles.product) {
          if (featuresHeadingText !== undefined && foldedEquals(text, featuresHeadingText)) {
            mode = 'features';
          } else if (dimensionsHeadingText !== undefined && foldedEquals(text, dimensionsHeadingText)) {
            mode = 'dimensions';
          } else if (optionalFixingHeadingText !== undefined && foldedEquals(text, optionalFixingHeadingText)) {
            sawOptionalHeading = true;
          } else if (current) {
            // Titolo «puro» mentre un prodotto è già aperto: ambiguo, si decide più avanti (vedi `PendingTitle`).
            pendingTitles.push({ text, anchor, where, owner: current });
          } else if (sawOptionalHeading) {
            // L'intestazione optional è comparsa ma non c'è nessun prodotto a cui attaccare l'etichetta.
            misplaced(`L'optional di fissaggio ${quote(text)}`);
            sawOptionalHeading = false;
          } else {
            // Primo titolo dopo una categoria (o dopo la tabella di un prodotto già risolto): non è ambiguo.
            mode = undefined;
            if (activeCategory) {
              current = openProduct(text, anchor);
            } else {
              issues.push({
                level: 'error',
                message: `Il prodotto ${quote(text)} compare prima della prima categoria: ignorato`,
                where,
              });
            }
          }
        } else if (item.style === styles.entry) {
          const entry = withoutBullet(text);
          if (entry === '') continue;
          // Una vera riga di caratteristica/dimensione è contenuto proprio di un prodotto: se ce n'era uno in
          // sospeso (vedi `PendingTitle`) è un nuovo prodotto vero e proprio, non un optional di fissaggio.
          if (pendingTitles.length > 0) pendingTitlesAreProducts();
          if (!current) {
            misplaced(`Il testo ${quote(entry)} (stile ${quote(item.style)})`);
          } else if (mode === 'features') {
            current.features.push(entry);
          } else if (mode === 'dimensions') {
            current.dimensions.push(entry);
          } else {
            warn(
              `Testo ${quote(entry)} in stile ${quote(item.style)} fuori dalle intestazioni ${quote(featuresHeadingText)}/${quote(dimensionsHeadingText)}: ignorato`,
            );
          }
        } else if (item.style === '') {
          const declared = matchCategory(text);
          if (declared) {
            const label = declared.name[lang] ?? text;
            if (activeCategory?.name !== label) {
              resolvePendingTitles();
              mode = undefined;
              current = undefined;
              pendingMaterials = [];
              // La categoria può ripresentarsi più avanti nel documento (per esempio è già comparsa nella
              // pagina indice, che precede tutti i prodotti): si riattiva quella già dichiarata invece di
              // crearne una seconda, spostando l'ancora sull'ultima comparsa.
              const existing = categories.find((c) => c.name === label);
              if (existing) {
                existing.anchor = anchor;
                activeCategory = existing;
              } else {
                activeCategory = { name: label, order: categories.length, anchor };
                categories.push(activeCategory);
              }
            }
          } else if (isMaterial(text)) {
            // Un bollino materiale è contenuto proprio di un prodotto: stessa logica delle righe sopra.
            if (pendingTitles.length > 0) pendingTitlesAreProducts();
            if (!current) pendingMaterials.push(text);
            else if (!current.materials.includes(text)) current.materials.push(text);
          }
        }
      }
    }
  }
  resolvePendingTitles();

  // Correzioni a mano: la chiave è il nome del prodotto in italiano.
  const forced = config.overrides?.materials ?? {};
  for (const product of products) {
    if (Object.hasOwn(forced, product.name)) product.materials = [...forced[product.name]];
  }

  return { lang, categories, products, issues };
}
