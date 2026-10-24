import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  EDITION_RE,
  LINE_IDS,
  REFERENCE_LANG,
  type Category,
  type ImageRef,
  type LineData,
  type LineId,
  type Product,
} from '@arnoplast/schema';
import { attachImages, type AttachedLanguage } from './associate';
import { checkLine } from './checks';
import { loadConfig, type ConverterConfig } from './config';
import { extractLanguage } from './extract';
import { readIdml } from './idml/read';
import { linkFileName, resolveLink } from './links';
import { mergeLanguages, type MergedProduct } from './merge';
import { processImage, rasterizeVector, UnsupportedImageError } from './media';
import { decodeQr, isVideoUrl } from './qr';
import { renderReport, type ReportInput } from './report';
import type { Issue } from './types';

export type BuildOptions = { line: LineId; edition: string; inputDir: string; outDir: string; configPath: string };

export type BuildResult = {
  ok: boolean;
  /** Cartella radice delle build (`--out`), in percorso assoluto: contiene `<linea>/img` e `<linea>/<edizione>`. */
  outDir: string;
  /** Dove va `data.json`: il file esiste solo se la build non ha errori. */
  dataPath: string;
  reportPath: string;
  issues: Issue[];
};

const quote = (value: unknown) => `«${String(value)}»`;

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const issue = (level: Issue['level'], message: string, where?: string): Issue => ({
  level,
  message,
  ...(where !== undefined && { where }),
});

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

/** Linea ed edizione finiscono nei percorsi dei file: si controllano prima di toccare il disco. */
function checkArguments({ line, edition }: Pick<BuildOptions, 'line' | 'edition'>): Issue[] {
  const issues: Issue[] = [];
  if (!(LINE_IDS as readonly string[]).includes(line)) {
    issues.push(issue('error', `linea sconosciuta: ${quote(line)} (ammesse: ${LINE_IDS.join(', ')})`, 'linea'));
  }
  if (!EDITION_RE.test(edition)) {
    issues.push(
      issue('error', `edizione non valida: ${quote(edition)} (formato atteso anno.numero, per esempio 2026.1)`, 'edizione'),
    );
  }
  return issues;
}

type LanguageInput = { lang: string; idmlPath: string };

