import { REFERENCE_LANG, lineDataSchema, type LineData, type Product } from '@arnoplast/schema';
import type { Issue } from './types';

const quote = (value: string) => `«${value}»`;

/** L'ingresso è tipato `LineData`, ma qui può arrivare un file malformato: un elenco mancante conta come vuoto. */
const listOf = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : []);

/** Nome italiano per i messaggi; se manca, l'identificativo. */
const labelOf = (name: Record<string, string> | undefined, id: string): string => name?.[REFERENCE_LANG] ?? id;

/** Stesso codice in prodotti diversi con descrizioni italiane diverse: un avviso per codice. */
function sharedCodeWarnings(products: Product[]): Issue[] {
  const byCode = new Map<string, Array<{ product: Product; description: string }>>();
  for (const product of products) {
    for (const article of listOf(product.articles)) {
      const uses = byCode.get(article.code) ?? [];
      // Un codice ripetuto nello stesso prodotto è già un errore dello schema: qui conta il prodotto una volta sola.
      if (!uses.some((use) => use.product === product)) {
        uses.push({ product, description: (article.description?.[REFERENCE_LANG] ?? '').trim() });
      }
      byCode.set(article.code, uses);
    }
  }

  const issues: Issue[] = [];
  for (const [code, uses] of byCode) {
    if (new Set(uses.map((use) => use.description)).size < 2) continue;
    const details = uses
      .map(({ product, description }) => `${labelOf(product.name, product.id)} (${quote(description)})`)
      .join(', ');
    issues.push({
      level: 'warning',
      message: `Il codice ${quote(code)} compare in più prodotti con descrizioni diverse: ${details}`,
      where: code,
    });
  }
  return issues;
}

/**
 * Controlli sul catalogo di una linea. Ogni problema dello schema diventa un errore con `where` uguale al percorso
 * del campo; gli avvisi si calcolano comunque, anche se lo schema non passa.
 */
export function checkLine(line: LineData): Issue[] {
  const issues: Issue[] = [];

  const parsed = lineDataSchema.safeParse(line);
  if (!parsed.success) {
    for (const { message, path } of parsed.error.issues) {
      issues.push({ level: 'error', message, ...(path.length > 0 && { where: path.map(String).join('.') }) });
    }
  }

  const products = listOf(line.products);
  issues.push(...sharedCodeWarnings(products));

  for (const product of products) {
    if (listOf(product.images).length === 0) {
      issues.push({
        level: 'warning',
        message: `Il prodotto ${quote(labelOf(product.name, product.id))} non ha immagini`,
        where: product.id,
      });
    }
  }

  for (const category of listOf(line.categories)) {
    if (!category.image) {
      issues.push({
        level: 'warning',
        message: `La categoria ${quote(labelOf(category.name, category.id))} non ha un'immagine di apertura`,
        where: category.id,
      });
    }
  }

  return issues;
}
