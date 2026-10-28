# Taratura del convertitore sul pacchetto InDesign reale

- **Data:** 28 ottobre 2026
- **Base:** pacchetto reale ricevuto da Arno Plast, linea Agricoltura, italiano,
  file `ARNO PLAST - AGRICOLTURA ITA_2026_1.idml` + 94 file in `Links/`
  (692 MB totali, 13 spread). Copia locale di lavoro usata per l'analisi:
  `/tmp/claude-0/-home-user-Keyidea-app-Arnoplast/bbd1b350-176a-5c2c-8456-e2046b5e401b/scratchpad/indesign-package/`
  (non committare questi file: sono dati del cliente, non vanno nel repository).

## Perché questo documento

Il primo tentativo di `pnpm catalogo build` sul pacchetto reale fallisce subito
(`nessun prodotto trovato`). L'ispezione diretta dell'XML IDML mostra che il
file reale è strutturato in modo diverso da quanto ipotizzato nella Fase 1
(quando non avevamo ancora un file reale a disposizione). Le differenze sono
sistematiche, non errori di battitura nella configurazione: vanno corrette nel
codice del convertitore, non nel file `catalogo.config.yaml`.

## Scoperte (fatti verificati sul file reale)

1. **Non esistono stili di paragrafo personalizzati.** Tutto il testo usa
   `$ID/NormalParagraphStyle`. La distinzione dei ruoli (titolo, caratteristica,
   dimensione, cella di tabella) passa **solo per gli stili di carattere**:
   - `TITOLO` — titolo di prodotto, e anche l'intestazione letterale
     "CARATTERISTICHE" / "DIMENSIONI" dentro il riquadro di caratteristiche o
     dimensioni (stesso stile, contesto diverso: vedi punto 4);
   - `CARATTERTISTICHE` (sic, errore di battitura nel file originale) — le
     righe delle caratteristiche, le righe delle dimensioni, **e** la colonna
     codice nelle tabelle articoli (tre usi diversi dello stesso stile);
   - `testo tabelle` — le altre colonne delle tabelle articoli;
   - `tab_nome` — le intestazioni di colonna delle tabelle (`Cod.`,
     `Descrizione`, `Conf.`, `Imb.`, `Pallet`) e alcuni valori numerici fuori
     tabella (quote di disegno tecnico, non ci riguardano);
   - **nessuno stile** (`$ID/[No character style]`) — le sigle materiale
     (`PE`, `PP`, …) e il testo `(optional)` nelle descrizioni articolo.
2. **Le colonne della tabella sono nell'ordine già previsto**: Cod.,
   Descrizione, Conf., Imb., Pallet → `[code, description, perPack, perBox, perPallet]`.
   Nessuna modifica necessaria a `articleColumns`.
3. **Le sigle materiale vanno riconosciute dal contenuto, non dallo stile.**
   Un frame di testo che non ha stile di carattere e il cui contenuto (ripulito)
   è esattamente una delle sigle di `MATERIALS` è un bollino materiale.
   `styles.material` nella configurazione attuale non ha più senso: va tolto.
4. **"CARATTERISTICHE" e "DIMENSIONI" sono intestazioni letterali, non frame
   separati.** Sono il primo paragrafo (stile `TITOLO`) della stessa storia
   (frame di testo) che contiene poi le righe vere e proprie (stile
   `CARATTERTISTICHE`). Vanno riconosciute per confronto testuale (senza
   maiuscole/minuscole, per lingua — serve una nuova voce di configurazione,
   es. `styles.featuresHeading` / `styles.dimensionsHeading` con il testo
   atteso per lingua) e scartate: non sono il nome di un prodotto.
