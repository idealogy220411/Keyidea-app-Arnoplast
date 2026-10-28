import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll } from 'vitest';
import type { StoryItem } from '../../src/types';

/** Pagina di prova: `x`/`y` sono la traslazione di `ItemTransform`, `w`/`h` la dimensione. */
export type TestPage = { x: number; y: number; w: number; h: number };

export type TestFrame =
  | {
      kind: 'text';
      items: StoryItem[];
      x: number;
      y: number;
      w: number;
      h: number;
      group?: { tx: number; ty: number };
    }
  | {
      kind: 'image';
      link: string;
      x: number;
      y: number;
      w: number;
      h: number;
      group?: { tx: number; ty: number };
    };

export type TestIdml = {
  spreads: Array<{ frames: TestFrame[]; pages?: TestPage[] }>;
};

/** Contenuto grezzo di un IDML sintetico: XML interno di ogni `Story` e di ogni `Spread`. */
export type RawIdml = {
  /** id della storia → XML contenuto dentro `<Story>`. */
  stories: Record<string, string>;
  /** XML contenuto dentro ogni `<Spread>`, nell'ordine del designmap. */
  spreads: string[];
};

const NS = 'xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.0"';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Come nel file reale: un solo stile di paragrafo per tutto il documento, nessuno stile dedicato.
const NORMAL_PARAGRAPH_STYLE = '$ID/NormalParagraphStyle';
const NO_CHARACTER_STYLE = '$ID/[No character style]';

