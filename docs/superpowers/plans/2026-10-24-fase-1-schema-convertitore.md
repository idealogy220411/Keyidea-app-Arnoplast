# Fase 1 · Schema dei dati e convertitore da InDesign · Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Obiettivo:** uno strumento a riga di comando che trasforma i pacchetti InDesign (IDML + Links) di una linea in un catalogo validato (JSON + immagini WebP + rapporto HTML) e lo pubblica sull'hosting via SFTP, con ambiente di prova e ritorno all'edizione precedente.

**Architettura:**

- **Repository:** monorepo pnpm con due pacchetti.
  - `packages/schema` definisce il formato pubblicato con zod. Lo useranno sia il convertitore sia l'app.
  - `converter` legge l'IDML (zip di XML) e ricostruisce testi, tabelle e posizione dei frame. Riconosce i campi dagli stili di paragrafo indicati in un file di configurazione, associa le immagini ai prodotti per posizione, decodifica i QR code dei video, unisce le lingue per codice articolo, genera le immagini e pubblica.
- **Cartelle sull'hosting:**
  - i dati vanno in una cartella per edizione (`<radice>/<linea>/<edizione>/data.json`);
  - le immagini vanno in una cartella condivisa tra le edizioni (`<radice>/<linea>/img/`), con nomi basati sul contenuto. Così una nuova edizione carica solo le immagini nuove e il ritorno indietro trova sempre le sue immagini.

**Tecnologie:**

- Node.js 22, pnpm 10, TypeScript 7 (strict, ESM), vitest 5, zod 4;
- fast-xml-parser 5, jszip 3, sharp 0.35, zxing-wasm 3, yaml 2, commander 15, ssh2-sftp-client 12;
- `pdftoppm` di poppler per i disegni vettoriali.

**Specifica:** `docs/superpowers/specs/2026-10-24-app-catalogo-arnoplast-design.md` (sezioni 5, 6, 7, 11).

## Vincoli globali

- **Ambiente:**
  - Node.js ≥ 22; pnpm workspace; TypeScript `strict: true`, moduli ESM.
  - Si esegue con `tsx`, senza passaggio di compilazione.
  - `pdftoppm` (poppler-utils) deve essere installato. Su Mac: `brew install poppler`.
- **Lingua dei testi:**
  - Il codice (nomi di funzioni, tipi, chiavi JSON) è in inglese.
  - Messaggi della CLI, rapporto HTML e commenti nel file di configurazione sono in italiano.
- **Identificativi:**
  - Linee: `agricoltura`, `garden`, `olive`.
  - Lingue: codici ISO 639-1 minuscoli (`/^[a-z]{2}$/`). La lingua di riferimento `it` è sempre presente.
  - Edizione: `/^\d{4}\.\d+$/` (es. `2026.1`).
  - Codice articolo: `/^\d{4}-\d{4}[A-Z]{0,3}$/` (es. `1807-1351`, `1807-1310GZ`, `1807-0308GR`).
  - Materiali ammessi: `FE`, `FV`, `PA`, `PET`, `PE`, `PP`, `PVC`.
- **Immagini:**
  - formato WebP;
  - miniatura con lato lungo 400 px, dettaglio con lato lungo 1600 px, senza ingrandire le immagini più piccole;
  - nome file `<sha256 primi 16 caratteri del file sorgente>-400.webp` e `-1600.webp`.
- **Pubblicazione:**
  - radice `catalogo/` per la produzione, `catalogo-prova/` per la prova;
  - indice in `<radice>/index.json`; al massimo 5 edizioni in `previous`.
- **Credenziali:** solo da variabili d'ambiente `ARNO_SFTP_HOST`, `ARNO_SFTP_PORT` (predefinito 22), `ARNO_SFTP_USER`, `ARNO_SFTP_PASSWORD` oppure `ARNO_SFTP_KEY_PATH`, `ARNO_SFTP_ROOT`. Con `ARNO_STORE_LOCAL_DIR` si pubblica su una cartella locale, per prove a secco.
- **Codici di uscita:** `build` e `publish` escono con codice 1 se ci sono errori bloccanti, 0 altrimenti.

## Attenzione in revisione

1. **Nomi file con spazi, accenti o percorsi del Mac del grafico nel `LinkResourceURI`:** sono URL codificati, e il Mac salva gli accenti in forma NFD. Il collegamento deve risolversi comunque al file in `Links/`. Test in Task 4: `resolves encoded and NFD file names`.
2. **Stesso codice articolo in più prodotti:** succede con gli accessori, per esempio `1807-0751` Mon-block compare in Prisma, Qubo e Zephiro. Non è un errore; lo è solo il codice ripetuto nello stesso prodotto. Diventa un avviso se le descrizioni differiscono. Test in Task 8: `allows a shared accessory code across products`.
3. **Celle della tabella articoli con «-», vuote o non numeriche:** diventano `null`, con un avviso se il valore non è numerico. Le righe di intestazione e i separatori si saltano senza errori. Test in Task 3: `parses dash, empty and non-numeric cells`.
4. **Immagini collegate in formati non convertibili (PSD, EPS):** sono un avviso, e il prodotto resta senza quell'immagine. Un file collegato mancante è invece bloccante. Test in Task 7: `rejects unsupported formats with a typed error`. Test in Task 9: `reports missing link as error and unsupported format as warning`.
5. **Pubblicazione interrotta a metà:** `index.json` si aggiorna solo dopo che tutti i file sono stati caricati. Una nuova esecuzione riprende senza errori. Test in Task 10: `does not touch index when an upload fails` e `is idempotent when re-run`.

---

## Struttura dei file