5. **Non esiste una pagina "apertura categoria" con il nome della categoria
   in grande.** La struttura reale è:
   - una pagina indice all'inizio del documento linea, con l'elenco delle
     categorie e il numero di pagina (nel file analizzato: copripalo,
     sistemi di legatura, accessori/PET e ricambi, ferma-teli e reti,
     placchette, moschettoni e tiranti, ancoraggi/ganci/chiodi — sette
     categorie per la sola linea Agricoltura);
   - su ogni pagina di prodotto, un'etichetta ricorrente piccola, senza stile
     di carattere, con il nome della categoria corrente (es. "copripalo"),
     ripetuta a margine pagina — non un titolo.
   **Decisione:** le categorie di ogni linea (identificativo, nome per lingua,
   ordine) si dichiarano in `catalogo.config.yaml`, come già si fa per le
   linee. L'estrazione riconosce l'inizio di una categoria quando incontra un
   frame senza stile di carattere il cui contenuto (ripulito, senza
   maiuscole/minuscole) corrisponde al nome di una categoria dichiarata per
   quella lingua; da quel punto la categoria corrente è quella, finché non se
   ne incontra un'altra. Un prodotto trovato prima di qualunque etichetta di
   categoria è un errore da segnalare (non deve succedere nel catalogo reale,
   la pagina indice viene prima dei prodotti).
6. **Un frame con solo testo in stile `TITOLO` non è sempre un titolo di
   prodotto.** Nelle pagine "Copripalo" compare spesso un riquadro
   "OPTIONAL DI FISSAGGIO" seguito da una o più etichette come "VITERIA
   STANDARD 4 PZ" o "VITERIA GZ": **non sono prodotti a sé stanti** (confermato
   con il cliente). Sono il campo «optional di fissaggio» del prodotto
   principale già previsto in specifica (sezione 6, Prodotto): un riferimento
   testuale, non a un vero e proprio codice articolo separato (le righe della
   tabella del prodotto principale già includono i codici degli accessori,
   es. "1807-1357 Viteria per Cp (4pz.)"; le etichette "VITERIA…" sono solo
   la didascalia dell'illustrazione a fianco, ridondante con la tabella).
   **Decisione:** una nuova voce di configurazione con il testo letterale
   dell'intestazione per lingua (es. `styles.optionalFixingHeading`, valore
   italiano "OPTIONAL DI FISSAGGIO"). Quando l'estrazione incontra un frame
   `TITOLO`-puro il cui testo corrisponde a questa intestazione, entra in
   «modalità optional»: ogni frame `TITOLO`-puro successivo, finché non si
   incontra un frame di tipo diverso (caratteristiche, dimensioni, bollino
   materiale, tabella, immagine), è il nome di un optional di fissaggio del
   prodotto **corrente** (quello aperto dal titolo precedente), non l'inizio
   di un nuovo prodotto. Il campo risultante in `RawProduct`/`Product` è un
   elenco di testo per lingua (non un riferimento a codici: il file reale non
   permette di collegarli in modo affidabile).
7. Un frame `TITOLO`-puro che non è né un'intestazione caratteristiche/
   dimensioni, né l'intestazione optional, né dentro una sequenza «modalità
   optional», è un titolo di prodotto (comportamento esistente, confermato).

## Conseguenze sul codice

- **`packages/schema` / `src/types.ts`**: `StoryItem` (variante `paragraph`)
  deve portare lo stile di **carattere**, non quello di paragrafo. Verificare
  se serve ancora lo stile di paragrafo per qualche altro uso (al momento no:
  nessuna delle regole sopra lo usa).
- **`src/idml/read.ts`**: `readItems`/`walk` deve tracciare
  `AppliedCharacterStyle` del `CharacterStyleRange` più vicino (stessa logica
  di normalizzazione nome già scritta per `AppliedParagraphStyle`, ma sul
  prefisso `CharacterStyle/` e sullo stile vuoto
  `$ID/[No character style]` → stringa vuota) e chiudere (`flush`) anche
  quando lo stile di carattere cambia, non solo su `<Br/>` o a fine
  `ParagraphStyleRange` (altrimenti un'intestazione `TITOLO` seguita da un
  `<Br/>` in stile diverso nello stesso paragrafo viene accorpata con lo
  stile sbagliato — caso reale: la storia delle caratteristiche, vedi punto 4).
  Aggiungere test con la struttura esatta trovata nel file reale (paragrafo
  con due `CharacterStyleRange` diversi senza un proprio `ParagraphStyleRange`).
