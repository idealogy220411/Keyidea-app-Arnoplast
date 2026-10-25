# SDD ledger — plan: docs/superpowers/plans/2026-10-24-fase-1-schema-convertitore.md

Spec: docs/superpowers/specs/2026-10-24-app-catalogo-arnoplast-design.md (reachable, approved)
Branch: claude/app-catalogo-design (feature branch, not main). Branch start commit: dbb106a^ (repo root) — use `git rev-list --max-parents=0 HEAD` as MERGE_BASE for final review of code (or first task BASE).
Task 11 is BLOCKED on the user's real IDML sample — not executed in this run.

## Pre-flight scan

| Tasks | Produces → Consumes | Finding |
|---|---|---|
| T1 → T3/T6/T8/T9/T10 | LineData/Product/Category/Article/IndexFile, MATERIALS, ARTICLE_CODE_RE | Consistent field names (features/dimensions LocalizedList, perPack/perBox/perPallet, previous ≤5). |
| T1 ↔ T8 | schema rejects dup code in one product; checkLine must report it as exactly 1 Issue | Risk of double reporting (schema issue + explicit check). See Ruling 2. |
| T1 (self) | test `rejects non-youtube-like url` vs rule "only http(s)" | Name broader than rule; youtube host check lives in T5 `isVideoUrl`. Ruling 1. |
| T2 → T3/T4/T9 | IdmlDocument, StoryItem, buildIdml helper | Consistent. Spreads only expose frames; real catalog has facing pages per spread. Ruling 3 (add pages). |
| T3 → T4 | LanguageExtract, RawProduct.anchor {spreadIndex,x,y} | Consistent. |
| T4 → T6 | AttachedLanguage, imageLinks/drawingLinks, AttachedCategory.imageLink | Consistent. |
| T4 (self) | category opener "no product on the spread" + nearest-title on spread | Facing pages would mix left/right products. Ruling 3. |
| T5 → T9 | decodeQr, isVideoUrl | Consistent. |
| T6 → T9 | MergedLine/MergedProduct/MergedCategory | Consistent. T6 throws without `it`; T9 must check first to produce an Issue ("italiano"). Noted in T9 dispatch. |
| T7 (self) | test `rasterizes pdf drawings` says "pdftocairo da un SVG" | pdftocairo cannot make PDF from SVG. Ruling 4. |
| T7 → T9 | processImage(src,imgDir)→ImageRef, rasterizeVector→Buffer, UnsupportedImageError | Consistent. |
| T8 → T9 | checkLine, renderReport(stats incl. videos) | Consistent. |
| T9 → T10 | build output `<out>/<linea>/<edizione>/data.json`, `<out>/<linea>/img/` | T10 tests need "a build from T9's helper" but T9 defines no exported helper. Ruling 5. |
| T3 → T10 | ConverterConfig.contacts? | Consistent; publish errors when missing. |
| T9/T10 cli.ts | T9 creates, T10 modifies | Consistent. |

Per-task self-consistency: T1 ok (lockfile in commit); T2 ok; T3 ok (config path relative — implementer may resolve relative to test file); T4 ok; T5 ok (devDep qrcode); T6 ok; T7 see Ruling 4; T8 see Ruling 2; T9 ok; T10 ok (.htaccess + FTPS note); T11 blocked.

## Rulings