```
package.json                     script di root (test, typecheck)
pnpm-workspace.yaml
tsconfig.base.json
packages/schema/
  package.json
  src/index.ts                   costanti, schemi zod, tipi, parseLineData, parseIndex
  test/schema.test.ts
converter/
  package.json                   bin "catalogo" → src/cli.ts (tsx)
  catalogo.config.yaml           abbinamento stili → campi (da calibrare, Task 11)
  README.md                      uso per l'agenzia, in italiano
  src/
    types.ts                     Issue, Rect, tipi intermedi condivisi
    idml/read.ts                 readIdml → IdmlDocument
    idml/geometry.ts             trasformazioni e bounding box
    config.ts                    loadConfig
    extract.ts                   extractLanguage (testi, tabelle, categorie)
    links.ts                     resolveLink
    associate.ts                 attachImages (immagini → prodotti)
    qr.ts                        decodeQr
    merge.ts                     mergeLanguages
    media.ts                     processImage, rasterizeVector
    checks.ts                    checkLine
    report.ts                    renderReport
    build.ts                     buildLine (orchestrazione)
    publish/store.ts             RemoteStore, LocalStore, SftpStore, storeFromEnv
    publish/publish.ts           publishLine, rollbackLine
    cli.ts                       comandi build, publish, rollback
  test/
    helpers/build-idml.ts        crea IDML sintetici per i test
    *.test.ts
    fixtures/                    campione reale (Task 11)
```

---

### Task 1: Monorepo e pacchetto `schema`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `packages/schema/package.json`, `packages/schema/tsconfig.json`, `packages/schema/src/index.ts`
- Test: `packages/schema/test/schema.test.ts`

**Interfaces:**
- Produces (export da `@arnoplast/schema`):
  - `LINE_IDS = ['agricoltura','garden','olive'] as const`, `type LineId`
  - `MATERIALS = ['FE','FV','PA','PET','PE','PP','PVC'] as const`, `type Material`
  - `ARTICLE_CODE_RE`, `EDITION_RE`, `LANG_RE`, `REFERENCE_LANG = 'it'`
  - `type LocalizedText = Record<string, string>`: deve contenere la chiave `it`.
  - `type LocalizedList = Record<string, string[]>`: deve contenere la chiave `it`.
  - `type ImageRef = { thumb: string; detail: string; width: number; height: number }`. I percorsi sono relativi alla cartella della linea, es. `img/ab12…-400.webp`.
  - `type Article = { code: string; description: LocalizedText; perPack: number | null; perBox: number | null; perPallet: number | null }`
  - `type Product = { id: string; categoryId: string; name: LocalizedText; materials: Material[]; features: LocalizedList; dimensions: LocalizedList; images: ImageRef[]; drawings: ImageRef[]; videoUrl: string | null; optionalCodes: string[]; articles: Article[] }`
  - `type Category = { id: string; name: LocalizedText; order: number; image: ImageRef | null; productIds: string[] }`
  - `type LineData = { format: 1; line: LineId; edition: string; languages: string[]; name: LocalizedText; categories: Category[]; products: Product[] }`
  - `type LineEntry = { edition: string; path: string; sha256: string; publishedAt: string; previous: string[] }`
  - `type IndexFile = { format: 1; generatedAt: string; contacts: { email: string; whatsapp: string }; lines: Partial<Record<LineId, LineEntry>> }`
  - `lineDataSchema`, `indexSchema` (zod), `parseLineData(json: unknown): LineData`, `parseIndex(json: unknown): IndexFile`. Entrambe lanciano `ZodError` se i dati non sono validi.

- [ ] **Step 1: Prepara il monorepo**

  `pnpm-workspace.yaml` con `packages/*` e `converter`. Root `package.json` con `"type": "module"`, gli script `test` (`vitest run`) e `typecheck` (`tsc -b` o `pnpm -r exec tsc --noEmit`), e le devDependencies `typescript@^7.0.2`, `vitest@^5.0.5`, `tsx@^4.23`, `@types/node@^22`. `.gitignore` con `node_modules/`, `dist/`, `converter/out/`. Esegui `pnpm install`.

- [ ] **Step 2: Scrivi i test che falliscono** in `packages/schema/test/schema.test.ts`, partendo da una fixture `validLine()` minima: 1 categoria, 1 prodotto `agricoltura/copripalo-prisma` con articolo `1807-1351`.
  - `accepts a valid line`: `parseLineData(validLine())` restituisce `edition === '2026.1'`.
  - `requires italian in localized text`: `name: { en: 'X' }` → lancia errore.
  - `rejects bad article code`: `code: '1807-135'` → lancia errore.
  - `accepts suffixed codes`: `1807-1310GZ` e `1807-0308GR` sono validi.
  - `rejects product without articles`: `articles: []` → lancia errore.
  - `rejects unknown material`: `materials: ['ABS']` → lancia errore.
  - `rejects dangling category reference`: `productIds: ['inesistente']` → lancia errore con messaggio che contiene `inesistente`.
  - `rejects duplicate code within one product`: due articoli `1807-1351` nello stesso prodotto → lancia errore.
  - `accepts same code in two products`: `1807-0751` in due prodotti → valido.
  - `rejects non-youtube-like url`: `videoUrl: 'ftp://x'` → lancia errore. Sono ammessi solo `http(s)`.
  - `accepts a valid index`: `parseIndex` con `lines.agricoltura.previous` lungo 5 → valido; lungo 6 → errore.

