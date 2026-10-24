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

I comandi `publish` e `rollback` arrivano nel passo successivo; questa sezione, con le variabili d'ambiente per l'accesso all'hosting, verrà completata allora.
