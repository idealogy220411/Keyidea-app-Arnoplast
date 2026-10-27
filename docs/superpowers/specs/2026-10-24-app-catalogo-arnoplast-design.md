# App catalogo Arno Plast · Specifica di progetto

- **Data:** 24 ottobre 2026
- **Stato:** approvata
- **Committente:** Idealogy / KeyIdea, per Arno Plast
- **Bozze grafiche di riferimento:** `docs/mockups/bozze-v2.html`, `docs/mockups/icone-linee-v1.html`, `docs/mockups/bozze-v3-navigazione.html`

## 1. Obiettivo

Rifare da zero l'app catalogo di Arno Plast oggi pubblicata su App Store.

L'app attuale:

- è difficile da aggiornare;
- ha un design datato ed è lenta;
- non ha funzioni utili come la ricerca e l'uso offline;
- usa una tecnologia superata.

La nuova app deve:

- presentare i cataloghi **Agricoltura**, **Garden** e **Raccolta olive** in più lingue, su iPhone, iPad e Android;
- funzionare anche senza connessione;
- ricevere le nuove edizioni del catalogo senza pubblicare una nuova versione sugli store;
- permettere di cercare per codice o nome, salvare articoli nei preferiti e inviare una richiesta di informazioni.

### Criteri di successo

- Una nuova edizione di un catalogo arriva nell'app con poche ore di lavoro dell'agenzia: esportazione da InDesign, un comando, controllo, pubblicazione.
- L'app si apre in meno di 2 secondi, scorre in modo fluido e funziona offline.
- Passa le revisioni di App Store e Google Play senza rilievi.
- Rispetta i requisiti di accessibilità indicati nella sezione 9 e non raccoglie dati personali.

## 2. Utenti

Tutti vedono gli stessi contenuti: non ci sono login, prezzi o aree riservate.

| Utente | Uso tipico |
|---|---|
| Rivenditori e distributori | Cercano codici, controllano confezioni e pallet, chiedono informazioni |
| Agenti commerciali | Mostrano il catalogo ai clienti, spesso su iPad e senza rete |
| Clienti finali | Scoprono i prodotti e guardano i video di montaggio |

## 3. Ambito

**Incluso**

- Tre linee di prodotto (Agricoltura, Garden, Raccolta olive), con le lingue in cui esistono i cataloghi InDesign.
- Navigazione per linea, categoria e prodotto. Ogni prodotto ha la sua tabella di codici articolo.
- Ricerca istantanea per codice (anche parziale), nome e descrizione, su tutte le linee, con filtri.
- Funzionamento offline e aggiornamento automatico del catalogo in background.
- Preferiti per singolo codice articolo, con invio della richiesta di informazioni via email o WhatsApp.
- Video di montaggio (YouTube) dentro la scheda prodotto.
- Pagine «Chi siamo» e «Contatti».
- Statistiche d'uso anonime.
- Layout dedicato per iPad e modalità chiara e scura.
- Convertitore da InDesign e strumento di pubblicazione per l'agenzia.

**Escluso**

- Login, prezzi, listini, disponibilità di magazzino, ordini.
- Pannello di gestione per il cliente.
- Lettura dei dati dal sito WordPress.
- Ricerca rivenditori su mappa.
- Notifiche push.

## 4. Decisioni prese

| Tema | Decisione |
|---|---|
| Tecnologia app | React Native con Expo, TypeScript, un solo codice per iOS e Android |
| Fonte dei contenuti | I file InDesign dei cataloghi: un file per linea e per lingua, con stili di paragrafo coerenti |
| Chi aggiorna | L'agenzia, con uno strumento a riga di comando |
| Hosting dei dati | Una cartella sull'hosting del sito WordPress, servita in HTTPS |
| Pubblicazione iOS | Aggiornamento dell'app esistente: stessa scheda App Store, stesso identificativo |
| Preferiti e richieste | Per codice articolo |
| Richiesta informazioni | Messaggio precompilato aperto in Mail o WhatsApp sul telefono dell'utente |
| Statistiche | Anonime, con TelemetryDeck; nessuna richiesta di tracciamento |
| Grafica | Proposta da noi: logo, rosso del marchio, carattere Lato |
| Icone delle linee | Agricoltura: trattore. Garden: vaso con piantina. Raccolta olive: oliva con foglia |
| Barra in basso | Agricoltura · Garden · Olive · Cerca · Preferiti |
| Chi siamo e Contatti | Pulsante informazioni in alto a destra |
| Tempi | Nessuna scadenza: la priorità è la qualità |