- **`catalogo.config.yaml` / `src/config.ts` (zod)**:
  - `styles.material` da togliere (non più uno stile);
  - aggiungere `styles.featuresHeading` e `styles.dimensionsHeading` (testo
    atteso per lingua, es. `{it: CARATTERISTICHE, en: FEATURES}`);
  - aggiungere `styles.optionalFixingHeading` (stesso formato, es.
    `{it: 'OPTIONAL DI FISSAGGIO', en: ...}`);
  - aggiungere `categories` per linea: elenco di `{id, name: {it, en, …}}`,
    nello stesso stile di `lines`. L'ordine nell'elenco è l'ordine di
    pubblicazione (coerente con `RawCategory.order`, che oggi viene dedotto
    dall'ordine di comparsa — da verificare se con le categorie dichiarate in
    config ha più senso ordinarle come compaiono nel config, o come compaiono
    nel catalogo: **l'ordine nel catalogo resta quello giusto** — l'elenco in
    config serve solo a *riconoscere* il nome, l'ordine resta quello con cui
    le etichette compaiono leggendo il documento, come oggi).
- **`src/extract.ts`**: riscrivere la classificazione dei frame secondo le
  regole 3-7 sopra. In particolare serve uno stato "modalità optional" nel
  ciclo di lettura (si attiva sull'intestazione optional, si disattiva al
  primo frame che non è un titolo puro). Il materiale si riconosce sul
  contenuto (confronto con `MATERIALS`), indipendentemente dallo stile.
- **`src/merge.ts` / `packages/schema`**: aggiungere il campo opzionale
  «optional di fissaggio» (elenco di testo per lingua) al tipo `Product`,
  se non already previsto (controllare `RawProduct`/schema attuali: la
  specifica lo cita ma verificare se il tipo TypeScript/zod esiste già).

## Come procedere

1. TDD come nelle fasi precedenti: aggiornare prima `test/idml/read.test.ts`
   (o dove sta il test del reader) con un caso che riproduce la struttura
   reale (paragrafo con più `CharacterStyleRange`, stile di carattere invece
   che di paragrafo), poi `src/types.ts` e `src/idml/read.ts`.
2. Poi `src/config.ts` + `catalogo.config.yaml` (nuovi campi, con un commento
   in italiano su cosa sono, come il resto del file).
3. Poi `src/extract.ts`, con test che riproducono ciascuna delle regole 3-7
   usando l'helper di test `buildIdml` esistente, aggiornato per generare
   stili di carattere invece che di paragrafo (verificare quante fixture di
   test esistenti vanno aggiornate: è un cambiamento trasversale, la build
   `pnpm test` deve restare verde).
4. Aggiornare `catalogo.config.yaml` con le categorie reali della linea
   Agricoltura trovate nell'indice del pacchetto (elencate al punto 5 sopra),
   come primo esempio concreto; le altre linee restano con un elenco
   segnaposto da correggere quando arriveranno i rispettivi pacchetti.
5. **Prova di fuoco finale**: eseguire
   `pnpm catalogo build --linea agricoltura --edizione 2026.1 --input <cartella con it/ dal pacchetto reale> --out <cartella temporanea>`
   sul pacchetto reale scaricato (percorso sopra) e verificare che:
   - non ci siano errori;
   - il numero di prodotti/categorie nel rapporto sia ragionevole (il
     documento ha circa 16-18 titoli `TITOLO`-puri che non sono intestazioni
     optional — un conteggio preciso va fatto leggendo il rapporto, non
     indovinato);
   - i materiali, le caratteristiche, le dimensioni e le tabelle dei primi
     3-4 prodotti (Copripalo Prisma, Copripalo Qubo, Copripalo Zephiro,
     Copripalo Monviso) corrispondano a quanto si legge a mano nell'XML
     (già verificato in parte durante l'analisi: vedi i contenuti riportati
     sopra per Prisma).
   Questa build reale non va committata né nel repository né altrove: serve
   solo a verificare che il convertitore funzioni, i dati restano nella
   cartella temporanea di lavoro.
6. Tenere **una sola lingua** (italiano) per questa taratura: il pacchetto
   ricevuto non ha l'inglese. Non toccare la logica di unione delle lingue.
7. Commit in italiano, in alcuni passaggi logici coerenti con l'elenco sopra;
   non fare push (lo stesso schema seguito per le revisioni precedenti).
