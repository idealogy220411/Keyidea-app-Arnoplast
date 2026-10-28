import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import type { IdmlDocument, IdmlSpread, ImageFrame, Rect, Story, StoryItem, TextFrame } from '../types';
import { IDENTITY, boundsOf, multiply, parseTransform, type Matrix } from './geometry';

// ---------------------------------------------------------------------------
// XML con ordine preservato (conta per Content / Br / Table)
// ---------------------------------------------------------------------------

/** Nodo di `fast-xml-parser` con `preserveOrder`: una sola chiave tag, più `:@` con gli attributi. */
type XNode = { [tag: string]: unknown } & { ':@'?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  // Il testo va letto così com'è: niente numeri, niente trim (gli spazi dentro `Content` contano).
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // Decodifica anche i riferimenti numerici (`&#x2028;`), che InDesign usa per i caratteri speciali.
  htmlEntities: true,
});

function tagOf(node: XNode): string {
  return Object.keys(node).find((key) => key !== ':@') ?? '';
}

function kids(node: XNode): XNode[] {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? (value as XNode[]) : [];
}

function attr(node: XNode, name: string): string | undefined {
  return node[':@']?.[`@_${name}`];
}

function child(node: XNode, tag: string): XNode | undefined {
  return kids(node).find((k) => tagOf(k) === tag);
}

function textOf(node: XNode): string {
  return kids(node)
    .map((k) => (tagOf(k) === '#text' ? String((k as { '#text': unknown })['#text']) : ''))
    .join('');
}

/** `<wrapper><tag/></wrapper>` (come `idPkg:Story` → `Story`), oppure `<tag/>` alla radice. */
function unwrap(root: XNode[], wrapper: string, tag: string): XNode | undefined {
  const top = root.find((n) => tagOf(n) === tag);
  if (top) return top;
  const wrapped = root.find((n) => tagOf(n) === wrapper);
  return wrapped ? child(wrapped, tag) : undefined;
}

// ---------------------------------------------------------------------------
// Storie
// ---------------------------------------------------------------------------

const CHARACTER_STYLE_PREFIX = 'CharacterStyle/';
const NO_CHARACTER_STYLE = '$ID/[No character style]';

/**
 * `CharacterStyle/Gruppo%3aNome` → `Nome`: toglie il prefisso, decodifica `%3a` in `:`,
 * tiene la parte dopo l'ultimo `:` (gli stili possono stare in gruppi). Lo stile
 * `$ID/[No character style]` (o l'attributo assente) diventa una stringa vuota.
 */
function styleName(applied: string | undefined): string {
  if (!applied) return '';
  let name = applied.startsWith(CHARACTER_STYLE_PREFIX) ? applied.slice(CHARACTER_STYLE_PREFIX.length) : applied;
  try {
    name = decodeURIComponent(name);
  } catch {
    name = name.replace(/%3a/gi, ':');
  }
  if (name === NO_CHARACTER_STYLE) return '';
  return name.slice(name.lastIndexOf(':') + 1);
}

/**
 * Cammina la storia in ordine. Nel file reale non esistono stili di paragrafo personalizzati (tutto il
 * testo usa `NormalParagraphStyle`): il ruolo di ogni testo si riconosce solo dallo stile di **carattere**
 * del `CharacterStyleRange` più vicino. Un paragrafo finisce a ogni `<Br/>`, alla fine del
 * `ParagraphStyleRange` e **anche quando lo stile di carattere cambia**: senza quest'ultimo caso un'intestazione
 * (per esempio «CARATTERISTICHE», stile `TITOLO`) seguita, nello stesso paragrafo, da un `<Br/>` dentro un
 * `CharacterStyleRange` di stile diverso finirebbe accorpata con lo stile sbagliato (caso reale, verificato sul
 * pacchetto del cliente). Lo stile di un testo è quello impostato all'ultimo `Content` letto, non quello del nodo
 * attraversato in quel momento: così un `<Br/>` "orfano" in un `CharacterStyleRange` successivo, senza contenuto
 * proprio, chiude comunque il paragrafo con lo stile giusto. Gli elementi sconosciuti (`XMLElement`, `Change`, …)
 * si attraversano; le `Note` si saltano.
 */