## 5. Architettura

Un unico repository con tre parti, tutte in TypeScript:

```
packages/schema/   formato dei dati del catalogo: tipi e validazione, condivisi
converter/         strumento a riga di comando per l'agenzia (Node.js)
app/               app Expo per iOS, iPadOS e Android
```

- **`packages/schema`** definisce il formato del catalogo pubblicato e lo valida con zod. Il convertitore produce solo dati che rispettano lo schema. L'app rifiuta i dati che non lo rispettano.
- **`converter`** trasforma i pacchetti InDesign in dati e immagini, li controlla e li pubblica. Non ha interfaccia grafica.
- **`app`** legge il catalogo incluso al momento della compilazione. Dopo scarica le nuove edizioni dall'hosting e le salva in un database locale.

Flusso dei dati:

```
InDesign (IDML + Links) → convertitore → controllo → hosting WordPress → app (database locale)
```

## 6. Modello dei dati

```
Linea (agricoltura | garden | olive)
 └─ Categoria          es. «Copripalo»
     └─ Prodotto       es. «Copripalo Prisma»
         └─ Articolo   es. 1807-1351 «Coprip Prisma 7x7 (senza viteria)»
```

- **Linea:** identificativo, nome per lingua, edizione (es. `2026.1`), data di pubblicazione.
- **Categoria:**
  - identificativo;
  - nome per lingua;
  - ordine (lo stesso del catalogo cartaceo);
  - immagine di apertura (la foto della pagina di apertura della sezione).
- **Prodotto:**
  - identificativo stabile;
  - nome per lingua;
  - materiali (FE, FV, PA, PET, PE, PP, PVC);
  - caratteristiche per lingua (elenco);
  - dimensioni per lingua;
  - immagini (foto principale e foto aggiuntive);
  - disegni tecnici;
  - link al video;
  - optional di fissaggio (riferimenti a codici articolo);
  - articoli.
- **Articolo:**
  - codice, l'identificativo univoco in tutta l'app (es. `1807-1351`, `1807-1310GZ`);
  - descrizione per lingua;
  - confezione, imballo e pallet. Il trattino del catalogo («-») diventa «valore assente».
- **Contatti:** email e numero WhatsApp dell'ufficio commerciale. Stanno nei dati, così si cambiano senza aggiornare l'app.

**Regole**

- **Unione delle lingue:** un prodotto nella versione inglese corrisponde a quello italiano che contiene gli stessi codici articolo.
- **Lingua di riferimento:** l'italiano esiste sempre per ogni linea.
- **Testo mancante:** se in una lingua manca un testo, l'app mostra quello italiano. Il convertitore lo segnala nel rapporto.
- **Identificativo del prodotto:** deriva da linea e nome italiano (es. `agricoltura/copripalo-prisma`). Cambia solo se cambia il nome. I preferiti usano i codici articolo, quindi non dipendono da questo identificativo.

## 7. Convertitore

### Ingresso

Per ogni linea e lingua, l'agenzia esporta da InDesign:

- il file **IDML**;
- la cartella **Links** con le immagini collegate.

Si ottengono con «Pacchetto» seguito da «Salva come IDML».

### Configurazione

Un file di configurazione abbina ogni stile di paragrafo a un campo. Esempio: «Titolo prodotto» → nome, «Caratteristiche» → caratteristiche. Se cambiano gli stili, si aggiorna la configurazione e non il codice. Una sola configurazione vale per tutte e tre le linee, che usano gli stessi stili.

### Passaggi