- [ ] **Step 3: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run packages/schema`
  Expected: FAIL (modulo `../src/index` non trovato)

- [ ] **Step 4: Implementa `packages/schema/src/index.ts`**

  Usa schemi zod con `superRefine` per i controlli incrociati:
  - riferimenti categoria ↔ prodotto;
  - id di prodotti e categorie univoci;
  - codici univoci dentro ogni prodotto;
  - `languages` contiene `it`.

  I tipi si ricavano con `z.infer`. Nome del pacchetto: `@arnoplast/schema`, con `"exports": "./src/index.ts"`.

- [ ] **Step 5: Esegui i test e verifica che passino**

  Run: `pnpm vitest run packages/schema && pnpm typecheck`
  Expected: PASS, nessun errore di tipo

- [ ] **Step 6: Commit**

  ```bash
  git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .gitignore packages/schema
  git commit -m "Aggiungi monorepo e schema dei dati del catalogo"
  ```

---

### Task 2: Lettore IDML

**Files:**
- Create: `converter/package.json`, `converter/tsconfig.json`, `converter/src/types.ts`, `converter/src/idml/geometry.ts`, `converter/src/idml/read.ts`, `converter/test/helpers/build-idml.ts`
- Test: `converter/test/idml.test.ts`

**Interfaces:**
- Produces (`converter/src/types.ts`):
  - `type Rect = { x: number; y: number; width: number; height: number }`, in coordinate dello spread
  - `type StoryItem = { kind: 'paragraph'; style: string; text: string } | { kind: 'table'; rows: string[][] }`
  - `type Story = { id: string; items: StoryItem[] }`
  - `type TextFrame = { kind: 'text'; storyId: string; bounds: Rect }`
  - `type ImageFrame = { kind: 'image'; linkUri: string; bounds: Rect }`
  - `type IdmlSpread = { index: number; frames: Array<TextFrame | ImageFrame> }`
  - `type IdmlDocument = { spreads: IdmlSpread[]; stories: Map<string, Story> }`
  - `type Issue = { level: 'error' | 'warning'; message: string; where?: string }`
- Produces: `readIdml(filePath: string): Promise<IdmlDocument>` in `converter/src/idml/read.ts`
- Produces: `buildIdml(spec: TestIdml): Promise<string>`, helper di test che restituisce il percorso del file creato. Tipi:
  - `TestIdml = { spreads: Array<{ frames: TestFrame[] }> }`
  - `TestFrame = { kind: 'text'; items: StoryItem[]; x: number; y: number; w: number; h: number; group?: { tx: number; ty: number } } | { kind: 'image'; link: string; x: number; y: number; w: number; h: number }`

**Formato IDML da riprodurre nel helper e da leggere:**

- **`designmap.xml`:** elenca gli spread in ordine con `<idPkg:Spread src="Spreads/Spread_<id>.xml"/>`, e le storie con `<idPkg:Story src="Stories/Story_<id>.xml"/>`.
- **Storia:**
  - struttura `<Story Self="<id>">` → `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/<nome>">` → `<CharacterStyleRange>` → `<Content>` e `<Br/>`;
  - un paragrafo finisce a ogni `<Br/>` o alla fine del `ParagraphStyleRange`;
  - le tabelle sono `<Table>` dentro un `CharacterStyleRange`, con `<Cell Name="<colonna>:<riga>">` che contengono a loro volta `ParagraphStyleRange`.
- **Spread:**
  - `<TextFrame ParentStory="<id>" ItemTransform="a b c d tx ty">` e `<Rectangle ItemTransform=…>` → `<Image>` → `<Link LinkResourceURI="file:…"/>`;
  - la geometria è in `Properties/PathGeometry/…/PathPointType@Anchor`;
  - frame dentro `<Group ItemTransform=…>`: le trasformazioni si compongono.
- **Nome dello stile:**
  - togli `ParagraphStyle/`;
  - decodifica `%3a` in `:`;
  - tieni la parte dopo l'ultimo `:`, perché gli stili possono stare in gruppi di stili;
  - `$ID/[No paragraph style]` diventa una stringa vuota.

- [ ] **Step 1: Scrivi `buildIdml`** in `converter/test/helpers/build-idml.ts`. Genera lo zip (`mimetype`, `designmap.xml`, `Stories/`, `Spreads/`) con jszip in una cartella temporanea (`fs.mkdtemp`).

- [ ] **Step 2: Scrivi i test che falliscono** in `converter/test/idml.test.ts`:
  - `reads paragraphs with style names`: storia con paragrafi «Titolo prodotto»/`COPRIPALO PRISMA` e «Caratteristiche»/`viteria certificata 8.8` → `items` uguali, nell'ordine.
  - `splits paragraphs on Br`: due testi separati da `<Br/>` nello stesso range → 2 paragrafi.
  - `strips style groups`: `ParagraphStyle/Prodotti%3aTitolo prodotto` → `style === 'Titolo prodotto'`.
  - `reads tables as rows of cell text`: tabella 2×5 → `rows[1]` è `['1807-1351','Coprip Prisma 7x7 (senza viteria)','40','40','640']`.
  - `keeps spread order from designmap`: 2 spread → `spreads[0].index === 0`, frame del primo spread presenti.
  - `computes bounds with nested group transforms`: frame immagine a (10, 20) dentro un gruppo traslato di (100, 50) → `bounds.x === 110`, `bounds.y === 70`.
  - `exposes link uri`: `linkUri` uguale al valore scritto nel helper.

- [ ] **Step 3: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/idml.test.ts`
  Expected: FAIL (`readIdml` non definito)

- [ ] **Step 4: Implementa i due file**
  - `geometry.ts`: `parseTransform(s: string): Matrix`, `multiply(a: Matrix, b: Matrix): Matrix`, `boundsOf(anchors: Array<[number, number]>, m: Matrix): Rect`.
  - `read.ts`: legge lo zip con jszip e l'XML con fast-xml-parser (`preserveOrder: true`, perché l'ordine di `Content`/`Br`/`Table` conta, e `ignoreAttributes: false`).

- [ ] **Step 5: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter/test/idml.test.ts && pnpm typecheck`
  Expected: PASS

- [ ] **Step 6: Commit**

  ```bash
  git add converter
  git commit -m "Aggiungi lettore IDML con testi, tabelle e posizione dei frame"
  ```

---

### Task 3: Configurazione ed estrazione dei testi

**Files:**
- Create: `converter/src/config.ts`, `converter/catalogo.config.yaml`, `converter/src/extract.ts`
- Test: `converter/test/config.test.ts`, `converter/test/extract.test.ts`

**Interfaces:**
- Consumes: `IdmlDocument`, `Issue` (Task 2); `ARTICLE_CODE_RE`, `MATERIALS`, `LocalizedText` (Task 1)
- Produces:
  - `type ConverterConfig = { languages: string[]; lines: Record<LineId, { name: LocalizedText }>; styles: { category: string; product: string; feature: string; dimension: string; material: string }; articleColumns: Array<'code' | 'description' | 'perPack' | 'perBox' | 'perPallet' | 'ignore'>; optionalPattern: string; drawingExtensions: string[]; contacts?: { email: string; whatsapp: string }; overrides?: { materials?: Record<string, Material[]> } }`
  - `loadConfig(filePath: string): Promise<ConverterConfig>`. Lancia un errore in italiano se il file non è valido.
  - `type RawArticle = { code: string; description: string; perPack: number | null; perBox: number | null; perPallet: number | null }`
  - `type Anchor = { spreadIndex: number; x: number; y: number }`
  - `type RawProduct = { name: string; categoryOrder: number; materials: Material[]; features: string[]; dimensions: string[]; articles: RawArticle[]; optionalCodes: string[]; anchor: Anchor }`
  - `type RawCategory = { name: string; order: number; anchor: Anchor }`
  - `type LanguageExtract = { lang: string; categories: RawCategory[]; products: RawProduct[]; issues: Issue[] }`
  - `extractLanguage(doc: IdmlDocument, config: ConverterConfig, lang: string): LanguageExtract`