function readItems(nodes: XNode[]): StoryItem[] {
  const items: StoryItem[] = [];
  let buffer = '';
  let bufferStyle = '';

  const flush = (): void => {
    if (buffer.trim() !== '') items.push({ kind: 'paragraph', style: bufferStyle, text: buffer });
    buffer = '';
  };

  /** Chiude il paragrafo in corso se lo stile cambia, poi adotta il nuovo stile per il testo che segue. */
  const setStyle = (style: string): void => {
    if (style === bufferStyle) return;
    flush();
    bufferStyle = style;
  };

  const walk = (list: XNode[], style: string): void => {
    for (const node of list) {
      switch (tagOf(node)) {
        case 'Content':
          setStyle(style);
          buffer += textOf(node);
          break;
        case 'Br':
          flush();
          break;
        case 'Table':
          flush();
          items.push({ kind: 'table', rows: readTable(node) });
          break;
        case 'CharacterStyleRange':
          walk(kids(node), styleName(attr(node, 'AppliedCharacterStyle')));
          break;
        case 'ParagraphStyleRange':
          walk(kids(node), style);
          flush();
          break;
        case 'Note':
          break;
        default:
          walk(kids(node), style);
      }
    }
  };

  walk(nodes, '');
  flush();
  return items;
}

/** Celle in `rows[riga][colonna]` secondo `Cell@Name="colonna:riga"`; le celle assenti (unite) sono vuote. */
function readTable(table: XNode): string[][] {
  const cells: Array<{ row: number; col: number; text: string }> = [];
  for (const cell of kids(table)) {
    if (tagOf(cell) !== 'Cell') continue;
    const position = /^(\d+):(\d+)$/.exec(attr(cell, 'Name') ?? '');
    if (!position) continue;
    const text = readItems(kids(cell))
      .flatMap((item) => (item.kind === 'paragraph' ? [item.text] : []))
      .join(' ')
      .trim();
    cells.push({ col: Number(position[1]), row: Number(position[2]), text });
  }
  const rowCount = Math.max(0, ...cells.map((c) => c.row + 1));
  const colCount = Math.max(0, ...cells.map((c) => c.col + 1));
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => ''));
  for (const { row, col, text } of cells) rows[row][col] = text;
  return rows;
}

function readStory(root: XNode[]): Story | undefined {
  const story = unwrap(root, 'idPkg:Story', 'Story');
  const id = story && attr(story, 'Self');
  return story && id ? { id, items: readItems(kids(story)) } : undefined;
}

// ---------------------------------------------------------------------------
// Spread
// ---------------------------------------------------------------------------

const SHAPE_TAGS = new Set(['Rectangle', 'Oval', 'Polygon']);
const GRAPHIC_TAGS = new Set(['Image', 'PDF', 'EPS', 'WMF', 'PICT', 'ImportedPage']);

/** Punti `PathPointType@Anchor` del tracciato proprio del frame (`Properties/PathGeometry`). */
function anchorsOf(frame: XNode): Array<[number, number]> {
  const properties = child(frame, 'Properties');
  const geometry = properties && child(properties, 'PathGeometry');
  const anchors: Array<[number, number]> = [];
  const collect = (nodes: XNode[]): void => {
    for (const node of nodes) {
      if (tagOf(node) === 'PathPointType') {
        const [x, y] = (attr(node, 'Anchor') ?? '').trim().split(/\s+/).map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) anchors.push([x, y]);
      } else {
        collect(kids(node));
      }
    }
  };
  if (geometry) collect(kids(geometry));
  return anchors;
}

