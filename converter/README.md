# Convertitore del catalogo Arno Plast

Strumento da riga di comando che trasforma i pacchetti InDesign del catalogo in ciò che legge l'app:
un file `data.json` per linea, le immagini WebP e un rapporto HTML con errori e avvisi.

## Requisiti

- **Node.js 22.12** o successivo.
- **pnpm**.
- **poppler** (serve a trasformare in immagini i disegni tecnici in PDF e AI). Su Mac: `brew install poppler`.

Dalla radice del repository, una volta sola: `pnpm install`.

## Esportare il catalogo da InDesign

Per ogni lingua del catalogo (italiano, inglese…):

1. Apri il documento e scegli **File → Pacchetto**: InDesign crea una cartella con i file collegati nella sottocartella `Links`.
2. Apri il documento copiato nel pacchetto e salvalo anche come **IDML** (**File → Salva con nome**, formato IDML), nella stessa cartella del pacchetto.

Poi riunisci i pacchetti in una sola cartella, con una sottocartella per lingua. Ogni sottocartella contiene **un solo file `.idml`** e la cartella `Links`:

```text
agricoltura-2026.1/
├── it/
│   ├── catalogo.idml
│   └── Links/
│       ├── copripalo-prisma.jpg
│       └── …
└── en/
    ├── catalogo.idml
    └── Links/
```

- La cartella `it` è obbligatoria: l'italiano è la lingua di riferimento (struttura, numeri, materiali e immagini).
- Le altre lingue aggiungono nomi, caratteristiche, dimensioni e descrizioni degli articoli. Il prodotto di una lingua si abbina a quello italiano grazie ai codici articolo che hanno in comune.
- Si elaborano solo le lingue elencate in `catalogo.config.yaml`; le altre cartelle vengono ignorate, con un avviso.
- Le immagini si leggono solo da `it/Links`: le altre lingue usano le stesse.

## Comando `build`

```bash
cd converter
pnpm catalogo build --linea agricoltura --edizione 2026.1 --input ~/Cataloghi/agricoltura-2026.1
```

| Opzione | Significato |
| --- | --- |
| `--linea <id>` | `agricoltura`, `garden` oppure `olive` |
| `--edizione <AAAA.N>` | per esempio `2026.1` |
| `--input <cartella>` | la cartella con le sottocartelle delle lingue |
| `--out <cartella>` | dove scrivere il risultato (predefinito: `out`) |
| `--config <file>` | file di configurazione (predefinito: `catalogo.config.yaml`) |

I percorsi relativi partono dalla cartella da cui si lancia il comando (con `pnpm catalogo` è `converter/`).

Il risultato è in `<out>/<linea>/`:

- `img/`: le immagini WebP, miniatura (`-400`) e dettaglio (`-1600`), con il nome ricavato dal contenuto del file. Le immagini già presenti non si rielaborano.
- `<edizione>/report.html`: il rapporto. Si apre nel browser e riassume categorie, prodotti, articoli, immagini e video, poi elenca **errori** (bloccanti) e **avvisi** e, in fondo, i prodotti con il numero di codici, foto, disegni e l'eventuale video.
- `<edizione>/data.json`: i dati della linea. Si scrive **solo se non ci sono errori**. All'avvio di ogni build `data.json` e `report.html` della stessa edizione vengono tolti: dopo una build con errori (o interrotta da un guasto) il file non c'è, così non si può pubblicare per sbaglio una build fallita o un file vecchio.

Il comando stampa il numero di errori e di avvisi e il percorso del rapporto, ed **esce con codice 1** se ci sono errori, con 0 altrimenti.

Cosa è un errore e cosa un avviso:

- **Errore**: un'immagine collegata nel documento manca in `Links`, manca la cartella `it`, una cartella lingua non ha un solo `.idml`, una lingua non contiene nessun prodotto (controlla gli stili in `catalogo.config.yaml`), i dati non rispettano lo schema.
- **Avviso**: un formato immagine non convertibile (per esempio PSD o EPS: il prodotto resta senza quell'immagine), un QR code che non porta a un video, una traduzione mancante, un prodotto senza immagini.

I QR code collegati come immagini di un prodotto non sono foto: se portano a un video YouTube diventano il video del prodotto (il primo trovato).

### Nomi dei disegni

I disegni tecnici (PDF e AI) vengono prima trasformati in PNG da poppler e poi convertiti in WebP: il nome del file WebP deriva dal contenuto di quel PNG. Lo stesso disegno può quindi avere un nome diverso se cambia la versione di poppler: alla pubblicazione successiva il disegno viene ricaricato una volta, senza altre conseguenze.

## Pubblicazione e ritorno all'edizione precedente

Dopo `build` (senza errori) una linea si pubblica sull'hosting con `publish`. Se la nuova edizione ha un problema, `rollback` rimette quella di prima.

### Prima di cominciare

- **Contatti.** Togli il commento alla sezione `contacts` di `catalogo.config.yaml` e scrivi l'email e il numero WhatsApp per le richieste di informazioni. Senza, `publish` si ferma con «mancano email e WhatsApp in catalogo.config.yaml».
- **SFTP.** Il server deve offrire SFTP (accesso SSH, di solito su OpenSSH: serve la rinomina `posix-rename@openssh.com`, che OpenSSH ha). **FTPS non è ancora supportato**: se l'hosting offre solo FTP o FTPS, bisogna aggiungere un secondo tipo di accesso (`FtpsStore`, con la libreria basic-ftp) che implementi la stessa interfaccia `RemoteStore` e superi gli stessi test.

### Accesso all'hosting

Le credenziali si danno **solo con variabili d'ambiente**:

| Variabile | Significato |
| --- | --- |
| `ARNO_SFTP_HOST` | indirizzo del server SFTP |
| `ARNO_SFTP_PORT` | porta (predefinita: 22) |
| `ARNO_SFTP_USER` | nome utente |
| `ARNO_SFTP_PASSWORD` | password; serve questa **oppure** la chiave |
| `ARNO_SFTP_KEY_PATH` | percorso del file con la chiave privata (senza passphrase) |
| `ARNO_SFTP_ROOT` | cartella del sito sul server, quella che contiene `catalogo/` e `catalogo-prova/` |
| `ARNO_STORE_LOCAL_DIR` | se è impostata, si pubblica su questa cartella del tuo computer invece che sull'hosting (prova a secco) |

Se ne manca qualcuna il comando le elenca e non si collega.

> **Non scrivere mai password o chiavi nel repository**, né nel file di configurazione, negli script o nei messaggi di commit. Impostale nel terminale (per esempio con `export`) o in un file che sta fuori dal repository.

### Comando `publish`

```bash
cd converter
export ARNO_SFTP_HOST=sftp.example.com ARNO_SFTP_USER=utente ARNO_SFTP_ROOT=/htdocs
export ARNO_SFTP_KEY_PATH=~/.ssh/arnoplast   # oppure ARNO_SFTP_PASSWORD

# 1. Pubblica nell'ambiente di prova (catalogo-prova/) e controlla con l'app di prova
pnpm catalogo publish --linea agricoltura --edizione 2026.1

# 2. Se va tutto bene, pubblica la stessa edizione in produzione (catalogo/)
pnpm catalogo publish --linea agricoltura --edizione 2026.1 --ambiente produzione
```

| Opzione | Significato |
| --- | --- |
| `--linea <id>` | `agricoltura`, `garden` oppure `olive` |
| `--edizione <AAAA.N>` | l'edizione già costruita con `build`, per esempio `2026.1` |
| `--ambiente <nome>` | `prova` (predefinito) oppure `produzione` |
| `--out <cartella>` | la cartella in cui `build` ha scritto il risultato (predefinito: `out`) |
| `--config <file>` | file di configurazione, da cui si leggono i contatti (predefinito: `catalogo.config.yaml`) |

Il comando stampa l'edizione corrente della linea, le edizioni precedenti e il percorso dell'indice sul sito (per esempio `catalogo-prova/index.json`). **Esce con codice 1** se qualcosa non va, con 0 altrimenti.

**Prima di caricare** controlla che la linea e l'edizione siano valide, che i contatti ci siano e che `data.json` della build esista, rispetti lo schema e sia proprio della linea e dell'edizione indicate. Se un controllo fallisce non carica nessun file.

**Cosa carica, in quest'ordine** (le cartelle sono sotto `catalogo-prova/` o `catalogo/`):

1. le immagini `.webp` di `<linea>/img/` che non sono già sul server (i nomi dipendono dal contenuto, quindi un file presente è quello giusto);
2. `data.json` e `report.html` in `<linea>/<edizione>/`;
3. il file `.htaccess` con le regole di cache, **solo se non c'è già**;
4. `index.json`, **per ultimo**.

L'indice è il file che l'app legge per sapere qual è l'edizione corrente: si aggiorna solo quando tutto il resto è arrivato, e viene scritto in un colpo solo (prima in un file temporaneo, poi rinominato), così non resta mai a metà; anche le immagini e gli altri file arrivano prima come file temporaneo e poi si rinominano, così un file a metà non viene mai scambiato per completo. Se la connessione cade durante il caricamento l'indice resta com'era e l'app continua a vedere l'edizione precedente: basta rilanciare lo stesso comando, che salta le immagini già caricate.

Nell'indice, per la linea pubblicata, si registrano edizione, percorso di `data.json`, la sua impronta `sha256`, la data di pubblicazione e le edizioni precedenti (al massimo 5, dalla più recente). Le altre linee non si toccano. Ripubblicare la stessa edizione non cambia le edizioni precedenti.

### Comando `rollback`

```bash
pnpm catalogo rollback --linea agricoltura                        # nell'ambiente di prova
pnpm catalogo rollback --linea agricoltura --ambiente produzione  # in produzione
```

Rimette come corrente la prima delle edizioni precedenti della linea. Non carica nulla: legge `data.json` di quell'edizione dal server (deve esserci ancora: `publish` non cancella mai niente), ne calcola l'impronta e aggiorna `index.json`. L'edizione da cui si torna indietro **non** entra tra le precedenti; per rimetterla basta pubblicarla di nuovo. Senza edizioni precedenti si ferma con «nessuna edizione precedente per agricoltura» (o per la linea indicata). Come `publish`, stampa l'edizione corrente e l'indice, ed esce con codice 1 se qualcosa non va.

### Regole di cache (`.htaccess`)

Alla prima pubblicazione di un ambiente `publish` scrive `<radice>/.htaccess`, per Apache 2.4 con il modulo `mod_headers` (il server tipico degli hosting WordPress):

```apache
<IfModule mod_headers.c>
  <Files "index.json">
    Header set Cache-Control "no-cache"
  </Files>
  <FilesMatch "^(data\.json|.+\.webp)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
```

- `index.json` non resta in cache: l'app trova subito una nuova edizione.
- Le immagini e i `data.json` delle edizioni si tengono in cache per un anno: una volta pubblicati non cambiano. **Per correggere un'edizione già pubblicata usa quindi un numero di edizione nuovo**, altrimenti le app che l'hanno già scaricata potrebbero non vedere la correzione.

Se il file esiste già (anche modificato a mano) non viene mai sovrascritto. Se il server non è Apache o non ha `mod_headers`, le regole non hanno effetto e vanno configurate a mano sul server.

### Prova a secco

Per vedere cosa verrebbe pubblicato senza toccare l'hosting, indica una cartella locale:

```bash
ARNO_STORE_LOCAL_DIR=/tmp/sito-prova pnpm catalogo publish --linea agricoltura --edizione 2026.1
```

La cartella conterrà `catalogo-prova/` esattamente come sul server.
