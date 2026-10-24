import { REFERENCE_LANG, type LocalizedList, type LocalizedText, type Material } from '@arnoplast/schema';
import type { AttachedLanguage, AttachedProduct } from './associate';
import type { Issue } from './types';

export type MergedArticle = {
  code: string;
  description: LocalizedText;
  perPack: number | null;
  perBox: number | null;
  perPallet: number | null;
};

export type MergedProduct = {
  id: string;
  categoryId: string;
  name: LocalizedText;
  materials: Material[];
  features: LocalizedList;
  dimensions: LocalizedList;
  articles: MergedArticle[];
  optionalCodes: string[];
  imageLinks: string[];
  drawingLinks: string[];
};

export type MergedCategory = {
  id: string;
  name: LocalizedText;
  order: number;
  imageLink: string | null;
  productIds: string[];
};

export type MergedLine = {
  languages: string[];
  categories: MergedCategory[];
  products: MergedProduct[];
  issues: Issue[];
};

/** Minuscole, senza accenti, ogni gruppo di caratteri diversi da lettere e cifre diventa un `-`, senza `-` ai bordi. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Primo identificativo libero tra `base`, `base-2`, `base-3`...; lo segna come usato. */
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/** Il valore più frequente; a parità, il primo comparso. */
function mostFrequent(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

type Matching = {
  /** Prodotto della lingua per indice del prodotto italiano che gli corrisponde. */
  matched: Map<number, AttachedProduct>;
  /** Prodotti della lingua senza corrispondenza, nell'ordine di lettura. */
  unmatched: AttachedProduct[];
};

/**
 * Abbina i prodotti di una lingua a quelli italiani: ognuno va al prodotto italiano con cui condivide più codici
 * articolo (a parità, il primo). Se più prodotti vanno allo stesso italiano, resta quello con più codici in
 * comune (a parità, il primo); gli altri restano senza corrispondenza.
 */
function matchProducts(italian: AttachedProduct[], foreign: AttachedProduct[]): Matching {
  const italianCodes = italian.map((product) => new Set(product.articles.map((article) => article.code)));
  const winners = new Map<number, { index: number; shared: number }>();
  const unmatched = new Set<number>();

  foreign.forEach((product, index) => {
    const codes = new Set(product.articles.map((article) => article.code));
    let target = -1;
    let shared = 0;
    italianCodes.forEach((candidate, italianIndex) => {
      const count = [...codes].filter((code) => candidate.has(code)).length;
      if (count > shared) {
        target = italianIndex;
        shared = count;
      }
    });

    if (target < 0) {
      unmatched.add(index);
      return;
    }
    const current = winners.get(target);
    if (current === undefined) {
      winners.set(target, { index, shared });
    } else if (shared > current.shared) {
      unmatched.add(current.index);
      winners.set(target, { index, shared });
    } else {
      unmatched.add(index);
    }
  });

  return {
    matched: new Map([...winners].map(([italianIndex, { index }]) => [italianIndex, foreign[index]])),
    unmatched: [...unmatched].sort((a, b) => a - b).map((index) => foreign[index]),
  };
}

/**
 * Unisce le estrazioni delle lingue in una sola linea. L'italiano dà struttura, ordine, numeri, materiali,
 * optional e immagini; le altre lingue aggiungono nomi, caratteristiche, dimensioni e descrizioni degli articoli
 * dei prodotti abbinati per codice. Dove una traduzione manca la chiave della lingua non c'è: l'app usa l'italiano.
 */
export function mergeLanguages(perLang: AttachedLanguage[]): MergedLine {
  const italian = perLang.find((entry) => entry.lang === REFERENCE_LANG);
  if (!italian) {
    throw new Error(`Manca la lingua di riferimento italiano («${REFERENCE_LANG}»): impossibile unire le lingue`);
  }
  const foreign = perLang.filter((entry) => entry !== italian);

  const takenCategoryIds = new Set<string>();
  const categories: MergedCategory[] = italian.categories.map((category) => ({
    id: uniqueId(slugify(category.name) || 'categoria', takenCategoryIds),
    name: { [REFERENCE_LANG]: category.name },
    order: category.order,
    imageLink: category.imageLink,
    productIds: [],
  }));
  const categoryByOrder = new Map(categories.map((category) => [category.order, category]));

  const takenProductIds = new Set<string>();
  const products: MergedProduct[] = italian.products.map((product) => {
    // L'estrazione assegna sempre una categoria: i prodotti prima della prima categoria vengono scartati.
    const category = categoryByOrder.get(product.categoryOrder)!;
    const id = uniqueId(slugify(product.name) || 'prodotto', takenProductIds);
    category.productIds.push(id);
    return {
      id,
      categoryId: category.id,
      name: { [REFERENCE_LANG]: product.name },
      materials: [...product.materials],
      features: { [REFERENCE_LANG]: [...product.features] },
      dimensions: { [REFERENCE_LANG]: [...product.dimensions] },
      articles: product.articles.map((article) => ({
        code: article.code,
        description: { [REFERENCE_LANG]: article.description },
        perPack: article.perPack,
        perBox: article.perBox,
        perPallet: article.perPallet,
      })),
      optionalCodes: [...product.optionalCodes],
      imageLinks: [...product.imageLinks],
      drawingLinks: [...product.drawingLinks],
    };
  });

  const warnings: Issue[] = [];
  for (const { lang, categories: foreignCategories, products: foreignProducts } of foreign) {
    const warn = (message: string): void => {
      warnings.push({ level: 'warning', message, where: lang });
    };
    const { matched, unmatched } = matchProducts(italian.products, foreignProducts);
    for (const product of unmatched) warn(`prodotto presente solo in ${lang}: ${product.name}`);

    const foreignCategoryNames = new Map(foreignCategories.map((category) => [category.order, category.name]));
    const categoryNames = new Map<number, string[]>();

    italian.products.forEach((italianProduct, index) => {
      const match = matched.get(index);
      if (!match) {
        warn(`traduzione mancante (${lang}): ${italianProduct.name}`);
        return;
      }

      const merged = products[index];
      merged.name[lang] = match.name;
      merged.features[lang] = [...match.features];
      merged.dimensions[lang] = [...match.dimensions];

      // Se un codice si ripete nel prodotto straniero vale la prima riga.
      const descriptions = new Map<string, string>();
      for (const article of match.articles) {
        if (!descriptions.has(article.code)) descriptions.set(article.code, article.description);
      }
      for (const article of merged.articles) {
        const description = descriptions.get(article.code);
        if (description !== undefined) article.description[lang] = description;
      }

      const categoryName = foreignCategoryNames.get(match.categoryOrder);
      if (categoryName !== undefined) {
        const names = categoryNames.get(italianProduct.categoryOrder) ?? [];
        names.push(categoryName);
        categoryNames.set(italianProduct.categoryOrder, names);
      }
    });

    for (const category of categories) {
      const name = mostFrequent(categoryNames.get(category.order) ?? []);
      if (name !== undefined) category.name[lang] = name;
    }
  }

  // Prima gli avvisi delle estrazioni (italiano in testa), con la lingua davanti al punto di origine; poi i nostri.
  const issues: Issue[] = [italian, ...foreign].flatMap(({ lang, issues: langIssues }) =>
    langIssues.map((issue) => ({ ...issue, where: issue.where ? `${lang}: ${issue.where}` : lang })),
  );

  return {
    languages: [italian.lang, ...foreign.map((entry) => entry.lang)],
    categories,
    products,
    issues: [...issues, ...warnings],
  };
}
