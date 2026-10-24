import { readFile } from 'node:fs/promises';
import {
  LANG_RE,
  LINE_IDS,
  MATERIALS,
  REFERENCE_LANG,
  type LineId,
  type LocalizedText,
  type Material,
} from '@arnoplast/schema';
import { parse } from 'yaml';
import { z } from 'zod';

export type ConverterConfig = {
  /** Lingue del catalogo, con `it` (riferimento) sempre presente. */
  languages: string[];
  /** Nome di ogni linea, per lingua. */
  lines: Record<LineId, { name: LocalizedText }>;
  /** Nomi degli stili di paragrafo InDesign che il convertitore riconosce. */
  styles: { category: string; product: string; feature: string; dimension: string; material: string };
  /** Significato di ogni colonna della tabella articoli, per posizione. */
  articleColumns: Array<'code' | 'description' | 'perPack' | 'perBox' | 'perPallet' | 'ignore'>;
  /** Espressione regolare (senza distinzione tra maiuscole e minuscole) delle descrizioni degli articoli optional. */
  optionalPattern: string;
  /** Estensioni dei file dei disegni tecnici, con il punto iniziale. */
  drawingExtensions: string[];
  contacts?: { email: string; whatsapp: string };
  overrides?: { materials?: Record<string, Material[]> };
};

const DEFAULT_OPTIONAL_PATTERN = '\\(optional\\)';

const quote = (value: unknown) => `«${String(value)}»`;

const text = z.string().min(1);

const langCode = z.string().regex(LANG_RE, {
  error: (issue) => `Codice lingua non valido: ${quote(issue.input)} (servono due lettere minuscole, per esempio «en»)`,
});

const material = z.enum(MATERIALS, {
  error: (issue) => `Materiale sconosciuto: ${quote(issue.input)} (ammessi: ${MATERIALS.join(', ')})`,
});

const lineName = z.record(langCode, text).refine((name) => Object.hasOwn(name, REFERENCE_LANG), {
  error: `Manca il nome nella lingua di riferimento ${quote(REFERENCE_LANG)}`,
});

const configSchema: z.ZodType<ConverterConfig> = z.strictObject({
  languages: z.array(langCode).refine((languages) => languages.includes(REFERENCE_LANG), {
    error: `L'elenco delle lingue deve contenere la lingua di riferimento ${quote(REFERENCE_LANG)}`,
  }),
  lines: z.record(
    z.enum(LINE_IDS, { error: (issue) => `Linea sconosciuta: ${quote(issue.input)} (ammesse: ${LINE_IDS.join(', ')})` }),
    z.strictObject({ name: lineName }),
  ),
  styles: z.strictObject({
    category: text,
    product: text,
    feature: text,
    dimension: text,
    material: text,
  }),
  articleColumns: z
    .array(z.enum(['code', 'description', 'perPack', 'perBox', 'perPallet', 'ignore']))
    .refine((columns) => columns.includes('code'), { error: 'Serve una colonna «code»' })
    .refine((columns) => columns.includes('description'), { error: 'Serve una colonna «description»' }),
  optionalPattern: z
    .string()
    .refine(
      (pattern) => {
        try {
          new RegExp(pattern, 'i');
          return true;
        } catch {
          return false;
        }
      },
      { error: (issue) => `Espressione regolare non valida: ${quote(issue.input)}` },
    )
    .default(DEFAULT_OPTIONAL_PATTERN),
  drawingExtensions: z.array(
    z.string().regex(/^\.[A-Za-z0-9]+$/, {
      error: (issue) => `Estensione non valida: ${quote(issue.input)} (serve il punto iniziale, per esempio «.pdf»)`,
    }),
  ),
  contacts: z.strictObject({ email: text, whatsapp: text }).optional(),
  overrides: z.strictObject({ materials: z.record(z.string(), z.array(material)).optional() }).optional(),
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- ${issue.path.map(String).join('.') || '(radice)'}: ${issue.message}`)
    .join('\n');
}

/** Legge e controlla il file di configurazione YAML. Gli errori sono in italiano. */
export async function loadConfig(filePath: string): Promise<ConverterConfig> {
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    const reason =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'il file non esiste'
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`File di configurazione non leggibile (${filePath}): ${reason}`);
  }

  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    throw new Error(
      `File di configurazione con YAML non valido (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = configSchema.safeParse(raw, { error: z.locales.it().localeError });
  if (!result.success) {
    throw new Error(`Configurazione non valida (${filePath}):\n${describeIssues(result.error)}`);
  }
  return result.data;
}