**Regole di estrazione:**

- **Ordine di lettura:** spread in ordine; dentro lo spread, i frame di testo per `y` e poi per `x`; ogni storia si legge una volta sola, la prima volta che compare.
- **Categorie e prodotti:**
  - un paragrafo con lo stile `category` apre una categoria;
  - un paragrafo con lo stile `product` apre un prodotto nella categoria corrente;
  - l'`anchor` è il frame della storia in cui si trova il titolo.
- **Campi del prodotto:**
  - i paragrafi `feature` e `dimension` vanno nel prodotto corrente, senza il punto elenco iniziale (`•`, `-`, `▪`) e senza spazi in eccesso;
  - i paragrafi `material` diventano materiali, se il testo è tra i `MATERIALS`; altrimenti avviso.
- **Tabelle:**
  - una tabella appartiene al prodotto corrente;
  - le colonne si leggono secondo `articleColumns`, per posizione;
  - una riga è un articolo solo se la cella `code` rispetta `ARTICLE_CODE_RE`. Le altre righe (intestazioni, separatori) si saltano. Se però la cella codice non è vuota e non è un'intestazione nota (`COD.`, `CODE`, `CÓDIGO`, `CODICE`), si genera un avviso.
- **Valori numerici:** `-`, `–` e la cella vuota diventano `null`. I numeri si leggono togliendo i punti delle migliaia (`1.024` → `1024`). Testo non numerico → `null` più un avviso.
- **Optional:** `optionalCodes` sono i codici la cui descrizione corrisponde a `new RegExp(config.optionalPattern, 'i')` (predefinito `\(optional\)`).
- **Override:** `overrides.materials[nome prodotto in italiano]` sostituisce i materiali letti.
- **Contenuti fuori posto:** testi `feature`, `dimension` o tabelle prima del primo prodotto → avviso con `where` uguale al numero dello spread.

- [ ] **Step 1: Scrivi i test che falliscono** (IDML creati con `buildIdml`):
  - `config: loads the default file`: `loadConfig('converter/catalogo.config.yaml')` → `styles.product === 'Titolo prodotto'`, `articleColumns.length === 5`.
  - `config: reports invalid file in italian`: YAML senza `styles` → errore il cui messaggio contiene `styles`.
  - `extracts category and product hierarchy`: categoria `COPRIPALO`, prodotti `COPRIPALO PRISMA` e `COPRIPALO QUBO` → 1 categoria, 2 prodotti con `categoryOrder === 0`.
  - `extracts features and dimensions without bullets`: `• viteria certificata 8.8` → `features` è `['viteria certificata 8.8']`.
  - `parses article table by position`: tabella del Prisma → 12 articoli, `articles[0]` uguale a `{ code: '1807-1351', description: 'Coprip Prisma 7x7 (senza viteria)', perPack: 40, perBox: 40, perPallet: 640 }`.
  - `parses dash, empty and non-numeric cells`: riga `1807-1357 | Viteria per Cp (4pz.) | 40 | 200 | -` → `perPallet === null`. Riga con `perBox: 'n.d.'` → `null` più 1 avviso. Riga di intestazione `COD.` → nessun avviso.
  - `marks optional codes`: `Dado a griffe M6 (optional)` → `optionalCodes` contiene `2008-0016`.
  - `warns on unknown material`: bollino `ABS` → `materials` vuoto e 1 avviso.
  - `orders products by spread then position`: prodotto in alto a destra e prodotto in basso a sinistra sullo stesso spread → prima quello in alto.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/config.test.ts converter/test/extract.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa** `config.ts` (yaml + zod) e `extract.ts`. Scrivi `catalogo.config.yaml` con commenti in italiano e questi valori provvisori:
  - stili «Titolo categoria», «Titolo prodotto», «Caratteristiche», «Dimensioni», «Bollino materiale»;
  - `articleColumns: [code, description, perPack, perBox, perPallet]`;
  - `languages: [it, en]`;
  - nomi delle linee: Agricoltura/Agriculture, Garden/Garden, Raccolta olive/Olive harvesting;
  - `drawingExtensions: [.ai, .pdf, .eps, .svg]`.

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter && pnpm typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Estrai categorie, prodotti e tabelle articoli dagli stili di paragrafo"
  ```

---

### Task 4: Collegamenti e associazione delle immagini

**Files:**
- Create: `converter/src/links.ts`, `converter/src/associate.ts`
- Test: `converter/test/links.test.ts`, `converter/test/associate.test.ts`

**Interfaces:**
- Consumes: `IdmlDocument`, `ImageFrame` (Task 2); `LanguageExtract`, `RawProduct`, `RawCategory`, `ConverterConfig` (Task 3)
- Produces:
  - `resolveLink(linkUri: string, linksDir: string): Promise<string | null>`. Restituisce il percorso assoluto del file in `linksDir`, oppure `null` se manca.
  - `type AttachedProduct = RawProduct & { imageLinks: string[]; drawingLinks: string[] }`. Contengono `linkUri` grezzi, nell'ordine di lettura (alto → basso, sinistra → destra).
  - `type AttachedCategory = RawCategory & { imageLink: string | null }`
  - `type AttachedLanguage = Omit<LanguageExtract, 'products' | 'categories'> & { products: AttachedProduct[]; categories: AttachedCategory[] }`
  - `attachImages(doc: IdmlDocument, extract: LanguageExtract, config: ConverterConfig): AttachedLanguage`

**Regole:**

- **`resolveLink`:**
  - prende la parte dopo l'ultimo `/` del percorso dell'URI;
  - la decodifica con `decodeURIComponent` e la normalizza in NFC;
  - la confronta, senza distinguere maiuscole e minuscole, con i nomi dei file di `linksDir` (anche questi normalizzati NFC).
- **Immagine di categoria:** il frame immagine più grande (per area) sullo spread dell'`anchor` della categoria, se su quello spread non c'è nessun prodotto. Altrimenti `null`.
- **Immagini dei prodotti:** ogni altro frame immagine dello spread va al prodotto il cui `anchor` sullo stesso spread ha la `y` più grande ma ≤ `bounds.y + bounds.height / 2` del frame. Se nessuno la soddisfa, va al primo prodotto dello spread.
- **Spread senza prodotti propri:** le immagini vanno all'ultimo prodotto dello spread precedente. Succede quando un prodotto occupa più pagine.
- **Foto o disegno:** se l'estensione è in `drawingExtensions` va in `drawingLinks`, altrimenti in `imageLinks`.

- [ ] **Step 1: Scrivi i test che falliscono:**
  - `resolves encoded and NFD file names`: in `Links/` c'è `copripalo prisma è.jpg` scritto in NFD; l'URI è `file:/Users/grafico/Lavori/Links/copripalo%20prisma%20%C3%A8.jpg` → trova il file.
  - `returns null for missing link`: URI di un file assente → `null`.
  - `assigns images to the nearest product title above`: spread con titoli a y=100 e y=500, immagini a y=150 e y=600 → la prima va al prodotto 1, la seconda al prodotto 2.
  - `separates drawings by extension`: `esploso.ai` → `drawingLinks`; `foto.jpg` → `imageLinks`.
  - `uses opener photo for category`: spread con solo il titolo di categoria e due immagini → `imageLink` è la più grande.
  - `carries images to previous product on continuation spread`: spread 2 senza titoli → le sue immagini vanno all'ultimo prodotto dello spread 1.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/links.test.ts converter/test/associate.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `links.ts` e `associate.ts`**

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter && pnpm typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Risolvi i collegamenti e associa le immagini ai prodotti"
  ```

