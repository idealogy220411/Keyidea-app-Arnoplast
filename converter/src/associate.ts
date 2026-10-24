import { posix } from 'node:path';
import type { ConverterConfig } from './config';
import type { Anchor, LanguageExtract, RawCategory, RawProduct } from './extract';
import { linkFileName } from './links';
import type { IdmlDocument, IdmlSpread, ImageFrame, Issue, Rect } from './types';

export type AttachedProduct = RawProduct & { imageLinks: string[]; drawingLinks: string[] };
export type AttachedCategory = RawCategory & { imageLink: string | null };
export type AttachedLanguage = Omit<LanguageExtract, 'products' | 'categories'> & {
  products: AttachedProduct[];
  categories: AttachedCategory[];
};

const quote = (value: unknown) => `«${String(value)}»`;

/** Pagina dello spread che contiene il punto; se nessuna lo contiene, la più vicina. */
function pageIndexAt(pages: Rect[], x: number, y: number): number {
  // Intervalli semiaperti: un punto sul bordo tra due pagine affiancate appartiene a quella di destra.
  const inside = pages.findIndex(
    (page) => x >= page.x && x < page.x + page.width && y >= page.y && y < page.y + page.height,
  );
  if (inside >= 0) return inside;

  let nearest = 0;
  let nearestDistance = Infinity;
  pages.forEach((page, index) => {
    const dx = Math.max(page.x - x, 0, x - (page.x + page.width));
    const dy = Math.max(page.y - y, 0, y - (page.y + page.height));
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

type ImagePlacement = { frame: ImageFrame; spread: IdmlSpread };

/** Aggiunge `value` all'elenco di `key`, creandolo se manca. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Ordine di lettura nella pagina: dall'alto in basso, a parità di altezza da sinistra a destra. */
const byReadingOrder = (a: ImagePlacement, b: ImagePlacement): number =>
  a.frame.bounds.y - b.frame.bounds.y || a.frame.bounds.x - b.frame.bounds.x;

const area = ({ frame }: ImagePlacement): number => frame.bounds.width * frame.bounds.height;

/** Indice del prodotto con il titolo più vicino sopra `y` (a parità, il primo); se nessuno è sopra, il primo. */
function productAbove(candidates: number[], products: RawProduct[], y: number): number {
  let best: number | undefined;
  for (const index of candidates) {
    const titleY = products[index].anchor.y;
    if (titleY <= y && (best === undefined || titleY > products[best].anchor.y)) best = index;
  }
  return best ?? candidates[0];
}

/**
 * Associa i frame immagine ai prodotti e alle categorie, pagina per pagina (le pagine di uno spread
 * affiancato contengono prodotti diversi). Pagine in ordine di lettura: quelle dello spread, poi lo spread dopo.
 *
 * - Pagina con un titolo di categoria e nessun titolo di prodotto (pagina di apertura): l'immagine più grande
 *   è l'immagine della categoria; le altre immagini della pagina non si associano a nessun prodotto.
 * - Pagina con titoli di prodotto: ogni immagine va al titolo più vicino sopra il suo centro, o al primo titolo.
 * - Altre pagine: le immagini proseguono il prodotto precedente. Una pagina di apertura interrompe la
 *   continuazione; le immagini senza prodotto a cui andare si scartano con un avviso.
 */
export function attachImages(doc: IdmlDocument, extract: LanguageExtract, config: ConverterConfig): AttachedLanguage {
  const drawingExtensions = new Set(config.drawingExtensions.map((extension) => extension.toLowerCase()));
  const isDrawing = (linkUri: string): boolean =>
    drawingExtensions.has(posix.extname(linkFileName(linkUri)).toLowerCase());

  // Pagine di ogni spread e numero d'ordine della prima; immagini di ogni pagina.
  const layouts = new Map<number, { pages: Rect[]; first: number }>();
  const imagesByPage = new Map<number, ImagePlacement[]>();
  let pageCount = 0;
  for (const spread of doc.spreads) {
    layouts.set(spread.index, { pages: spread.pages, first: pageCount });
    for (const frame of spread.frames) {
      if (frame.kind !== 'image') continue;
      const { x, y, width, height } = frame.bounds;
      push(imagesByPage, pageCount + pageIndexAt(spread.pages, x + width / 2, y + height / 2), { frame, spread });
    }
    pageCount += Math.max(1, spread.pages.length);
  }
  for (const images of imagesByPage.values()) images.sort(byReadingOrder);

  const pageOfAnchor = ({ spreadIndex, x, y }: Anchor): number | undefined => {
    const layout = layouts.get(spreadIndex);
    return layout && layout.first + pageIndexAt(layout.pages, x, y);
  };

  // Prodotti di ogni pagina, in ordine di lettura.
  const productsByPage = new Map<number, number[]>();
  extract.products.forEach((product, index) => {
    const page = pageOfAnchor(product.anchor);
    if (page !== undefined) push(productsByPage, page, index);
  });

  // Categorie su una pagina senza prodotti: l'immagine più grande della pagina è la loro immagine.
  const openerPages = new Set<number>();
  const categories: AttachedCategory[] = extract.categories.map((category) => {
    const page = pageOfAnchor(category.anchor);
    if (page === undefined || productsByPage.has(page)) return { ...category, imageLink: null };
    openerPages.add(page);
    let largest: ImagePlacement | undefined;
    for (const placement of imagesByPage.get(page) ?? []) {
      if (!largest || area(placement) > area(largest)) largest = placement;
    }
    return { ...category, imageLink: largest?.frame.linkUri ?? null };
  });

  const products: AttachedProduct[] = extract.products.map((product) => ({
    ...product,
    imageLinks: [],
    drawingLinks: [],
  }));
  const issues: Issue[] = [...extract.issues];
  const attach = (index: number, linkUri: string): void => {
    (isDrawing(linkUri) ? products[index].drawingLinks : products[index].imageLinks).push(linkUri);
  };

  // Ultimo prodotto delle pagine già lette: le pagine senza titoli ne continuano le immagini.
  let previous: number | undefined;
  for (let page = 0; page < pageCount; page++) {
    const here = productsByPage.get(page);
    const images = imagesByPage.get(page) ?? [];
    if (here) {
      for (const { frame } of images) {
        const centerY = frame.bounds.y + frame.bounds.height / 2;
        attach(productAbove(here, extract.products, centerY), frame.linkUri);
      }
      previous = here.at(-1);
    } else if (openerPages.has(page)) {
      previous = undefined;
    } else {
      for (const { frame, spread } of images) {
        if (previous !== undefined) {
          attach(previous, frame.linkUri);
        } else {
          issues.push({
            level: 'warning',
            message: `L'immagine ${quote(linkFileName(frame.linkUri))} compare prima del titolo di un prodotto: ignorata`,
            where: `spread ${spread.index + 1}`,
          });
        }
      }
    }
  }

  return { ...extract, products, categories, issues };
}
