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
## Rulings

- Ruling 1: `@arnoplast/schema` validates `videoUrl` as http(s) URL only; YouTube host check stays in T5 `isVideoUrl`; test name kept — avoids duplicating host rules in two places — if wrong, a non-YouTube http URL could pass schema (T9 only sets videoUrl when isVideoUrl is true, so no real path).
- Ruling 2: schema refinement messages are in Italian and include the offending id/code; `checkLine` maps each schema issue to exactly one Issue and does NOT add a second explicit issue for "duplicate code in one product" / "product without articles" — plan T8 test requires exactly 1 error — if wrong, report messages are slightly less tailored.
- Ruling 3: T2 also exposes `pages: Rect[]` on `IdmlSpread` (from `<Page GeometricBounds ItemTransform>`; synthetic helper creates one page covering the spread by default, optional `pages` override). T4 applies its rules per PAGE (page containing the frame centre; nearest page if none) instead of per spread: category image = largest image on the category title's page if no product title on that page; image → product with nearest title above on the same page; page without product titles → last product of the previous page in reading order — the printed catalog uses facing pages (e.g. p8 opener + p9 Prisma on one spread) and spread-level rules would misassign photos — cost if wrong: a little extra code; tests from the plan still hold.
- Ruling 4: T7 PDF test uses a tiny hand-written valid PDF fixture committed at `converter/test/fixtures/disegno.pdf` (one page, one stroked path) — pdftocairo cannot create PDF from SVG — cost if wrong: none.
- Ruling 5: T9 exports `makeSampleInput(dir: string): Promise<string>` from `converter/test/helpers/sample-input.ts` (creates `<dir>/it` and `<dir>/en` with IDML + Links: PNG photo, QR PNG for https://youtu.be/abc123, PDF drawing; returns the input dir). T10 tests run `buildLine` on it to get a real build dir — the plan says T10 uses "un build prodotto dal helper del Task 9" without naming it — cost if wrong: none.

- Ruling 6: quantity cells equal to 0 are mapped by T3 to null + warning (schema requires positive integers).
- Ruling 7: buildLine (T9) emits a blocking error «nessun prodotto trovato in <lingua>: controlla gli stili in catalogo.config.yaml» when a language extract has zero products.
- Ruling 8: buildLine (T9) processes linked images sequentially (no unbounded Promise.all) to keep QR decoding of large photos memory-bounded.
- Ruling 9: mergeLanguages returns all input-language issues (it first) with where prefixed '<lang>: ', then its own warnings (where = lang).
- Ruling 10: T9 makes media.test.ts's leftover-temp-dir test hermetic (private TMPDIR via vi.stubEnv or before/after comparison).
- Ruling 11: drawings: T9 writes rasterizeVector's PNG to a temp file and calls processImage on it (hash of the rasterized PNG); documented in README.
- Ruling 12: on blocking errors buildLine writes report.html but not data.json (removes stale one), so publish cannot ship a failed build.
- Ruling 16: SFTP requires ARNO_SFTP_HOST_FINGERPRINT (SHA256:<base64>); missing → refuse and print server fingerprint (Italian); mismatch → refuse.
- Ruling 17: product ids are `<linea>/<slug>`; category ids stay `<slug>`.
- Ruling 18: .htaccess index.json + data.json no-cache, *.webp immutable; publish refuses same edition with different data.json sha256; uploads exact hashed bytes.
- Ruling 19: QR: decode rasterized drawings too; config qrFilenamePattern (default 'qr') → undecodable match = warning «QR code non leggibile», not used; second different video = warning.
- Ruling 20: merge sets language keys only with content; warning «traduzione incompleta (<lingua>): <nome>» per product/language.