---

### Task 5: Decodifica dei QR code dei video

**Files:**
- Create: `converter/src/qr.ts`
- Test: `converter/test/qr.test.ts` (devDependency `qrcode` per generare i QR nei test)

**Interfaces:**
- Produces:
  - `decodeQr(filePath: string): Promise<string | null>`. Restituisce il testo del primo QR trovato, o `null`.
  - `isVideoUrl(text: string): boolean`. Vero per `http(s)` con host `youtube.com`, `www.youtube.com`, `m.youtube.com` o `youtu.be`.

**Approccio:** sharp decodifica l'immagine in RGBA grezzo (`.ensureAlpha().raw()`), e `readBarcodes` di zxing-wasm la legge con `formats: ['QRCode']`. Se sharp non riesce a leggere il file, la funzione restituisce `null` senza lanciare errori.

- [ ] **Step 1: Scrivi i test che falliscono:**
  - `decodes a youtube qr`: PNG generato da `https://youtu.be/abc123` → restituisce quella stringa.
  - `returns null for a photo`: PNG a tinta unita generato con sharp → `null`.
  - `returns null for unreadable file`: file di testo con estensione `.jpg` → `null`.
  - `recognizes video urls`: `https://www.youtube.com/watch?v=x` → vero; `https://example.com` → falso; `ftp://youtu.be/x` → falso.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/qr.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `qr.ts`**

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter/test/qr.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Leggi i link ai video dai QR code"
  ```

---

### Task 6: Unione delle lingue

**Files:**
- Create: `converter/src/merge.ts`
- Test: `converter/test/merge.test.ts`

**Interfaces:**
- Consumes: `AttachedLanguage`, `AttachedProduct` (Task 4); `LocalizedText`, `LocalizedList` (Task 1)
- Produces:
  - `type MergedArticle = { code: string; description: LocalizedText; perPack: number | null; perBox: number | null; perPallet: number | null }`
  - `type MergedProduct = { id: string; categoryId: string; name: LocalizedText; materials: Material[]; features: LocalizedList; dimensions: LocalizedList; articles: MergedArticle[]; optionalCodes: string[]; imageLinks: string[]; drawingLinks: string[] }`
  - `type MergedCategory = { id: string; name: LocalizedText; order: number; imageLink: string | null; productIds: string[] }`
  - `type MergedLine = { languages: string[]; categories: MergedCategory[]; products: MergedProduct[]; issues: Issue[] }`
  - `mergeLanguages(perLang: AttachedLanguage[]): MergedLine`. Lancia un errore se manca `it`.
  - `slugify(text: string): string`: minuscole, senza accenti, `[^a-z0-9]+` → `-`, senza trattini all'inizio o alla fine.

**Regole:**

- **Lingua di riferimento:** `it` dà struttura, ordine, numeri della tabella, materiali, optional e immagini.
- **Abbinamento dei prodotti:** un prodotto in un'altra lingua corrisponde al prodotto italiano con cui condivide più codici articolo. A parità vince il primo nell'ordine.
- **Prodotti senza corrispondenza:**
  - un prodotto straniero senza codici in comune → avviso «prodotto presente solo in <lingua>: <nome>», e viene scartato;
  - un prodotto italiano senza corrispondenza in una lingua → avviso «traduzione mancante (<lingua>): <nome>».
- **Testi tradotti:** `description` di un articolo per lingua, cercata per codice nel prodotto abbinato. Se manca, nessuna chiave per quella lingua; l'app userà l'italiano.
- **Nome della categoria in un'altra lingua:** il nome più frequente tra le categorie dei prodotti abbinati in quella lingua.
- **Identificativi:**
  - `categoryId = slugify(nome it)`;
  - `id` del prodotto = `slugify(nome it)`; se il nome si ripete nella linea, si aggiunge `-2`, `-3` nell'ordine di lettura.

- [ ] **Step 1: Scrivi i test che falliscono:**
  - `matches products across languages by codes`: Prisma `it` con `1807-1351` e `1807-1352`, `en` «POST CAP PRISMA» con gli stessi codici → `name` è `{ it: 'COPRIPALO PRISMA', en: 'POST CAP PRISMA' }`.
  - `merges article descriptions per code`: `description.en` di `1807-1351` presa dal prodotto inglese.
  - `warns on product only in foreign language`: prodotto `en` con codici sconosciuti → 1 avviso che contiene `solo in en`, ed escluso.
  - `warns on missing translation`: prodotto `it` senza corrispondenza `en` → avviso che contiene `traduzione mancante (en)`.
  - `translates category names by majority`: 2 prodotti abbinati nella categoria `en` «POST CAPS» → `name.en === 'POST CAPS'`.
  - `slugifies with suffix on duplicates`: due prodotti `COPRIPALO` → id `copripalo` e `copripalo-2`.
  - `slugify strips accents`: `slugify('Accessori, PET e ricambi')` → `accessori-pet-e-ricambi`; `slugify('Ø 6cm')` → `6cm`.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/merge.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `merge.ts`**

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter/test/merge.test.ts && pnpm typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Unisci le lingue per codice articolo"
  ```

