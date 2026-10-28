/** Rettangolo in coordinate dello spread (punti tipografici, origine al centro dello spread). */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * `style` è lo stile di **carattere** InDesign (non di paragrafo): nel file reale tutto il testo usa lo stesso
 * stile di paragrafo (`NormalParagraphStyle`), quindi solo lo stile di carattere distingue titoli, caratteristiche,
 * dimensioni e celle di tabella. Stringa vuota = nessuno stile di carattere applicato.
 */
export type StoryItem =
  | { kind: 'paragraph'; style: string; text: string }
  | { kind: 'table'; rows: string[][] };

export type Story = { id: string; items: StoryItem[] };

export type TextFrame = { kind: 'text'; storyId: string; bounds: Rect };
export type ImageFrame = { kind: 'image'; linkUri: string; bounds: Rect };

export type IdmlSpread = {
  index: number;
  /** Pagine dello spread, nell'ordine in cui compaiono nell'XML, in coordinate dello spread. */
  pages: Rect[];
  frames: Array<TextFrame | ImageFrame>;
};

export type IdmlDocument = { spreads: IdmlSpread[]; stories: Map<string, Story> };

export type Issue = { level: 'error' | 'warning'; message: string; where?: string };
