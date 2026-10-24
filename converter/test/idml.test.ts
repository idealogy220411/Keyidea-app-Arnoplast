import { describe, expect, it } from 'vitest';
import { parseTransform } from '../src/idml/geometry';
import { readIdml } from '../src/idml/read';
import type { IdmlDocument, ImageFrame, StoryItem, TextFrame } from '../src/types';
import { buildIdml, buildRawIdml, writeIdml } from './helpers/build-idml';

function textFrame(frame: IdmlDocument['spreads'][number]['frames'][number] | undefined): TextFrame {
  if (frame?.kind !== 'text') throw new Error('atteso un frame di testo');
  return frame;
}

function imageFrame(frame: IdmlDocument['spreads'][number]['frames'][number] | undefined): ImageFrame {
  if (frame?.kind !== 'image') throw new Error('atteso un frame immagine');
  return frame;
}

function itemsOf(doc: IdmlDocument, frame: TextFrame): StoryItem[] {
  return doc.stories.get(frame.storyId)?.items ?? [];
}

/** Tracciato rettangolare come lo scrive InDesign (`Properties/PathGeometry/…/PathPointType`). */
function path(x0: number, y0: number, x1: number, y1: number): string {
  const anchors = [
    [x0, y0],
    [x0, y1],
    [x1, y1],
    [x1, y0],
  ]
    .map(([x, y]) => `<PathPointType Anchor="${x} ${y}"/>`)
    .join('');
  return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${anchors}</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
}

const content = (text: string): string => `<Content>${text}</Content>`;