---

### Task 7: Elaborazione delle immagini

**Files:**
- Create: `converter/src/media.ts`
- Test: `converter/test/media.test.ts`

**Interfaces:**
- Consumes: `ImageRef` (Task 1)
- Produces:
  - `class UnsupportedImageError extends Error { constructor(public file: string) }`
  - `processImage(src: string, imgDir: string): Promise<ImageRef>`: scrive in `imgDir` e restituisce percorsi `img/<hash>-400.webp` e `img/<hash>-1600.webp`, con `width` e `height` della versione dettaglio. Se i file esistono già non li riscrive.
  - `rasterizeVector(src: string): Promise<Buffer>`: per `.pdf` e `.ai` esegue `pdftoppm -png -r 200 -singlefile`. Per gli altri formati vettoriali lancia `UnsupportedImageError`.

**Formati:**
- Raster supportati da sharp: JPEG, PNG, TIFF, WebP, GIF.
- `.psd` e `.eps`, o un file che sharp non riesce a leggere → `UnsupportedImageError`.
- L'hash è lo sha256 dei byte del file sorgente, primi 16 caratteri esadecimali.

- [ ] **Step 1: Scrivi i test che falliscono:**
  - `creates thumb and detail webp`: PNG 3000×2000 generato con sharp → due file WebP; la miniatura è larga 400, il dettaglio 1600 × 1067, e `ImageRef.width === 1600`.
  - `does not upscale small images`: PNG 300×200 → entrambe le versioni restano 300×200.
  - `names files by content hash`: due copie identiche con nomi diversi → stesso `thumb`.
  - `rejects unsupported formats with a typed error`: file `.psd` → `UnsupportedImageError`.
  - `rasterizes pdf drawings`: PDF di una pagina, generato nel test con `pdftocairo` da un SVG oppure tenuto come fixture di 1 KB → restituisce un buffer PNG (i primi 4 byte sono `\x89PNG`).

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/media.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `media.ts`.** `pdftoppm` si chiama con `execFile` passando gli argomenti come array, mai attraverso una shell.

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter/test/media.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Genera miniature e dettagli WebP, anche dai disegni vettoriali"
  ```

---

### Task 8: Controlli e rapporto

**Files:**
- Create: `converter/src/checks.ts`, `converter/src/report.ts`
- Test: `converter/test/checks.test.ts`, `converter/test/report.test.ts`

**Interfaces:**
- Consumes: `LineData`, `lineDataSchema` (Task 1); `Issue` (Task 2)
- Produces:
  - `checkLine(line: LineData): Issue[]`
  - `renderReport(input: { line: LineId; edition: string; issues: Issue[]; stats: { categories: number; products: number; articles: number; images: number; videos: number } }): string`: HTML completo e autonomo, in italiano.

**Controlli di `checkLine`** (si sommano agli avvisi già prodotti nei Task 3–6):

| Livello | Controllo |
|---|---|
| Errore | `lineDataSchema.safeParse` fallisce: un errore per ogni problema, con `where` uguale al percorso del campo |
| Errore | Stesso codice ripetuto nello stesso prodotto |
| Errore | Prodotto senza articoli |
| Avviso | Stesso codice in prodotti diversi con descrizioni `it` diverse |
| Avviso | Prodotto senza immagini |
| Avviso | Categoria senza immagine di apertura |

**Rapporto:**
- in alto, il riepilogo (numeri e un esito «Pronto per la pubblicazione» oppure «Ci sono N errori da correggere»);
- poi la tabella degli errori, poi quella degli avvisi;
- tutto il testo dinamico è escapato in HTML.

- [ ] **Step 1: Scrivi i test che falliscono:**
  - `allows a shared accessory code across products`: `1807-0751` in Prisma e Qubo con la stessa descrizione → nessun problema.
  - `warns when shared code descriptions differ`: stesso codice, descrizioni diverse → 1 avviso che contiene `1807-0751`.
  - `errors on duplicate code in one product`: 1 errore.
  - `warns on product without images`: 1 avviso con il nome del prodotto.
  - `report escapes html`: nome prodotto `<b>X</b>` → nell'HTML compare `&lt;b&gt;X&lt;/b&gt;`.
  - `report shows ready status`: senza errori → contiene `Pronto per la pubblicazione`.
  - `report shows error count`: 2 errori → contiene `Ci sono 2 errori da correggere`.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/checks.test.ts converter/test/report.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `checks.ts` e `report.ts`.** `checkLine` usa `safeParse` direttamente, così il controllo sui codici ripetuti nello stesso prodotto produce un `Issue` invece di un'eccezione.

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter && pnpm typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Aggiungi controlli del catalogo e rapporto HTML"
  ```

---

### Task 9: Comando `build`

**Files:**
- Create: `converter/src/build.ts`, `converter/src/cli.ts`, `converter/README.md`
- Modify: `converter/package.json` (`"bin": { "catalogo": "./src/cli.ts" }`, script `catalogo` = `tsx src/cli.ts`)
- Test: `converter/test/build.test.ts`

**Interfaces:**
- Consumes: tutte le funzioni dei Task 2–8
- Produces:
  - `type BuildResult = { ok: boolean; outDir: string; dataPath: string; reportPath: string; issues: Issue[] }`
  - `buildLine(opts: { line: LineId; edition: string; inputDir: string; outDir: string; configPath: string }): Promise<BuildResult>`
  - CLI: `catalogo build --linea <id> --edizione <AAAA.N> --input <cartella> [--out out] [--config catalogo.config.yaml]`