/** Il file IDML di ogni lingua della configurazione; cartelle mancanti, estranee o senza un solo IDML finiscono in `issues`. */
async function findLanguageInputs(inputDir: string, languages: string[], issues: Issue[]): Promise<LanguageInput[]> {
  const folders = (await readdir(inputDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const name of folders.filter((folder) => !languages.includes(folder))) {
    issues.push(issue('warning', `cartella lingua ignorata: ${name}`, name));
  }

  const inputs: LanguageInput[] = [];
  for (const lang of languages) {
    if (!folders.includes(lang)) {
      issues.push(
        lang === REFERENCE_LANG
          ? issue('error', `manca la cartella dell'italiano (${lang}), la lingua di riferimento: ${join(inputDir, lang)}`, lang)
          : issue('warning', `cartella lingua mancante: ${lang}`, lang),
      );
      continue;
    }
    const idmlFiles = (await readdir(join(inputDir, lang))).filter((name) => name.toLowerCase().endsWith('.idml'));
    if (idmlFiles.length === 1) {
      inputs.push({ lang, idmlPath: join(inputDir, lang, idmlFiles[0]) });
    } else {
      issues.push(issue('error', `la cartella ${quote(lang)} deve contenere un solo file .idml (trovati: ${idmlFiles.length})`, lang));
    }
  }
  return inputs;
}

async function readLanguage(
  { lang, idmlPath }: LanguageInput,
  config: ConverterConfig,
  issues: Issue[],
): Promise<AttachedLanguage | null> {
  let doc;
  try {
    doc = await readIdml(idmlPath);
  } catch (error) {
    issues.push(issue('error', reason(error), lang));
    return null;
  }
  const extract = extractLanguage(doc, config, lang);
  if (extract.products.length === 0) {
    issues.push(issue('error', `nessun prodotto trovato in ${lang}: controlla gli stili in catalogo.config.yaml`, lang));
  }
  return attachImages(doc, extract, config);
}

type ImageContext = { linksDir: string; imgDir: string; issues: Issue[] };

/** Percorso del file collegato; se manca segnala un errore bloccante e restituisce `null`. */
async function locate(linkUri: string, where: string, { linksDir, issues }: ImageContext): Promise<string | null> {
  const path = await resolveLink(linkUri, linksDir);
  if (path === null) issues.push(issue('error', `immagine collegata mancante: ${linkFileName(linkUri)}`, where));
  return path;
}

/** Esegue la conversione; un formato non supportato è solo un avviso e il risultato è `null`. */
async function convert(produce: () => Promise<ImageRef>, where: string, { issues }: ImageContext): Promise<ImageRef | null> {
  try {
    return await produce();
  } catch (error) {
    if (!(error instanceof UnsupportedImageError)) throw error;
    issues.push(issue('warning', error.message.normalize('NFC'), where));
    return null;
  }
}

/** Rasterizza il disegno in una cartella temporanea (sempre ripulita) e ne ricava miniatura e dettaglio. */
async function processDrawing(src: string, imgDir: string): Promise<ImageRef> {
  const png = await rasterizeVector(src);
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-drawing-'));
  try {
    const file = join(dir, 'disegno.png');
    await writeFile(file, png);
    return await processImage(file, imgDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Foto, disegni e video di un prodotto. I file si elaborano uno alla volta, per non riempire la memoria. */
async function processProduct(product: MergedProduct, ctx: ImageContext): Promise<Pick<Product, 'images' | 'drawings' | 'videoUrl'>> {
  const media: Pick<Product, 'images' | 'drawings' | 'videoUrl'> = { images: [], drawings: [], videoUrl: null };
  const add = (list: ImageRef[], ref: ImageRef | null): void => {
    if (ref && !list.some((other) => other.detail === ref.detail)) list.push(ref);
  };

  for (const linkUri of product.imageLinks) {
    const path = await locate(linkUri, product.id, ctx);
    if (path === null) continue;
    const qr = await decodeQr(path);
    if (qr === null) add(media.images, await convert(() => processImage(path, ctx.imgDir), product.id, ctx));
    else if (isVideoUrl(qr)) media.videoUrl ??= qr;
    else ctx.issues.push(issue('warning', `QR code non riconosciuto come video: ${qr}`, product.id));
  }
  for (const linkUri of product.drawingLinks) {
    const path = await locate(linkUri, product.id, ctx);
    if (path !== null) add(media.drawings, await convert(() => processDrawing(path, ctx.imgDir), product.id, ctx));
  }
  return media;
}

/** Legge le lingue, le unisce e prepara le immagini. `null` se un errore impedisce di comporre la linea. */
async function composeLine(opts: BuildOptions, inputDir: string, imgDir: string, issues: Issue[]): Promise<LineData | null> {
  let config: ConverterConfig;
  try {
    config = await loadConfig(opts.configPath);
  } catch (error) {
    issues.push(issue('error', reason(error)));
    return null;
  }
  if (!(await isDirectory(inputDir))) {
    issues.push(issue('error', `cartella di input non trovata: ${inputDir}`));
    return null;
  }

  const perLang: AttachedLanguage[] = [];
  for (const input of await findLanguageInputs(inputDir, config.languages, issues)) {
    const language = await readLanguage(input, config, issues);
    if (language) perLang.push(language);
  }
  // Il motivo (cartella o IDML dell'italiano inutilizzabili) è già tra gli errori.
  if (!perLang.some(({ lang }) => lang === REFERENCE_LANG)) return null;

  const merged = mergeLanguages(perLang);
  issues.push(...merged.issues);

  // Solo i collegamenti dell'italiano contano: le altre lingue condividono le stesse immagini.
  const ctx: ImageContext = { linksDir: join(inputDir, REFERENCE_LANG, 'Links'), imgDir, issues };
  const categories: Category[] = [];
  for (const { id, name, order, imageLink, productIds } of merged.categories) {
    const path = imageLink === null ? null : await locate(imageLink, id, ctx);
    const image = path === null ? null : await convert(() => processImage(path, imgDir), id, ctx);
    categories.push({ id, name, order, image, productIds });
  }
  const products: Product[] = [];
  for (const product of merged.products) {
    const { images, drawings, videoUrl } = await processProduct(product, ctx);
    const { id, categoryId, name, materials, features, dimensions, optionalCodes, articles } = product;
    products.push({ id, categoryId, name, materials, features, dimensions, images, drawings, videoUrl, optionalCodes, articles });
  }

  return {
    format: 1,
    line: opts.line,
    edition: opts.edition,
    languages: merged.languages,
    name: config.lines[opts.line].name,
    categories,
    products,
  };
}

function statsOf(line: LineData | null): ReportInput['stats'] {
  if (!line) return { categories: 0, products: 0, articles: 0, images: 0, videos: 0 };
  const images = new Set<string>();
  for (const { images: photos, drawings } of line.products) {
    for (const ref of [...photos, ...drawings]) images.add(ref.detail);
  }
  for (const { image } of line.categories) if (image) images.add(image.detail);
  return {
    categories: line.categories.length,
    products: line.products.length,
    articles: line.products.reduce((sum, product) => sum + product.articles.length, 0),
    images: images.size,
    videos: line.products.filter((product) => product.videoUrl !== null).length,
  };
}

/**
 * Costruisce una linea: legge i pacchetti InDesign di `<inputDir>/<lingua>/`, li unisce e scrive
 * `<outDir>/<linea>/img/*.webp`, `<outDir>/<linea>/<edizione>/report.html` e, se non ci sono errori, `data.json`.
 * Gli errori dell'input e dei file sono problemi (`issues`) del risultato, non eccezioni.
 */
export async function buildLine(opts: BuildOptions): Promise<BuildResult> {
  const outDir = resolve(opts.outDir);
  const editionDir = join(outDir, opts.line, opts.edition);
  const dataPath = join(editionDir, 'data.json');
  const reportPath = join(editionDir, 'report.html');

  const invalid = checkArguments(opts);
  if (invalid.length > 0) return { ok: false, outDir, dataPath, reportPath, issues: invalid };

  const issues: Issue[] = [];
  const line = await composeLine(opts, resolve(opts.inputDir), join(outDir, opts.line, 'img'), issues);
  if (line) issues.push(...checkLine(line));
  const ok = line !== null && !issues.some((entry) => entry.level === 'error');

  await mkdir(editionDir, { recursive: true });
  await writeFile(reportPath, renderReport({ line: opts.line, edition: opts.edition, issues, stats: statsOf(line) }));
  if (ok) await writeFile(dataPath, `${JSON.stringify(line, null, 2)}\n`);
  // Una build con errori non deve lasciare un data.json vecchio che `publish` potrebbe prendere per buono.
  else await rm(dataPath, { force: true });

  return { ok, outDir, dataPath, reportPath, issues };
}