describe('readIdml', () => {
  it('reads paragraphs with style names', async () => {
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            {
              kind: 'text',
              x: 0,
              y: 0,
              w: 300,
              h: 200,
              items: [
                { kind: 'paragraph', style: 'Titolo prodotto', text: 'COPRIPALO PRISMA' },
                { kind: 'paragraph', style: 'Caratteristiche', text: 'viteria certificata 8.8' },
              ],
            },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    const frame = textFrame(doc.spreads[0].frames[0]);
    expect(itemsOf(doc, frame)).toEqual([
      { kind: 'paragraph', style: 'Titolo prodotto', text: 'COPRIPALO PRISMA' },
      { kind: 'paragraph', style: 'Caratteristiche', text: 'viteria certificata 8.8' },
    ]);
  });

  it('splits paragraphs on Br', async () => {
    const style = 'ParagraphStyle/Caratteristiche';
    const file = await buildRawIdml({
      stories: {
        s1: `<ParagraphStyleRange AppliedParagraphStyle="${style}"><CharacterStyleRange>${content('prima riga')}<Br/>${content('seconda riga')}<Br/></CharacterStyleRange></ParagraphStyleRange>`,
      },
      spreads: [`<TextFrame Self="f1" ParentStory="s1" ItemTransform="1 0 0 1 0 0">${path(0, 0, 100, 50)}</TextFrame>`],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([
      { kind: 'paragraph', style: 'Caratteristiche', text: 'prima riga' },
      { kind: 'paragraph', style: 'Caratteristiche', text: 'seconda riga' },
    ]);
  });

  it('ends the last paragraph at the end of the paragraph style range', async () => {
    const file = await buildRawIdml({
      stories: {
        s1:
          `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Titolo prodotto"><CharacterStyleRange>${content('SENZA BR')}</CharacterStyleRange></ParagraphStyleRange>` +
          `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Caratteristiche"><CharacterStyleRange>${content('a ')}</CharacterStyleRange><CharacterStyleRange>${content('capo')}</CharacterStyleRange></ParagraphStyleRange>`,
      },
      spreads: [`<TextFrame Self="f1" ParentStory="s1" ItemTransform="1 0 0 1 0 0">${path(0, 0, 100, 50)}</TextFrame>`],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([
      { kind: 'paragraph', style: 'Titolo prodotto', text: 'SENZA BR' },
      { kind: 'paragraph', style: 'Caratteristiche', text: 'a capo' },
    ]);
  });

  it('strips style groups', async () => {
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            {
              kind: 'text',
              x: 0,
              y: 0,
              w: 300,
              h: 200,
              items: [{ kind: 'paragraph', style: 'Prodotti:Titolo prodotto', text: 'COPRIPALO QUBO' }],
            },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    const [item] = itemsOf(doc, textFrame(doc.spreads[0].frames[0]));
    expect(item).toMatchObject({ kind: 'paragraph', style: 'Titolo prodotto' });
  });

  it('maps the no-paragraph style to an empty string', async () => {
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            {
              kind: 'text',
              x: 0,
              y: 0,
              w: 300,
              h: 200,
              items: [{ kind: 'paragraph', style: '', text: 'testo libero' }],
            },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([
      { kind: 'paragraph', style: '', text: 'testo libero' },
    ]);
  });

  it('reads tables as rows of cell text', async () => {
    const rows = [
      ['COD.', 'DESCRIZIONE', 'PZ. CONF.', 'PZ. SCATOLA', 'PZ. PALLET'],
      ['1807-1351', 'Coprip Prisma 7x7 (senza viteria)', '40', '40', '640'],
    ];
    const file = await buildIdml({
      spreads: [{ frames: [{ kind: 'text', x: 0, y: 0, w: 500, h: 100, items: [{ kind: 'table', rows }] }] }],
    });
    const doc = await readIdml(file);
    const [table] = itemsOf(doc, textFrame(doc.spreads[0].frames[0]));
    expect(table).toEqual({ kind: 'table', rows });
    expect(table.kind === 'table' && table.rows[1]).toEqual(['1807-1351', 'Coprip Prisma 7x7 (senza viteria)', '40', '40', '640']);
  });

  it('keeps empty table cells in place', async () => {
    const rows = [['1807-1357', 'Viteria per Cp (4pz.)', '40', '200', '']];
    const file = await buildIdml({
      spreads: [{ frames: [{ kind: 'text', x: 0, y: 0, w: 500, h: 100, items: [{ kind: 'table', rows }] }] }],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([{ kind: 'table', rows }]);
  });

  it('keeps spread order from designmap', async () => {
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            { kind: 'text', x: 0, y: 0, w: 100, h: 100, items: [{ kind: 'paragraph', style: 'A', text: 'primo' }] },
          ],
        },
        {
          frames: [
            { kind: 'text', x: 0, y: 0, w: 100, h: 100, items: [{ kind: 'paragraph', style: 'B', text: 'secondo' }] },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    expect(doc.spreads.map((s) => s.index)).toEqual([0, 1]);
    expect(doc.spreads[0].frames).toHaveLength(1);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([{ kind: 'paragraph', style: 'A', text: 'primo' }]);
    expect(itemsOf(doc, textFrame(doc.spreads[1].frames[0]))).toEqual([{ kind: 'paragraph', style: 'B', text: 'secondo' }]);
  });

  it('follows designmap order, not file names', async () => {
    const spread = (body: string): string =>
      `<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><Spread Self="x">${body}</Spread></idPkg:Spread>`;
    const frame = (id: string): string => `<TextFrame Self="${id}" ParentStory="s1" ItemTransform="1 0 0 1 0 0">${path(0, 0, 10, 10)}</TextFrame>`;
    const file = await writeIdml({
      'designmap.xml':
        '<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><idPkg:Spread src="Spreads/Spread_z.xml"/><idPkg:Spread src="Spreads/Spread_a.xml"/><idPkg:Story src="Stories/Story_s1.xml"/></Document>',
      'Spreads/Spread_z.xml': spread(frame('f1')),
      'Spreads/Spread_a.xml': spread(frame('f2') + frame('f3')),
      'Stories/Story_s1.xml':
        '<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"><Story Self="s1"/></idPkg:Story>',
    });
    const doc = await readIdml(file);
    expect(doc.spreads.map((s) => s.frames.length)).toEqual([1, 2]);
  });

  it('computes bounds with nested group transforms', async () => {
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            { kind: 'image', link: 'file:/Links/foto.jpg', x: 10, y: 20, w: 200, h: 100, group: { tx: 100, ty: 50 } },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    const frame = imageFrame(doc.spreads[0].frames[0]);
    expect(frame.bounds).toEqual({ x: 110, y: 70, width: 200, height: 100 });
  });

  it('composes scaled and nested group transforms in order', async () => {
    const file = await buildRawIdml({
      stories: {},
      spreads: [
        `<Group Self="g1" ItemTransform="2 0 0 2 100 50"><Group Self="g2" ItemTransform="1 0 0 1 5 5">` +
          `<Rectangle Self="r1" ItemTransform="1 0 0 1 10 20">${path(0, 0, 30, 40)}` +
          `<Image Self="i1" ItemTransform="3 0 0 3 7 7"><Link LinkResourceURI="file:/Links/a.jpg"/></Image></Rectangle>` +
          `</Group></Group>`,
      ],
    });
    const doc = await readIdml(file);
    expect(imageFrame(doc.spreads[0].frames[0]).bounds).toEqual({ x: 130, y: 100, width: 60, height: 80 });
  });

  it('computes the bounding box of a rotated frame', async () => {
    const file = await buildRawIdml({
      stories: {},
      spreads: [
        `<Rectangle Self="r1" ItemTransform="0 1 -1 0 0 0">${path(0, 0, 30, 40)}` +
          `<Image Self="i1"><Link LinkResourceURI="file:/Links/a.jpg"/></Image></Rectangle>`,
      ],
    });
    const doc = await readIdml(file);
    expect(imageFrame(doc.spreads[0].frames[0]).bounds).toEqual({ x: -40, y: 0, width: 40, height: 30 });
  });

  it('exposes link uri', async () => {
    const linkUri = 'file:/Users/grafico/Lavori/Links/copripalo%20prisma%20%C3%A8.jpg';
    const file = await buildIdml({
      spreads: [{ frames: [{ kind: 'image', link: linkUri, x: 0, y: 0, w: 100, h: 100 }] }],
    });
    const doc = await readIdml(file);
    expect(imageFrame(doc.spreads[0].frames[0]).linkUri).toBe(linkUri);
  });

  it('reads placed pdf drawings and ignores graphics without a link', async () => {
    const file = await buildRawIdml({
      stories: {},
      spreads: [
        `<Rectangle Self="r1" ItemTransform="1 0 0 1 0 0">${path(0, 0, 10, 10)}<PDF Self="p1"><Link LinkResourceURI="file:/Links/esploso.pdf"/></PDF></Rectangle>` +
          `<Rectangle Self="r2" ItemTransform="1 0 0 1 0 0">${path(0, 0, 10, 10)}<Image Self="i2"><Properties/></Image></Rectangle>` +
          `<Rectangle Self="r3" ItemTransform="1 0 0 1 0 0">${path(0, 0, 10, 10)}</Rectangle>`,
      ],
    });
    const doc = await readIdml(file);
    expect(doc.spreads[0].frames).toHaveLength(1);
    expect(imageFrame(doc.spreads[0].frames[0]).linkUri).toBe('file:/Links/esploso.pdf');
  });

  it('exposes page rectangles in spread coordinates', async () => {
    const file = await buildIdml({
      spreads: [
        {
          pages: [
            { x: 0, y: 0, w: 595, h: 842 },
            { x: 595, y: 0, w: 595, h: 842 },
          ],
          frames: [],
        },
        { frames: [] },
      ],
    });
    const doc = await readIdml(file);
    expect(doc.spreads[0].pages).toEqual([
      { x: 0, y: 0, width: 595, height: 842 },
      { x: 595, y: 0, width: 595, height: 842 },
    ]);
    expect(doc.spreads[0].pages[1].x).toBe(595);
    // senza `pages` il helper scrive una sola pagina che copre lo spread
    expect(doc.spreads[1].pages).toEqual([{ x: 0, y: 0, width: 1190, height: 842 }]);
  });

  it('keeps every threaded frame and reads each story once', async () => {
    const file = await buildRawIdml({
      stories: {
        s1: `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Caratteristiche"><CharacterStyleRange>${content('testo concatenato')}<Br/></CharacterStyleRange></ParagraphStyleRange>`,
      },
      spreads: [
        `<TextFrame Self="f1" ParentStory="s1" NextTextFrame="f2" ItemTransform="1 0 0 1 0 0">${path(0, 0, 100, 50)}</TextFrame>` +
          `<TextFrame Self="f2" ParentStory="s1" PreviousTextFrame="f1" ItemTransform="1 0 0 1 200 0">${path(0, 0, 100, 50)}</TextFrame>`,
      ],
    });
    const doc = await readIdml(file);
    const frames = doc.spreads[0].frames.map(textFrame);
    expect(frames.map((f) => f.storyId)).toEqual(['s1', 's1']);
    expect(frames.map((f) => f.bounds.x)).toEqual([0, 200]);
    expect(doc.stories.size).toBe(1);
  });

  it('ignores notes and xml elements inside stories', async () => {
    const file = await buildRawIdml({
      stories: {
        s1:
          `<InCopyExportOption IncludeGraphicProxies="true"/>` +
          `<XMLElement Self="x1" MarkupTag="XMLTag/Root">` +
          `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Titolo prodotto"><CharacterStyleRange>` +
          `<XMLElement Self="x2" MarkupTag="XMLTag/Nome">${content('COPRIPALO')}</XMLElement>` +
          `<Note Self="n1"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Nota"><CharacterStyleRange>${content('da rivedere')}</CharacterStyleRange></ParagraphStyleRange></Note>` +
          `${content(' PRISMA')}<Br/></CharacterStyleRange></ParagraphStyleRange>` +
          `</XMLElement>`,
      },
      spreads: [`<TextFrame Self="f1" ParentStory="s1" ItemTransform="1 0 0 1 0 0">${path(0, 0, 100, 50)}</TextFrame>`],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([
      { kind: 'paragraph', style: 'Titolo prodotto', text: 'COPRIPALO PRISMA' },
    ]);
  });

  it('decodes entities and keeps text exactly as written', async () => {
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            {
              kind: 'text',
              x: 0,
              y: 0,
              w: 100,
              h: 100,
              items: [{ kind: 'paragraph', style: 'Caratteristiche', text: ' 100% A&B <8.8> “ok” 0640 ' }],
            },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([
      { kind: 'paragraph', style: 'Caratteristiche', text: ' 100% A&B <8.8> “ok” 0640 ' },
    ]);
  });

  it('keeps numeric-looking text unchanged', async () => {
    const rows = [['1.10', '0.50', '1e3', '007', '1.024']];
    const file = await buildIdml({
      spreads: [
        {
          frames: [
            {
              kind: 'text',
              x: 0,
              y: 0,
              w: 100,
              h: 100,
              items: [{ kind: 'paragraph', style: 'Caratteristiche', text: '1.10' }, { kind: 'table', rows }],
            },
          ],
        },
      ],
    });
    const doc = await readIdml(file);
    expect(itemsOf(doc, textFrame(doc.spreads[0].frames[0]))).toEqual([
      { kind: 'paragraph', style: 'Caratteristiche', text: '1.10' },
      { kind: 'table', rows },
    ]);
  });

  it('rejects a package without designmap.xml', async () => {
    const file = await writeIdml({ 'Stories/Story_s1.xml': '<Story Self="s1"/>' });
    await expect(readIdml(file)).rejects.toThrow('designmap.xml');
  });
});

describe('parseTransform', () => {
  it('reads six numbers and defaults to identity when absent', () => {
    expect(parseTransform('1 0 0 1 -595.5 20')).toEqual([1, 0, 0, 1, -595.5, 20]);
    expect(parseTransform(undefined)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('rejects malformed transforms', () => {
    expect(() => parseTransform('1 0 0 1')).toThrow('1 0 0 1');
    expect(() => parseTransform('1 0 0 1 x y')).toThrow('x y');
  });
});