**Cartella di input:**
- `<input>/<lingua>/` contiene un solo file `.idml` e la cartella `Links/`, cioè la cartella «Pacchetto» di InDesign;
- vengono elaborate solo le lingue presenti in `config.languages`;
- se `it` manca, la build si ferma con un errore.

**Cartella di output:**
- `<out>/<linea>/<edizione>/data.json`;
- `<out>/<linea>/img/*.webp`;
- `<out>/<linea>/<edizione>/report.html`.

**Sequenza:**
1. Per ogni lingua: `readIdml` → `extractLanguage` → `attachImages`.
2. `mergeLanguages`.
3. Per ogni immagine e disegno del riferimento `it`, `resolveLink`:
   - `null` → errore «immagine collegata mancante: <nome>»;
   - immagini raster: prima `decodeQr`. Se è un URL video, diventa `videoUrl` (il primo trovato) e non viene usata come foto. Se è un QR non video → avviso. Altrimenti `processImage`;
   - disegni: `rasterizeVector`, poi `processImage` sul PNG scritto in una cartella temporanea;
   - `UnsupportedImageError` → avviso «formato immagine non supportato: <nome>».
4. Composizione di `LineData`:
   - `format: 1`;
   - `name` da `config.lines[linea].name`;
   - `languages` = lingue elaborate.
5. `checkLine`, poi scrittura di `data.json` (JSON con indentazione 2) e di `report.html`.
6. `ok = nessun errore`. La CLI stampa il riepilogo e il percorso del rapporto, ed esce con 1 se `!ok`.

- [ ] **Step 1: Scrivi i test che falliscono** (input sintetico con `buildIdml` in `it` e `en`, Links con un PNG, un QR e un PDF):
  - `builds a valid line end to end`: `ok === true`; `parseLineData(JSON.parse(data))` non lancia; 1 prodotto con `videoUrl === 'https://youtu.be/abc123'`, 1 immagine e 1 disegno.
  - `reports missing link as error and unsupported format as warning`: link a `manca.jpg` e a `foto.psd` → `ok === false`; 1 errore che contiene `manca.jpg`; 1 avviso che contiene `foto.psd`.
  - `fails without italian`: solo `en/` → l'errore contiene `italiano`.
  - `writes report next to data`: `report.html` esiste e contiene `COPRIPALO PRISMA`.
  - `cli exits 1 on errors`: `execFile('pnpm', ['catalogo','build',…])` sull'input con link mancante → codice di uscita 1.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/build.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `build.ts` e `cli.ts`.** Scrivi `converter/README.md` in italiano: requisiti (Node 22, pnpm, poppler), esportazione da InDesign, struttura della cartella di input, comandi `build`, `publish`, `rollback`, variabili d'ambiente.

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run converter && pnpm typecheck`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Aggiungi comando build che produce dati, immagini e rapporto"
  ```

---

### Task 10: Pubblicazione e ritorno all'edizione precedente

**Files:**
- Create: `converter/src/publish/store.ts`, `converter/src/publish/publish.ts`
- Modify: `converter/src/cli.ts` (comandi `publish` e `rollback`)
- Test: `converter/test/publish.test.ts`

**Interfaces:**
- Consumes: `IndexFile`, `parseIndex`, `LineId` (Task 1); output di `buildLine` (Task 9); `ConverterConfig.contacts` (Task 3)
- Produces:
  - `interface RemoteStore { exists(path: string): Promise<boolean>; readText(path: string): Promise<string | null>; upload(localPath: string, remotePath: string): Promise<void>; writeText(remotePath: string, text: string): Promise<void>; close(): Promise<void> }`. I percorsi sono relativi alla radice del sito.
  - `class LocalStore implements RemoteStore { constructor(rootDir: string) }`
  - `class SftpStore implements RemoteStore { static connect(env: NodeJS.ProcessEnv): Promise<SftpStore> }`
  - `storeFromEnv(env: NodeJS.ProcessEnv): Promise<RemoteStore>`: se `ARNO_STORE_LOCAL_DIR` è impostata usa `LocalStore`, altrimenti `SftpStore`. Se mancano variabili lancia un errore in italiano che le elenca.
  - `publishLine(store: RemoteStore, opts: { line: LineId; edition: string; buildDir: string; env: 'prova' | 'produzione'; contacts: { email: string; whatsapp: string }; now: Date }): Promise<IndexFile>`
  - `rollbackLine(store: RemoteStore, opts: { line: LineId; env: 'prova' | 'produzione'; now: Date }): Promise<IndexFile>`
  - CLI:
    - `catalogo publish --linea <id> --edizione <AAAA.N> [--ambiente prova|produzione] [--out out]` (ambiente predefinito: `prova`);
    - `catalogo rollback --linea <id> [--ambiente prova|produzione]`.

**Regole di `publishLine`:**

1. **Controlli prima di caricare:** la radice è `catalogo-prova/` o `catalogo/`. Se nella cartella di build `data.json` manca o `parseLineData` fallisce, la funzione si ferma prima di caricare qualunque file. Se `contacts` manca → errore «mancano email e WhatsApp in catalogo.config.yaml».
2. **Immagini:** carica ogni file di `<buildDir>/<linea>/img/` in `<radice>/<linea>/img/`, saltando quelli che esistono già (`exists`).
3. **Dati:** carica `data.json` e `report.html` in `<radice>/<linea>/<edizione>/`.
4. **Indice, per ultimo:**
   - legge `<radice>/index.json` (se non esiste, ne crea uno nuovo);
   - per la linea imposta `edition`, `path = '<linea>/<edizione>/data.json'`, `sha256` (dei byte di `data.json` caricati) e `publishedAt = now.toISOString()`;
   - se l'edizione cambia, mette quella vecchia in testa a `previous` (al massimo 5, senza duplicati);
   - aggiorna `generatedAt` e `contacts`;
   - valida con `parseIndex` e scrive.
