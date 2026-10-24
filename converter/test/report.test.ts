import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/report';
import type { Issue } from '../src/types';

const STATS = { categories: 2, products: 3, articles: 45, images: 67, videos: 8 };

const error = (message: string, where?: string): Issue => ({ level: 'error', message, where });
const warning = (message: string, where?: string): Issue => ({ level: 'warning', message, where });

const render = (issues: Issue[], overrides: { line?: 'agricoltura' | 'garden' | 'olive'; edition?: string } = {}) =>
  renderReport({ line: 'agricoltura', edition: '2026.1', issues, stats: STATS, ...overrides });

describe('renderReport', () => {
  it('is a standalone Italian document', () => {
    const html = render([error('Errore di prova', 'products.0')]);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="it">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>Rapporto agricoltura 2026.1</title>');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script|<link|<img|<iframe|\ssrc=|https?:\/\//i);
  });

  it('shows the summary numbers', () => {
    const html = render([]);

    expect(html).toContain('<span class="value">2</span><span class="label">Categorie</span>');
    expect(html).toContain('<span class="value">3</span><span class="label">Prodotti</span>');
    expect(html).toContain('<span class="value">45</span><span class="label">Articoli</span>');
    expect(html).toContain('<span class="value">67</span><span class="label">Immagini</span>');
    expect(html).toContain('<span class="value">8</span><span class="label">Video</span>');
  });

  it('report shows ready status', () => {
    const html = render([]);

    expect(html).toContain('<p class="status ok">Pronto per la pubblicazione</p>');
    expect(html).not.toContain('da correggere');
  });

  it('report shows error count', () => {
    const html = render([error('Primo', 'a'), error('Secondo', 'b')]);

    expect(html).toContain('Ci sono 2 errori da correggere');
    expect(html).not.toContain('Pronto per la pubblicazione');
    expect(html).toContain('<p class="status ko">Ci sono 2 errori da correggere</p>');
  });

  it('uses the singular for one error', () => {
    const html = render([error('Unico')]);

    expect(html).toContain("C'è 1 errore da correggere");
    expect(html).not.toContain('Ci sono');
  });

  it('is ready to publish when there are only warnings', () => {
    const html = render([warning('Solo un avviso', 'qubo')]);

    expect(html).toContain('Pronto per la pubblicazione');
    expect(html).toContain('Solo un avviso');
  });

  it('lists errors first, then warnings, with where and message', () => {
    const html = render([
      warning('Un avviso', 'qubo'),
      error('Un errore', 'products.0.articles'),
    ]);

    const errorsAt = html.indexOf('Errori');
    const warningsAt = html.indexOf('Avvisi');
    expect(errorsAt).toBeGreaterThan(-1);
    expect(warningsAt).toBeGreaterThan(errorsAt);
    expect(html).toContain('<th>Dove</th><th>Messaggio</th>');
    expect(html.indexOf('products.0.articles')).toBeGreaterThan(errorsAt);
    expect(html.indexOf('products.0.articles')).toBeLessThan(warningsAt);
    expect(html.indexOf('Un avviso')).toBeGreaterThan(warningsAt);
  });

  it('replaces empty tables with a short note', () => {
    const none = render([]);
    expect(none).toContain('Nessun errore');
    expect(none).toContain('Nessun avviso');
    expect(none).not.toContain('<table');

    const onlyWarning = render([warning('Attenzione')]);
    expect(onlyWarning).toContain('Nessun errore');
    expect(onlyWarning).not.toContain('Nessun avviso');

    const onlyError = render([error('Guasto')]);
    expect(onlyError).not.toContain('Nessun errore');
    expect(onlyError).toContain('Nessun avviso');
  });

  it('shows a dash when an issue has no location', () => {
    expect(render([error('Senza posizione')])).toContain('<td class="where">—</td>');
  });

  it('report escapes html', () => {
    const html = render([warning('Il prodotto «<b>X</b>» non ha immagini', '<b>X</b>')]);

    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });

  it('escapes ampersands and quotes in every dynamic string', () => {
    const html = render([error(`Tom & "Jerry" <script>alert('x')</script>`, `a&b "c" 'd'`)], {
      edition: `2026.1"><script>`,
    });

    expect(html).toContain('Tom &amp; &quot;Jerry&quot; &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
    expect(html).toContain('a&amp;b &quot;c&quot; &#39;d&#39;');
    expect(html).toContain('2026.1&quot;&gt;&lt;script&gt;');
    expect(html).not.toContain('<script');
  });
});
