import type { Rect } from '../types';

/**
 * Matrice affine come in IDML: `ItemTransform="a b c d tx ty"`, con i punti come vettori riga,
 * quindi `x' = a·x + c·y + tx` e `y' = b·x + d·y + ty`.
 */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Legge un `ItemTransform`. Valore assente o vuoto: identità. Valore malformato: errore. */
export function parseTransform(s: string | undefined): Matrix {
  if (s === undefined || s.trim() === '') return IDENTITY;
  const numbers = s.trim().split(/\s+/).map(Number);
  if (numbers.length !== 6 || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(`Trasformazione IDML non valida: "${s}"`);
  }
  return numbers as unknown as Matrix;
}

/**
 * Compone due trasformazioni: applica prima `a`, poi `b`.
 * Per un frame dentro un gruppo: `multiply(trasformazioneDelFrame, trasformazioneDelGruppo)`.
 */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** Rettangolo che racchiude i punti `anchors` dopo aver applicato `m`. */
export function boundsOf(anchors: Array<[number, number]>, m: Matrix): Rect {
  if (anchors.length === 0) throw new Error('boundsOf: nessun punto di ancoraggio');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of anchors) {
    const px = m[0] * x + m[2] * y + m[4];
    const py = m[1] * x + m[3] * y + m[5];
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