5. **Errori di caricamento:** se un caricamento fallisce, l'eccezione si propaga e l'indice non viene toccato.
6. **Regole di cache:** alla prima pubblicazione, se `<radice>/.htaccess` non esiste, ne scrive uno per Apache, il server tipico degli hosting WordPress. Contiene:
   - per `index.json`: `Cache-Control: no-cache`;
   - per `*.webp` e per i `data.json` delle edizioni: `Cache-Control: public, max-age=31536000, immutable`.

   Se il file esiste già non lo tocca.

**Regole di `rollbackLine`:**
- prende `previous[0]`;
- calcola lo `sha256` del suo `data.json` remoto (se manca: errore «l'edizione <x> non è più sul server»);
- la imposta come edizione corrente e la toglie da `previous`;
- l'edizione da cui si torna indietro non entra in `previous`;
- senza edizioni precedenti → errore «nessuna edizione precedente per <linea>».

- [ ] **Step 1: Scrivi i test che falliscono** (con `LocalStore` su una cartella temporanea e un build prodotto dal helper del Task 9):
  - `publishes images, data and index`: dopo la pubblicazione esistono `catalogo-prova/agricoltura/img/*.webp`, `catalogo-prova/agricoltura/2026.1/data.json` e un `index.json` con `lines.agricoltura.edition === '2026.1'` e uno `sha256` uguale a quello del file.
  - `does not touch index when an upload fails`: `LocalStore` modificato perché `upload` lanci un errore al terzo file → `index.json` resta assente (o invariato, se esisteva).
  - `is idempotent when re-run`: due pubblicazioni consecutive della stessa edizione → stesso indice (tranne le date) e `previous` vuoto.
  - `keeps previous editions`: pubblicazione di `2026.1` e poi di `2026.2` → `previous` è `['2026.1']`; con 7 edizioni `previous.length === 5`.
  - `rolls back to previous edition`: dopo `2026.1` e `2026.2`, `rollbackLine` → `edition === '2026.1'`, `previous` vuoto, `sha256` uguale a quello di `2026.1/data.json`.
  - `refuses rollback without previous`: lancia un errore che contiene `nessuna edizione precedente`.
  - `refuses invalid build`: `data.json` alterato → lancia un errore e non viene caricato nessun file.
  - `storeFromEnv lists missing variables`: env vuoto → l'errore contiene `ARNO_SFTP_HOST` e `ARNO_SFTP_USER`.
  - `lines are independent`: pubblicare `garden` non modifica `lines.agricoltura`.
  - `writes cache rules once`: dopo la prima pubblicazione `catalogo-prova/.htaccess` contiene `no-cache`. Se lo si modifica a mano, una seconda pubblicazione non lo sovrascrive.

- [ ] **Step 2: Esegui i test e verifica che falliscano**

  Run: `pnpm vitest run converter/test/publish.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implementa `store.ts` e `publish.ts`**
  - `SftpStore` usa ssh2-sftp-client: `exists`, `get`, `fastPut` e `put` (con Buffer). Crea le cartelle con `mkdir(dir, true)`.
  - `writeText` scrive prima su `<path>.tmp` e poi rinomina, così `index.json` non resta mai a metà.
  - FTPS non fa parte di questo task. Se l'hosting non offre SFTP, si aggiunge un `FtpsStore` (con basic-ftp) che implementa la stessa interfaccia `RemoteStore` e supera gli stessi test.

- [ ] **Step 4: Esegui i test e verifica che passino**

  Run: `pnpm vitest run && pnpm typecheck`
  Expected: PASS (tutti i test del repository)

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Pubblica sull'hosting con ambiente di prova e ritorno all'edizione precedente"
  ```

---

### Task 11: Calibrazione sul pacchetto InDesign reale

**Bloccato finché non arriva** il pacchetto di esempio di Agricoltura: alcune pagine (Copripalo Prisma, una pagina con due prodotti, la pagina di apertura di una sezione), in `it` e in una seconda lingua.

**Files:**
- Modify: `converter/catalogo.config.yaml`, e se serve `converter/src/extract.ts` e `converter/src/associate.ts`
- Create: `converter/test/fixtures/agricoltura-campione/{it,en}/…`, `converter/test/sample.test.ts`

**Interfaces:**
- Consumes: `buildLine` (Task 9)
- Produces: configurazione reale degli stili, e test di regressione sul campione

- [ ] **Step 1: Ricava gli stili reali.** Esegui uno script temporaneo con `readIdml` che stampi gli stili di paragrafo distinti con un esempio di testo per ciascuno. Abbinali ai campi in `catalogo.config.yaml`.

- [ ] **Step 2: Scrivi il test di regressione** `converter/test/sample.test.ts`:
  - `sample: Copripalo Prisma matches the printed catalog`:
    - `buildLine` sul campione → il prodotto `copripalo-prisma` ha 12 articoli;
    - `articles[0]` è `{ code: '1807-1351', perPack: 40, perBox: 40, perPallet: 640 }`;
    - `articles` contiene `1807-1357` con `perPallet === null`;
    - `features.it` contiene `viteria certificata 8.8`;
    - `dimensions.it` contiene `dimensioni: 215x115x120 mm`;
    - `materials` è `['PP']`;
    - `videoUrl` inizia con `https://` e `isVideoUrl` è vero;
    - almeno 1 immagine e 1 disegno.
  - `sample: build has no errors`: `ok === true`.

- [ ] **Step 3: Esegui il test.** Se fallisce, correggi la configurazione e, solo dove serve, le regole di estrazione o di associazione. Usa le soluzioni di riserva della specifica (sezione 7, «Da verificare»):
  - materiali dal nome del file collegato o da `overrides.materials`;
  - immagine di apertura indicata nella configurazione.

  Ogni regola nuova ha il suo test con IDML sintetico.

  Run: `pnpm vitest run converter`
  Expected: PASS

- [ ] **Step 4: Verifica il rapporto a occhio.** Apri `out/agricoltura/<edizione>/report.html` e confronta 3 prodotti con il PDF del catalogo. Annota nel README le avvertenze per il grafico, per esempio «un prodotto per frame di testo».

- [ ] **Step 5: Commit**

  ```bash
  git add converter
  git commit -m "Calibra il convertitore sul catalogo Agricoltura reale"
  ```
