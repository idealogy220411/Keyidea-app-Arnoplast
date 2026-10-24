import type { LineId } from '@arnoplast/schema';
import type { Issue } from './types';

/** Una riga della tabella dei prodotti: nomi in italiano, nell'ordine di lettura del catalogo. */
export type ReportProduct = {
  category: string;
  name: string;
  /** Numero di codici articolo. */
  codes: number;
  images: number;
  drawings: number;
  video: boolean;
};

export type ReportInput = {
  line: LineId;
  edition: string;
  issues: Issue[];
  stats: { categories: number; products: number; articles: number; images: number; videos: number };
  /** Se manca o è vuoto, il rapporto non ha la sezione dei prodotti. */
  products?: ReportProduct[];
};

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; background: #f5f5f4; color: #1c1917; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  main { max-width: 960px; margin: 0 auto; }
  h1 { margin: 0 0 16px; font-size: 1.6rem; }
  h2 { margin: 32px 0 12px; font-size: 1.2rem; }
  .status { margin: 0 0 16px; padding: 14px 18px; border-radius: 8px; color: #fff; font-size: 1.15rem; font-weight: 700; }
  .status.ok { background: #1a7f37; }
  .status.ko { background: #E01A22; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
  .stat { display: flex; flex-direction: column; padding: 12px 16px; background: #fff; border: 1px solid #d6d3d1; border-radius: 8px; }
  .value { font-size: 1.8rem; font-weight: 700; line-height: 1.2; }
  .label { color: #57534e; font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d6d3d1; }
  th, td { padding: 8px 12px; border-bottom: 1px solid #e7e5e4; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #f5f5f4; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td.where { width: 30%; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9rem; }
  .errors th { border-top: 4px solid #E01A22; }
  .warnings th { border-top: 4px solid #b45309; }
  .products th { border-top: 4px solid #57534e; }
  .products td.num { text-align: right; }
  .none { margin: 0; padding: 12px 16px; background: #fff; border: 1px solid #d6d3d1; border-radius: 8px; color: #57534e; }
`;

function statusLine(errorCount: number): string {
  if (errorCount === 0) return '<p class="status ok">Pronto per la pubblicazione</p>';
  const text = errorCount === 1 ? "C'è 1 errore da correggere" : `Ci sono ${errorCount} errori da correggere`;
  return `<p class="status ko">${text}</p>`;
}

function issuesSection(title: string, kind: 'errors' | 'warnings', issues: Issue[], emptyText: string): string {
  const heading = `<h2>${title} (${issues.length})</h2>`;
  if (issues.length === 0) return `${heading}\n<p class="none">${emptyText}</p>`;
  const rows = issues
    .map(
      (issue) =>
        `<tr><td class="where">${issue.where ? escapeHtml(issue.where) : '—'}</td><td>${escapeHtml(issue.message)}</td></tr>`,
    )
    .join('\n');
  return `${heading}\n<table class="${kind}">\n<thead><tr><th>Dove</th><th>Messaggio</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

function productsSection(products: ReportProduct[]): string {
  const number = (value: number) => `<td class="num">${escapeHtml(String(value))}</td>`;
  const rows = products
    .map(
      ({ category, name, codes, images, drawings, video }) =>
        `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(name)}</td>${number(codes)}${number(images)}${number(drawings)}<td>${video ? 'sì' : 'no'}</td></tr>`,
    )
    .join('\n');
  return `<h2>Prodotti (${products.length})</h2>
<table class="products">
<thead><tr><th>Categoria</th><th>Prodotto</th><th>Codici</th><th>Foto</th><th>Disegni</th><th>Video</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/** Rapporto della build: un documento HTML autonomo, in italiano, con riepilogo, errori, avvisi e prodotti. */
export function renderReport({ line, edition, issues, stats, products = [] }: ReportInput): string {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  const title = escapeHtml(`Rapporto ${line} ${edition}`);

  const statItems: Array<[string, number]> = [
    ['Categorie', stats.categories],
    ['Prodotti', stats.products],
    ['Articoli', stats.articles],
    ['Immagini', stats.images],
    ['Video', stats.videos],
  ];
  const statsList = statItems
    .map(
      ([label, value]) =>
        `<li class="stat"><span class="value">${escapeHtml(String(value))}</span><span class="label">${label}</span></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${title}</h1>
${statusLine(errors.length)}
<ul class="stats">
${statsList}
</ul>
${issuesSection('Errori', 'errors', errors, 'Nessun errore')}
${issuesSection('Avvisi', 'warnings', warnings, 'Nessun avviso')}${products.length > 0 ? `\n${productsSection(products)}` : ''}
</main>
</body>
</html>
`;
}