/** `Link@LinkResourceURI` dell'immagine collocata nel frame (Image, PDF, EPS, …). */
function linkUriOf(shape: XNode): string | undefined {
  for (const graphic of kids(shape)) {
    if (!GRAPHIC_TAGS.has(tagOf(graphic))) continue;
    const link = child(graphic, 'Link');
    const uri = link && attr(link, 'LinkResourceURI');
    if (uri) return uri;
  }
  return undefined;
}

/**
 * Raccoglie i frame in ordine di documento. La posizione si ricava dal tracciato del frame e dalla
 * catena `ItemTransform` frame → gruppi; la trasformazione propria dell'immagine (posizione dentro
 * il frame) e quella dello `Spread` (posizione sulla pasteboard) non contano.
 */
function collectFrames(nodes: XNode[], parent: Matrix, out: Array<TextFrame | ImageFrame>): void {
  for (const node of nodes) {
    const tag = tagOf(node);
    const isFrame = tag === 'TextFrame' || SHAPE_TAGS.has(tag);
    if (tag !== 'Group' && !isFrame) continue;

    const matrix = multiply(parseTransform(attr(node, 'ItemTransform')), parent);
    if (tag === 'Group') {
      collectFrames(kids(node), matrix, out);
      continue;
    }
    const anchors = anchorsOf(node);
    if (anchors.length === 0) continue;
    if (tag === 'TextFrame') {
      const storyId = attr(node, 'ParentStory');
      if (storyId) out.push({ kind: 'text', storyId, bounds: boundsOf(anchors, matrix) });
    } else {
      const linkUri = linkUriOf(node);
      if (linkUri) out.push({ kind: 'image', linkUri, bounds: boundsOf(anchors, matrix) });
    }
  }
}

/** `Page@GeometricBounds="top left bottom right"` (coordinate della pagina) → rettangolo nello spread. */
function pageRect(page: XNode): Rect | undefined {
  const [top, left, bottom, right] = (attr(page, 'GeometricBounds') ?? '').trim().split(/\s+/).map(Number);
  if (![top, left, bottom, right].every(Number.isFinite)) return undefined;
  const corners: Array<[number, number]> = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  return boundsOf(corners, parseTransform(attr(page, 'ItemTransform')));
}

function readSpread(root: XNode[], index: number, src: string): IdmlSpread {
  const spread = unwrap(root, 'idPkg:Spread', 'Spread');
  if (!spread) throw new Error(`File IDML non valido: "${src}" non contiene uno Spread`);
  const pages = kids(spread)
    .filter((node) => tagOf(node) === 'Page')
    .flatMap((page) => pageRect(page) ?? []);
  const frames: IdmlSpread['frames'] = [];
  collectFrames(kids(spread), IDENTITY, frames);
  return { index, pages, frames };
}

// ---------------------------------------------------------------------------
// Pacchetto
// ---------------------------------------------------------------------------

/** Legge un pacchetto IDML: spread nell'ordine del `designmap.xml`, storie lette una volta sola. */
export async function readIdml(filePath: string): Promise<IdmlDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readFile(filePath));
  } catch (error) {
    throw new Error(`File IDML non leggibile (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
  }

  const readXml = async (name: string): Promise<XNode[]> => {
    const entry = zip.file(name);
    if (!entry) throw new Error(`File IDML non valido: manca "${name}"`);
    return parser.parse(await entry.async('string')) as XNode[];
  };

  const designmap = (await readXml('designmap.xml')).find((node) => tagOf(node) === 'Document');
  if (!designmap) throw new Error('File IDML non valido: "designmap.xml" non contiene un Document');
  const srcsOf = (tag: string): string[] =>
    kids(designmap).flatMap((node) => (tagOf(node) === tag ? (attr(node, 'src') ?? []) : []));

  const spreads = await Promise.all(
    srcsOf('idPkg:Spread').map(async (src, index) => readSpread(await readXml(src), index, src)),
  );
  const stories = new Map<string, Story>();
  const storyList = await Promise.all([...new Set(srcsOf('idPkg:Story'))].map(async (src) => readStory(await readXml(src))));
  for (const story of storyList) if (story) stories.set(story.id, story);

  return { spreads, stories };
}