const createdDirs: string[] = [];
afterAll(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Come InDesign: i gruppi di stili sono separati da `:` scritto `%3a`. */
function appliedCharacterStyle(style: string): string {
  if (style === '') return `CharacterStyle/${NO_CHARACTER_STYLE}`;
  return `CharacterStyle/${esc(style.replace(/:/g, '%3a'))}`;
}

function contentXml(text: string): string {
  return text === '' ? '' : `<Content>${esc(text)}</Content>`;
}

function paragraphXml(item: Extract<StoryItem, { kind: 'paragraph' }>): string {
  return (
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${NORMAL_PARAGRAPH_STYLE}">` +
    `<CharacterStyleRange AppliedCharacterStyle="${appliedCharacterStyle(item.style)}">` +
    `${contentXml(item.text)}<Br/></CharacterStyleRange></ParagraphStyleRange>`
  );
}

function tableXml(item: Extract<StoryItem, { kind: 'table' }>, id: string): string {
  const rowCount = item.rows.length;
  const colCount = Math.max(0, ...item.rows.map((row) => row.length));
  const rows = item.rows.map((_, r) => `<Row Self="${id}Row${r}" Name="${r}"/>`).join('');
  const cols = Array.from({ length: colCount }, (_, c) => `<Column Self="${id}Column${c}" Name="${c}"/>`).join('');
  const cells = item.rows
    .flatMap((row, r) =>
      row.map(
        (text, c) =>
          `<Cell Self="${id}i${r}_${c}" Name="${c}:${r}" RowSpan="1" ColumnSpan="1">` +
          `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">` +
          `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">` +
          `${contentXml(text)}</CharacterStyleRange></ParagraphStyleRange></Cell>`,
      ),
    )
    .join('');
  return (
    `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${NORMAL_PARAGRAPH_STYLE}">` +
    `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/${NO_CHARACTER_STYLE}">` +
    `<Table Self="${id}" HeaderRowCount="1" FooterRowCount="0" BodyRowCount="${Math.max(0, rowCount - 1)}" ColumnCount="${colCount}">` +
    `${rows}${cols}${cells}</Table><Br/></CharacterStyleRange></ParagraphStyleRange>`
  );
}

function storyBodyXml(items: StoryItem[], id: string): string {
  return items
    .map((item, i) => (item.kind === 'paragraph' ? paragraphXml(item) : tableXml(item, `${id}t${i}`)))
    .join('');
}

/**
 * Come InDesign, il tracciato è centrato sull'origine del frame e `ItemTransform` lo sposta:
 * così i test verificano davvero la composizione delle trasformazioni.
 */
function pathXml(w: number, h: number): string {
  const points = [
    [-w / 2, -h / 2],
    [-w / 2, h / 2],
    [w / 2, h / 2],
    [w / 2, -h / 2],
  ];
  const anchors = points
    .map(([px, py]) => `<PathPointType Anchor="${px} ${py}" LeftDirection="${px} ${py}" RightDirection="${px} ${py}"/>`)
    .join('');
  return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${anchors}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
}

function placement(frame: { x: number; y: number; w: number; h: number }): string {
  return `1 0 0 1 ${frame.x + frame.w / 2} ${frame.y + frame.h / 2}`;
}

function spreadBodyXml(
  spread: TestIdml['spreads'][number],
  spreadId: string,
  storyIds: string[],
): string {
  let counter = 0;
  const nextId = (prefix: string): string => `${spreadId}${prefix}${counter++}`;

  const maxX = Math.max(1190, ...spread.frames.map((f) => f.x + f.w + (f.group?.tx ?? 0)));
  const maxY = Math.max(842, ...spread.frames.map((f) => f.y + f.h + (f.group?.ty ?? 0)));
  const pages: TestPage[] = spread.pages ?? [{ x: 0, y: 0, w: maxX, h: maxY }];
  const pagesXml = pages
    .map(
      (p) =>
        `<Page Self="${nextId('p')}" GeometricBounds="0 0 ${p.h} ${p.w}" ItemTransform="1 0 0 1 ${p.x} ${p.y}"/>`,
    )
    .join('');

  let storyIndex = 0;
  const framesXml = spread.frames
    .map((frame) => {
      let xml: string;
      if (frame.kind === 'text') {
        xml =
          `<TextFrame Self="${nextId('f')}" ParentStory="${storyIds[storyIndex++]}" ContentType="TextType" ` +
          `ItemTransform="${placement(frame)}">${pathXml(frame.w, frame.h)}</TextFrame>`;
      } else {
        // L'immagine ha una trasformazione propria (posizione dentro il frame): il lettore la deve ignorare.
        xml =
          `<Rectangle Self="${nextId('f')}" ContentType="GraphicType" ItemTransform="${placement(frame)}">` +
          `${pathXml(frame.w, frame.h)}` +
          `<Image Self="${nextId('i')}" ItemTransform="0.5 0 0 0.5 -20 -30"><Properties/>` +
          `<Link Self="${nextId('l')}" LinkResourceURI="${esc(frame.link)}"/></Image></Rectangle>`;
      }
      return frame.group
        ? `<Group Self="${nextId('g')}" ItemTransform="1 0 0 1 ${frame.group.tx} ${frame.group.ty}">${xml}</Group>`
        : xml;
    })
    .join('');

  return `${pagesXml}${framesXml}`;
}

/** Scrive un pacchetto IDML con i file indicati (percorso nello zip → contenuto). */
export async function writeIdml(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.adobe.indesign-idml-package', { compression: 'STORE' });
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-idml-'));
  createdDirs.push(dir);
  const filePath = join(dir, 'test.idml');
  await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return filePath;
}

/** Costruisce un IDML a partire dall'XML interno di storie e spread (per testare XML realistico). */
export async function buildRawIdml(raw: RawIdml): Promise<string> {
  const files: Record<string, string> = {};
  const spreadSrcs = raw.spreads.map((_, i) => `Spreads/Spread_u${i}.xml`);
  const storySrcs = Object.keys(raw.stories).map((id) => `Stories/Story_${id}.xml`);

  raw.spreads.forEach((body, i) => {
    files[spreadSrcs[i]] =
      `${XML_DECL}<idPkg:Spread ${NS}><Spread Self="u${i}" PageCount="1" BindingLocation="0" ItemTransform="1 0 0 1 0 0">${body}</Spread></idPkg:Spread>`;
  });
  Object.entries(raw.stories).forEach(([id, body], i) => {
    files[storySrcs[i]] =
      `${XML_DECL}<idPkg:Story ${NS}><Story Self="${id}" AppliedTOCStyle="n" TrackChanges="false">` +
      `<StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12"/>${body}</Story></idPkg:Story>`;
  });
  files['designmap.xml'] =
    `${XML_DECL}<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="20.0" Self="d">` +
    `${spreadSrcs.map((src) => `<idPkg:Spread src="${src}"/>`).join('')}` +
    `${storySrcs.map((src) => `<idPkg:Story src="${src}"/>`).join('')}</Document>`;
  return writeIdml(files);
}

/** Crea un file `.idml` sintetico in una cartella temporanea e ne restituisce il percorso. */
export async function buildIdml(spec: TestIdml): Promise<string> {
  const stories: Record<string, string> = {};
  let storyCounter = 0;
  const spreads = spec.spreads.map((spread, spreadIndex) => {
    const storyIds: string[] = [];
    for (const frame of spread.frames) {
      if (frame.kind !== 'text') continue;
      const id = `u${storyCounter++}s`;
      stories[id] = storyBodyXml(frame.items, id);
      storyIds.push(id);
    }
    return spreadBodyXml(spread, `u${spreadIndex}`, storyIds);
  });
  return buildRawIdml({ stories, spreads });
}
