import type { Rect } from './types';

/**
 * Indice della pagina dello spread che contiene il punto; se nessuna lo contiene, la più vicina.
 * Intervalli semiaperti: un punto sul bordo tra due pagine affiancate appartiene a quella di destra.
 */
export function pageIndexAt(pages: Rect[], x: number, y: number): number {
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