1. **Lettura del documento:** legge le storie e i frame dell'IDML, riconosce i campi dagli stili e ricostruisce prodotti e tabelle articoli.
2. **Associazione delle immagini:** collega a ogni prodotto le immagini impaginate nello stesso gruppo di pagine, in base alla posizione rispetto al titolo del prodotto.
3. **Link ai video:** decodifica i QR code collegati al prodotto e ne ricava l'indirizzo YouTube.
4. **Unione delle lingue:** unisce le lingue per codice articolo (sezione 6).
5. **Immagini:**
   - genera una miniatura (circa 400 px) e una versione dettaglio (circa 1600 px), in WebP;
   - le nomina in base al contenuto, così un'immagine invariata non viene riscaricata.
6. **Controllo:** produce un rapporto leggibile (HTML).
   - **Bloccanti:** codice ripetuto nello stesso prodotto, prodotti senza articoli, schema non valido, immagini collegate mancanti. Lo stesso codice in prodotti diversi è normale (gli accessori, come il Mon-block 1807-0751, compaiono in più tabelle). Diventa un avviso solo se le descrizioni non coincidono.
   - **Avvisi:** traduzioni mancanti, prodotti senza foto, QR non leggibili.
7. **Pubblicazione:** con un comando separato, dopo il controllo.

### Pubblicazione sull'hosting