- Ruling 1: `@arnoplast/schema` validates `videoUrl` as http(s) URL only; YouTube host check stays in T5 `isVideoUrl`; test name kept — avoids duplicating host rules in two places — if wrong, a non-YouTube http URL could pass schema (T9 only sets videoUrl when isVideoUrl is true, so no real path).
- Ruling 2: schema refinement messages are in Italian and include the offending id/code; `checkLine` maps each schema issue to exactly one Issue and does NOT add a second explicit issue for "duplicate code in one product" / "product without articles" — plan T8 test requires exactly 1 error — if wrong, report messages are slightly less tailored.
- Ruling 3: T2 also exposes `pages: Rect[]` on `IdmlSpread` (from `<Page GeometricBounds ItemTransform>`; synthetic helper creates one page covering the spread by default, optional `pages` override). T4 applies its rules per PAGE (page containing the frame centre; nearest page if none) instead of per spread: category image = largest image on the category title's page if no product title on that page; image → product with nearest title above on the same page; page without product titles → last product of the previous page in reading order — the printed catalog uses facing pages (e.g. p8 opener + p9 Prisma on one spread) and spread-level rules would misassign photos — cost if wrong: a little extra code; tests from the plan still hold.
- Ruling 4: T7 PDF test uses a tiny hand-written valid PDF fixture committed at `converter/test/fixtures/disegno.pdf` (one page, one stroked path) — pdftocairo cannot create PDF from SVG — cost if wrong: none.
- Ruling 5: T9 exports `makeSampleInput(dir: string): Promise<string>` from `converter/test/helpers/sample-input.ts` (creates `<dir>/it` and `<dir>/en` with IDML + Links: PNG photo, QR PNG for https://youtu.be/abc123, PDF drawing; returns the input dir). T10 tests run `buildLine` on it to get a real build dir — the plan says T10 uses "un build prodotto dal helper del Task 9" without naming it — cost if wrong: none.

## Progress
Task 1: dispatched implementer (sonnet) agent ad5a7efc30d258e5c, BASE 2dcbf9c
Task 1: implementer DONE_WITH_CONCERNS (commit 8655f1d; 17/17). Concerns noted: dangling category ref yields 2 schema issues (T8 must not expect exactly 1 for that case); videoUrl via http(s) regex; extra constraints (positive ints for pack fields, optionalCodes match code regex, sha256 hex64, contacts non-empty). Reviewer dispatched (sonnet) a7b7683ae69bff055.
Task 1: review Approved, spec ✅. ⚠️ resolved: T8 plan tests don't expect exactly-1 for dangling refs (ok); trailers checked in git log.
Task 1: minor (deferred): dangling-ref test can't prove id interpolation ('inesistente' collides with template word) — schema.test.ts:116
Task 1: minor (deferred): several negative tests only assert toThrow(ZodError), not path
Task 1: minor (deferred): untested constraints (edition format, lang key case, unknown line id, sha256 hex, generatedAt ISO, perPack 0/non-int, optionalCodes format, null accepted)
Task 1: minor (deferred): HTTP_URL_RE overlapping quantifiers (index.ts:20)
Task 1: minor (deferred): category may list same product id twice (index.ts:190-208)
Task 1: minor (deferred): MAX_PREVIOUS_EDITIONS not exported (index.ts:16) — T10 may duplicate literal 5
Task 1: minor (deferred): duplicated language message (index.ts:36,:57)
Task 1: minor (deferred): no engines/packageManager pin; esbuild build script not approved (onlyBuiltDependencies)
Task 1: minor (deferred): empty localized text accepted ({it:''})
- Ruling 6: quantity cells equal to 0 are mapped by T3 to null + warning (schema requires positive ints; a stray "0" must not block publication) — cost if wrong: a real 0 would show as absent, which has no meaning for pack/box/pallet anyway.
Task 1: complete (commits 2dcbf9c..8655f1d, review clean)
Task 2: dispatched implementer (sonnet) ac0083fefffcb9d51, BASE 8655f1d (with Ruling 3: pages)
Task 2: implementer DONE_WITH_CONCERNS (0ff132f; 39/39). Concerns: group? added to image TestFrame; extra helpers buildRawIdml/writeIdml; read.ts 273 lines; parsing choices (blank paras dropped, no trim, cell paras joined by space, linkless graphics skipped, missing designmap parts throw, malformed transform throws); schema dep to be added in T3.
Task 2: reviewer dispatched (sonnet) a07f8c4ecdb789a75
Task 2: review Approved, spec ✅ (reviewer probed real-IDML-shaped XML incl. PIs, MasterSpread, facing pages: OK). ⚠️ resolved: workspace includes converter; trailers present.
Task 2: minor (deferred): styleName catch fallback and multi-level groups untested (read.ts:71-75)
Task 2: minor (deferred): silent skips (no geometry, no ParentStory, embedded image without Link) have no diagnostics channel (read.ts:206-212)
Task 2: minor (deferred): malformed-transform error lacks spread/file location (geometry.ts:16)
Task 2: minor (deferred): no XML well-formedness validation (read.ts:254-258)
Task 2: minor (deferred): hidden items/layers (Visible=false) not filtered — check on real file in T11 (read.ts:194-215)
Task 2: minor (deferred): Footnote/Change merge into text; nested tables dropped; $ID/NormalParagraphStyle returned as-is
Task 2: minor (deferred): build-idml helper coupled to vitest (afterAll)
Task 2: minor (deferred): small test duplication (path()/pathXml(), redundant assertion idml.test.ts:152)
Task 2: minor (deferred): read.ts 273 lines — split into story.ts/spread.ts if it grows
Task 2: complete (commits 8655f1d..0ff132f, review clean)
Task 3: dispatched implementer (sonnet) a95028220fa342081, BASE 0ff132f (Ruling 6 carried; anchor = first frame of story; where='spread N')
Task 3: implementer DONE_WITH_CONCERNS (349a8f3; 66/66). Concerns: product before any category = error+skip; new category closes current product; reading order literal y-then-x without tolerance (tune in T11); '-' bullet only with space; integers only (1.5 → null+warn); strict config keys; articleColumns requires code+description.
Task 3: reviewer dispatched (sonnet) a8e05ce63e4605e0a
Task 3: review Approved, spec ✅. ⚠️ resolved: reviewer ran focused check on lines record (enforced at runtime); judgment calls (hyphen bullet with space only; product before category = error; category closes product) accepted.
Task 3: minor (deferred): unmatched overrides.materials keys silent; config side not whitespace-normalised (extract.ts:417-421)
Task 3: minor (deferred): wrong style names give empty error-free extract (extract.ts:378-408) — see Ruling 7 (handled in T9)
Task 3: minor (deferred): duplicate languages / duplicate articleColumns accepted (config.ts:140-163)
Task 3: minor (deferred): config tests don't assert Italian zod locale, missing/unknown line, optionalPattern default
Task 3: minor (deferred): `where` uses spread of story's first frame for threaded stories (extract.ts:359)
Task 3: minor (deferred): rows with empty code but other filled cells dropped silently (extract.ts:315-319)
Task 3: minor (deferred): fixed heading list (CÓD., German) and em-dash/minus warn instead of null — tune in T11 (extract.ts:264,292)
Task 3: minor (deferred): `quote` helper duplicated (config.ts:128, extract.ts:270); misplaced-content wording when product rejected
- Ruling 7: T9 `buildLine` adds a blocking error «nessun prodotto trovato in <lingua>: controlla gli stili in catalogo.config.yaml» when a language extract has zero products — a wrong style mapping must not produce an empty but "valid" catalog — cost if wrong: none (an empty line is never a legitimate publication).
Task 3: complete (commits 0ff132f..349a8f3, review clean)
Task 4: dispatched implementer (sonnet) ab43853184fa13d15, BASE 349a8f3 (Ruling 3 per-page rules + 2 extra facing-page tests; images before any product dropped with warning; resolveLink tolerant)
Task 4: implementer DONE_WITH_CONCERNS (8666795; 89/89). Concerns: opener page breaks continuation (images after opener w/o titles dropped+warn); non-largest opener images dropped silently; two categories on one opener page share image; within product order page,y,x; exported linkFileName.
Task 4: reviewer dispatched (sonnet) a7a1d7b6afcb4952b
Task 4: review Approved, spec ✅. ⚠️ resolved: page rects and frame bounds share spread coordinates (confirmed in T2 review); XML page order assumed left→right — verify on real IDML in T11; trailer follows controller's attribution (Opus 5.5) — correct.
Task 4: minor (deferred): resolveLink returns first case-insensitive match; prefer exact NFC match first (links.ts:32)
Task 4: minor (deferred): resolveLink readdir per call; cache per dir in T9 if needed (links.ts:23-33)
Task 4: minor (deferred): exact y comparison for in-product order, no tolerance (associate.ts:48-49)
Task 4: minor (deferred): non-largest opener images dropped silently; two categories on one opener page share image (associate.ts:106-116,139-140)
Task 4: minor (deferred): quote helper and 'spread N' format duplicated (associate.ts:14,149 vs extract.ts)
Task 4: minor (deferred): missing boundary tests (centre == title y, gutter centre, equal-y titles, NFD URI vs NFC file)
Task 4: minor (deferred): anchor spreadIndex not in doc → silent (defensive only)
Task 4: minor (deferred): full-bleed photo across opener+product page centres on gutter → attaches to product (Ruling 3 limitation; check in T11)
Task 4: complete (commits 349a8f3..8666795, review clean)
Task 5: dispatched implementer (sonnet) a9ec12457d1842da4, BASE 8666795 (+robustness: upscale/quiet-zone retry, extra test; onlyBuiltDependencies sharp/esbuild)
Task 5: implementer DONE (a2753ed; 96/96). Extras: flatten white for transparent PNG; ×2 retry only if long side ≤1200px; tiny-QR test. WASM loaded from node_modules (wasmBinary).
Task 5: reviewer dispatched (sonnet) a6352bb40f5128d0a
Task 5: review Approved, spec ✅ (reviewer verified offline WASM with fetch stubbed, host spoofing negatives, many formats). ⚠️ resolved: trailer per controller attribution (Opus 5.5) correct; onlyBuiltDependencies at root is the pnpm 10 location.
Task 5: minor (deferred): full-res RGBA decode of large photos (~0.9 s, ~375 MB for 6000×4000) — see Ruling 8 (qr.ts:56-62)
Task 5: minor (deferred): isVideoUrl spoofing negatives not pinned by tests (qr.test.ts:77-82)
Task 5: minor (deferred): offline WASM guarantee has no committed regression test (stub fetch) (qr.ts:28-33)
Task 5: minor (deferred): weak negative control (flat colour) in 'returns null for a photo'
Task 5: minor (deferred): systemic failures (sharp/WASM missing) silent → zero videos; optional one-time warning
Task 5: minor (deferred): >1200px cap branch untested (qr.ts:63)
Task 5: minor (deferred): isVideoUrl accepts userinfo/port (harmless)
Task 5: minor (deferred): @types/emscripten peer not declared (auto-install-peers)
- Ruling 8: T9 processes linked images sequentially (no unbounded Promise.all) so QR decoding of large photos stays memory-bounded; build time of a few minutes for a full catalog is acceptable for an agency command run a few times a year — cost if wrong: slower builds, fixable later with a size pre-check.
Task 5: complete (commits 8666795..a2753ed, review clean)
- Ruling 9: mergeLanguages returns all input-language issues (Italian first) with `where` prefixed by `<lang>: `, followed by its own warnings (`where` = lang); categoryId slug with -2/-3 suffix; conflicting foreign matches → most shared codes wins; empty slug → 'prodotto'/'categoria' — the plan left the combined issue list and these tie-breaks unspecified and T9 needs a single list — cost if wrong: report wording only.
Task 6: dispatched implementer (sonnet) a5482473d7f0e7073, BASE a2753ed (Ruling 9)
Task 6: implementer DONE (b9b9747; 116/116). Concerns: empty foreign description written as ''; categoryByOrder.get()! relies on extraction; losing foreign product not reassigned.
Task 6: reviewer dispatched (sonnet) a4cfffb875d53f6fb
Task 6: review Approved, spec ✅. ⚠️ (test runs) — implementer evidence accepted; reviewer verified extract invariants make `!` safe.
Task 6: minor (deferred): foreign category lookup not pinned by a test with differing orders (merge.test.ts:214-283)
Task 6: minor (deferred): empty foreign description written as '' instead of falling back to it (merge.ts:201-202) — triage with T1 'empty localized text accepted'
Task 6: minor (deferred): duplicate language entries not guarded (merge.ts:134)
Task 6: minor (deferred): weak assertion merge.test.ts:106
Task 6: minor (deferred): losing foreign product not reassigned to second-best (Ruling 9 behaviour)
Task 6: complete (commits a2753ed..b9b9747, review clean)
Task 7: dispatched implementer (sonnet) a39ce5df61db54099, BASE b9b9747 (Ruling 4 PDF fixture; rotate/flatten/srgb; CMYK test; pdftoppm failure → UnsupportedImageError)
Task 7: implementer DONE (fed1952; 132/132). Extras: write errors not wrapped; ENOENT pdftoppm rethrown; regen if detail unreadable; sharp format whitelist. Trailer says Sonnet 5.5 (its own attribution reminder) — accepted, accurate for the model that wrote it; future dispatches: use own attribution trailers.
Task 7: reviewer dispatched (sonnet) a7438e1dd7115433d
Task 7: review Approved, spec ✅ (reviewer probed truncated WebP recovery). ⚠️ resolved: ImageRef shape from T1 matches; T9 hand-off see Ruling 11.
Task 7: minor (deferred): RASTER_FORMATS whitelist untested — SVG buffer would pass (media.ts:106)
Task 7: minor (deferred → fixed in T9 by Ruling 10): 'no temporary files' test scans global tmpdir — flaky with concurrent workers (media.test.ts:424-432)
Task 7: minor (deferred): rasterizeVector no timeout; signal-killed pdftoppm escapes raw; exit 0 without PNG → raw ENOENT (media.ts:131-138)
Task 7: minor (deferred): original sharp error discarded (no `cause`) (media.ts:109-111)
Task 7: minor (deferred): load-bearing write order (thumb then detail) undocumented (media.ts:114-115)
Task 7: minor (deferred): source decoded twice for thumb/detail (media.ts:107-108)
- Ruling 10: Task 9's dispatch includes making `converter/test/media.test.ts`'s leftover-temp-dir test hermetic (private TMPDIR via vi.stubEnv, or before/after set comparison), because T9 adds concurrent rasterizeVector calls from another vitest worker — cost if wrong: none.
- Ruling 11: for drawings, T9 writes rasterizeVector's PNG to a temp file and calls processImage on it, so the file name hash is of the rasterized PNG (deterministic for a given poppler version); a poppler upgrade may rename drawings and cause a one-time re-upload — acceptable, documented in the converter README — cost if wrong: extra upload bytes once.
Task 7: complete (commits b9b9747..fed1952, review clean)
Task 8: dispatched implementer (sonnet) aa0e83813acedbc6b, BASE fed1952 (Ruling 2; warnings on raw input; report HTML details)
Task 8: implementer DONE (0880300; 156/156). Notes: shared-code warning where=code; trimmed description compare; static apostrophe in status.
Task 8: reviewer dispatched (sonnet) a0223a35595842f8c
Task 8: review Approved, spec ✅. ⚠️ (test runs) — implementer evidence accepted.
Task 8: minor (deferred): checkLine warning pass throws on null entries / non-string description; test 'does not throw on malformed input' overstates (checks.ts:35-39,74,88)
Task 8: minor (deferred): missing images yields schema error + 'non ha immagini' warning (checks.ts:78)
Task 8: minor (deferred): 'report escapes html' test hand-builds message rather than via checkLine (report.test.ts:518-523)
Task 8: minor (deferred): empty schema path case untested
Task 8: complete (commits fed1952..0880300, review clean)
- Ruling 12: when a build has blocking errors, buildLine writes report.html but does NOT write data.json (and removes a stale one in that edition folder), so `publish` (which requires a valid data.json) cannot publish a failed build — the plan only validates the schema at publish time, and a build with e.g. a missing linked image can still be schema-valid — cost if wrong: the agency must fix errors before even inspecting data.json (report.html still explains everything).
Task 9: dispatched implementer (sonnet) ad48db25e0a2447d0, BASE 0880300 (Rulings 5,7,8,10,11,12 + image rules + input validation)
Task 9: implementer DONE_WITH_CONCERNS (556013a; 177/177). Concerns: build.ts 262 lines; missing pdftoppm = exception; outDir = --out root; issues chronological; extra warning 'cartella lingua mancante'; test 'writes report next to data' needed a product without photo (report shows names only via warnings).
Task 9: reviewer dispatched (opus, integration task) ad3480805493e77e2
Task 9: review Needs fixes (opus). Important: (1) stale data.json survives when buildLine throws (build.ts:247-259); (2) plan-mandated: report cannot show products, needed by brief test and T11 step 4.
- Ruling 13: renderReport gets an optional per-product summary (`products?: Array<{ category: string; name: string; codes: number; images: number; drawings: number; video: boolean }>`, Italian names, reading order) rendered as a «Prodotti» table after the issue tables; buildLine passes it; the brief's clean-sample assertion (report of a clean build contains «COPRIPALO PRISMA») is restored — Task 11 step 4 compares products in report.html with the PDF, and the agency needs that overview — cost if wrong: a slightly longer report.
- Ruling 14: build.ts may be split (image helpers → converter/src/build-media.ts) to absorb the fixes — keeps files focused — cost if wrong: none.
- Ruling 15: Task 10's dispatch adds converter/README.md to its files (publish/rollback commands and ARNO_* variables) — the T9 README left a placeholder — cost if wrong: none.
Task 9: minor (deferred): macOS AppleDouble '._*.idml' counted as second IDML (build.ts:85)
Task 9: minor (deferred): foreign language with zero products still merged → many 'traduzione mancante' warnings (build.ts:107-111)
Task 9: minor (deferred): LineData.name lists languages not built (build.ts:214)
Task 9: minor (deferred): commander 15 requires Node ≥ 22.12 (documented in README)
Task 9: fix round 1 dispatched (resume implementer) — findings: stale data.json on throw; Ruling 13 products in report; Ruling 14 split allowed. FIX_BASE 556013a
Task 9: fix round 1 implementer DONE (2e9d586; 182/182; build-media.ts split, build.ts 219 lines). Re-review pending.
Task 9: re-review round 1 dispatched (sonnet) a597f72038324df54, range 556013a..2e9d586
Task 9: fix round 1/5 (2 addressed, 0 open — stale data.json on throw; products in report (Ruling 13); commits 556013a..2e9d586). Re-review: no new breakage.
Task 9: minor (deferred): data.json written non-atomically (truncated file possible on ENOSPC); publish validates with parseLineData so a truncated file cannot ship
Task 9: complete (commits 0880300..2e9d586, review clean after 1 fix round)
Task 10: dispatched implementer (sonnet) ae43f5ecdea20f916, BASE 2e9d586 (Ruling 15 README; path-escape guard; atomic writeText; edition/line match check; .htaccess content)
Task 10: implementer DONE (1d3ac68; 216/216). Notes: atomic upload too; only .webp uploaded; empty contacts / invalid remote index stop early; posix-rename required (no fallback, documented); MAX_PREVIOUS_EDITIONS exported from schema; ssh2 build scripts ignored warning; data.json 1-year cache documented. Manually tested SftpStore against a temporary local OpenSSH (removed afterwards).
Task 10: reviewer dispatched (opus, security/atomicity) acb0af36f9391c314
Task 10: review Approved (opus), spec ✅. ⚠️ resolved: SftpStore close/mkdir semantics checked in library source by reviewer; typecheck/test output from report (verified independently by controller earlier at 2e9d586; full suite re-run in final review).
Task 10: minor (deferred): test assertion `exists('catalogo-prova')` can never fail (readFile on dir) (publish.test.ts:136)
Task 10: minor (deferred): no test asserts existing images are skipped on re-run
Task 10: minor (deferred): data.json hashed from one read, uploaded from a second read (publish.ts:90,157)
Task 10: minor (deferred): rollback hashes decoded/re-encoded text (publish.ts:203,214)
Task 10: minor (deferred): re-publishing same edition overwrites live data.json before index; immutable cache (plan-level; README warns)
Task 10: minor (deferred): contacts checked only after SFTP connect (cli.ts:110-111)
Task 10: minor (deferred): some SFTP / missing report.html errors surface in English; report.html not pre-checked (store.ts:148-153, publish.ts:158)
Task 10: minor (deferred, needs user decision): no SSH host-key verification (MITM risk with password auth) and no keepalive (store.ts:136)
Task 10: minor (deferred): dead vi.unstubAllEnvs; ssh2 build-script warning; @types/ssh2-sftp-client major mismatch
Task 10: complete (commits 2e9d586..1d3ac68, review clean)
Final review: dispatched (opus) a395ed2006b0abb91, range 2dcbf9c..1d3ac68, with deferred-minor triage
Final review: With fixes (opus). 0 Critical, 7 Important: (1) facing-page reading order in extract; (2) re-publish same edition + data.json immutable cache; (3) no SSH host-key verification; (4) missing translations unreported / empty values block it fallback; (5) unreadable/vector QR unreported, second video dropped silently; (6) product ids lack line prefix (spec §6); (7) missing poppler raw English error, no timeout. FIX NOW deferred: T3 empty-code rows; T6 empty desc (in #4); T7 timeout/ENOENT (in #7); T9 '._*.idml'; T10 read-twice + skip-existing test + vacuous exists assertion (with #2).
- Ruling 16: SFTP requires `ARNO_SFTP_HOST_FINGERPRINT` (format `SHA256:<base64>` as printed by `ssh-keygen -lf`); missing → refuse to connect and print the server's fingerprint in Italian with instructions to verify it with the hosting provider; mismatch → refuse — with password auth an unverified host key exposes the hosting credentials; refusing is the safe default — cost if wrong: one extra setup step for the operator.
- Ruling 17: product ids are `<linea>/<slug>` (e.g. `agricoltura/copripalo-prisma`) as spec §6 states; category ids stay `<slug>` (unique within a line) — the spec is the binding authority and the app searches across lines — cost if wrong: ids change before any real publish, so nothing breaks.
- Ruling 18: `.htaccess`: `index.json` and `data.json` → `no-cache`; `*.webp` → `public, max-age=31536000, immutable`. publishLine refuses (Italian message suggesting a new edition number) when the remote `<edizione>/data.json` exists with a different sha256; identical → no re-upload. The exact validated/hashed bytes are uploaded — re-publishing a corrected file under the same edition would otherwise be served stale for a year — cost if wrong: operators must bump the edition to correct a published one (documented).
- Ruling 19: QR handling: rasterized drawings are QR-decoded too (a video QR becomes videoUrl, not a drawing); new optional config `qrFilenamePattern` (default `qr`, case-insensitive) — a matching linked file that does not decode → warning «QR code non leggibile: <file>», not used as photo or drawing; a second, different video URL on a product → warning — spec §7 lists "QR non leggibili" as a warning — cost if wrong: an image named with "qr" that is a real photo would be dropped with a warning (visible in the report).
- Ruling 20: merge sets a language key only when the value has content (non-empty description, non-empty features/dimensions list); one warning per product and language «traduzione incompleta (<lingua>): <nome>» naming missing article descriptions and empty lists where Italian has content — spec §6 fallback to Italian must work and be reported — cost if wrong: none.
Final fix wave: dispatched ONE fixer (opus) a0de4558f258b1343, FIX_BASE 1d3ac68, findings file final-fix-findings.md (items 1-9)
PAUSED by user request (2026-10-25): fixer a0de4558f258b1343 stopped before any change; HEAD 1d3ac68 clean, 216 tests green. Resume: re-dispatch ONE fixer with final-fix-findings.md (items 1-9), then scoped re-review of 1d3ac68..HEAD, then finishing. Task 11 still blocked on client's IDML package.