- **Edizioni separate:** i dati di ogni edizione vanno in una cartella con il suo numero, ad esempio `catalogo/agricoltura/2026.1/`. Le immagini stanno in una cartella condivisa della linea (`catalogo/agricoltura/img/`) con nomi basati sul contenuto. Così una nuova edizione carica solo le immagini nuove, e il ritorno indietro le trova sempre.
- **Caricamento:** il convertitore carica i file via SFTP (o FTPS, se l'hosting non offre SFTP). Le credenziali stanno in variabili d'ambiente e mai nel repository.
- **File indice:** solo alla fine aggiorna `catalogo/index.json`, con l'edizione corrente di ogni linea e l'impronta (hash) dei dati. Ogni linea si aggiorna indipendentemente dalle altre.
- **Ambiente di prova:** `catalogo-prova/index.json` è letto solo dalla versione di test dell'app.
- **Ritorno all'edizione precedente:** il comando `rollback <linea>` riporta il file indice all'edizione precedente, che resta sul server.
- **Cache:** il file indice va servito senza cache. Le cartelle delle edizioni possono avere una cache lunga.

### Da verificare sul primo pacchetto di esempio

Questi dettagli si chiudono analizzando i file reali. Per ognuno c'è già una soluzione di riserva.

| Punto | Soluzione principale | Riserva |
|---|---|---|
| Bollini dei materiali (PP, PE…) | Leggerli dal testo del bollino o dal nome del file collegato | Elenco materiali per prodotto nella configurazione |
| Immagine di apertura della categoria | Foto della pagina di apertura della sezione | Immagine indicata nella configurazione |
| Associazione immagini e prodotto, nelle pagine con due prodotti | Posizione rispetto al titolo | Regole nella configurazione per le pagine particolari |

## 8. App

### Navigazione

- **Barra in basso:** Agricoltura (trattore), Garden (vaso con piantina), Olive (oliva con foglia), Cerca, Preferiti.
- **Pulsante informazioni in alto a destra:** porta a Chi siamo, Contatti, lingua, stato del catalogo (edizione e disponibilità offline), informativa privacy e versione.
- **iPad orizzontale:** tre colonne affiancate con categorie, prodotti e scheda. In verticale si comporta come lo smartphone, ma con griglie più ampie.

### Schermate

Riferimento: `docs/mockups/bozze-v2.html`.

1. **Linea:**
   - il logo;
   - la ricerca;
   - lo stato offline;
   - le categorie nell'ordine del catalogo, con foto e numero di articoli.
2. **Categoria:**
   - in apertura una foto a tutta larghezza con la curva rossa e «Scopri i …», come nella vecchia app;
   - sotto, la griglia dei prodotti. Ogni prodotto mostra il bollino del materiale (giallo), quello del video (rosso) e il numero di articoli.
3. **Prodotto:**
   - galleria con zoom;
   - titolo sulla fascia rossa con i bollini;
   - caratteristiche e dimensioni;
   - tabella articoli (codice, descrizione, confezione, imballo, pallet), con un cuore per ogni codice;
   - video, optional di fissaggio e disegni tecnici;
   - pulsanti fissi «Video» e «Richiedi info».
4. **Cerca:**
   - risultati mentre si scrive, su tutte le linee, con il testo trovato evidenziato;
   - filtri per linea, categoria, materiale e «con video»;
   - ricerche recenti.
5. **Preferiti:**
   - elenco dei codici salvati, anche di linee diverse;
   - pulsante «Richiedi informazioni».
   - Un codice uscito dal catalogo resta in elenco come «Non più disponibile» e non entra nella richiesta.

### Richiesta di informazioni

- L'app compone il messaggio nella lingua corrente, con l'elenco di codici e descrizioni.
- Lo apre in Mail (`mailto:`) o in WhatsApp (`https://wa.me/<numero>?text=…`), e l'utente può modificarlo prima di inviarlo.
- Se WhatsApp non è installato, compare solo l'opzione email.

### Offline e aggiornamenti

- **Dati inclusi:** l'app installata contiene già l'edizione corrente di ogni linea (dati e miniature), quindi funziona offline dal primo avvio.
- **Download delle foto grandi:**
  - con il Wi‑Fi, tutte in background;
  - con i dati mobili, solo quelle dei prodotti aperti.
  - Il comportamento si cambia nelle impostazioni.
- **Quando controlla:** all'avvio, e al massimo ogni 6 ore, l'app legge `index.json`.
- **Come si aggiorna:**
  - per ogni linea con una nuova edizione scarica i dati e le sole immagini nuove, poi verifica l'impronta;
  - passa alla nuova edizione solo a scaricamento completo e verificato;
  - mostra l'avviso «Catalogo aggiornato».
- **Se qualcosa va storto:** se il download si interrompe o i dati non sono validi, l'app resta sull'edizione che ha e riprova più tardi.
- **Pulizia:** le edizioni vecchie vengono cancellate dal telefono dopo il passaggio.

### Archiviazione e ricerca

- **Database:** database locale SQLite (expo-sqlite).
- **Ricerca:** un indice di ricerca testuale (FTS5) per lingua. I codici sono indicizzati anche senza trattino, quindi «1807135» trova «1807-135…».
- **Preferiti:** in una tabella locale, per codice articolo.

### Lingue

- L'app si apre nella lingua del telefono, se tra quelle disponibili. Altrimenti in inglese, se c'è; altrimenti in italiano.
- La lingua si cambia nelle impostazioni.
- Anche i testi dell'interfaccia sono tradotti. Prepariamo noi una prima traduzione da far rivedere ad Arno Plast.

### Video

- Si riproducono dentro la scheda con il player YouTube incorporato, quindi serve una connessione.
- Offline il pulsante resta visibile e spiega che serve la rete.

### Grafica

- **Colori:**
  - rosso del marchio `#ED1C24` per fasce, logo e superfici ampie;
  - `#E01A22` per pulsanti e testi piccoli (contrasto 4,8:1 con il bianco);
  - nero `#231F20`;
  - giallo dei bollini materiale `#FFE500`.
- **Carattere:** Lato (licenza libera OFL), incluso nell'app.
- **Icone:** disegnate su misura nello stesso stile (tratto arrotondato), come in `docs/mockups/icone-linee-v1.html`.
- **Stile visivo:** direzione «A · Essenziale» (sfondo chiaro, fasce e pulsanti nel rosso del marchio, schede con foto grandi), scelta tra tre proposte grafiche di riferimento.
- **Barra in basso, confermata:** le 5 voci già decise (Agricoltura, Garden, Olive, Cerca, Preferiti), con le icone scelte, nello stile «A · Essenziale» — vedi `docs/mockups/bozze-v3-navigazione.html`.
- **Bozze v3:** prima di sviluppare l'interfaccia prepariamo le bozze v3 complete (tutte le schermate, nello stile e con la navigazione appena confermati), da approvare.

## 9. Qualità

- **Linee guida:** si seguono le Human Interface Guidelines di Apple e le linee guida Material di Android (gesti nativi, tasto indietro su Android).
- **Accessibilità:**
  - testi che si ingrandiscono con le impostazioni di sistema;
  - etichette per VoiceOver e TalkBack;
  - aree toccabili di almeno 44 × 44 punti;
  - contrasto dei testi almeno 4,5:1.
- **Prestazioni:**
  - apertura in meno di 2 secondi su un telefono di fascia media;
  - liste virtualizzate;
  - immagini WebP con cache.
- **Modalità scura:** supportata.

## 10. Privacy e statistiche

- **Nessun dato personale:** l'app non raccoglie dati personali. Non ci sono account. I preferiti restano sul telefono. Le richieste partono dalla posta o da WhatsApp dell'utente.
- **Statistiche anonime con TelemetryDeck,** senza identificativi pubblicitari e senza richiesta di tracciamento. Eventi:
  - apertura dell'app (lingua);
  - linea, categoria e prodotto visti;
  - ricerca (testo e numero di risultati);
  - preferito aggiunto (codice);
  - richiesta inviata (canale, numero di articoli);
  - video aperto.
- **Dichiarazioni per gli store:** su App Store, «Dati di utilizzo, non collegati all'identità». Su Google Play, la sezione «Sicurezza dei dati» equivalente.
- **Informativa privacy:** ne prepariamo noi una bozza. La approva Arno Plast, e va pubblicata anche a un indirizzo web richiesto dagli store.

## 11. Test

- **`packages/schema`:** test di validazione su dati corretti e volutamente sbagliati.
- **`converter`:** test automatici su un campione reale di pagine IDML, per ogni linea e in due lingue. Coprono:
  - riconoscimento degli stili;
  - tabelle articoli;
  - unione delle lingue;
  - decodifica dei QR;
  - controlli bloccanti e avvisi.
- **`app`:**
  - test automatici della logica: ricerca, preferiti, composizione del messaggio, aggiornamento del catalogo (compresi download interrotto e dati non validi);
  - test dei percorsi principali: linea → categoria → prodotto → preferito → richiesta.
- **Beta:** prova da parte di agenzia e cliente con TestFlight (iPhone e iPad) e con il test interno di Google Play, prima di ogni pubblicazione.

## 12. Compilazione e pubblicazione

- **Strumenti:** EAS Build compila in cloud (non serve un Mac) ed EAS Submit invia agli store.
- **iOS:** è una nuova versione dell'app esistente. Servono lo stesso bundle identifier e l'accesso all'account App Store Connect.
- **Android:** una nuova app su Google Play, con l'account sviluppatore di Arno Plast.
- **Manutenzione:**
  - circa una volta l'anno, un aggiornamento tecnico per i requisiti delle nuove versioni di iOS e Android;
  - gli aggiornamenti del catalogo non richiedono mai una nuova versione sugli store.

## 13. Cosa serve per partire

1. Il pacchetto InDesign (IDML + Links) di alcune pagine, in due lingue. All'inizio basta Agricoltura, poi Garden e Raccolta olive.
2. L'elenco delle lingue disponibili per ogni linea.
3. Accesso SFTP o FTPS all'hosting WordPress e l'indirizzo HTTPS della cartella del catalogo.
4. Email e numero WhatsApp dell'ufficio commerciale per le richieste.
5. Accesso ad App Store Connect e il bundle identifier dell'app attuale.
6. L'account Google Play Console di Arno Plast, da creare se non esiste.
7. I testi di «Chi siamo» e «Contatti» e l'approvazione dell'informativa privacy.

## 14. Fasi di sviluppo

Ogni fase ha un suo piano di implementazione e si chiude con una verifica insieme a voi.

1. **Schema e convertitore** sul pacchetto di esempio di Agricoltura, con rapporto di controllo.
2. **Bozze v3** dell'interfaccia, da approvare.
3. **App di base:** navigazione, schede prodotto, catalogo incluso, funzionamento offline.
4. **Ricerca, preferiti e richiesta di informazioni.**
5. **Aggiornamenti** dall'hosting, ambiente di prova e ritorno all'edizione precedente.
6. **Video, statistiche, layout iPad, accessibilità e modalità scura.**
7. **Garden e Raccolta olive** nel convertitore e nell'app.
8. **Beta e pubblicazione:** TestFlight, test interno Google Play, pubblicazione sugli store.
