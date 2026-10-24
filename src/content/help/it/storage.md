---
title: "Dove sono conservati gli originali"
summary: "La differenza tra il catalogo e gli originali, e i posti in cui cf-dam può conservare gli originali."
section: Where photos are kept
order: 1
review: machine
source: 95bfc3f3803f
---

cf-dam conserva due cose diverse in due posti diversi.

- **Il catalogo:** tutto ciò che cf-dam sa di ogni foto (dettagli, parole chiave, didascalie, valutazioni) più una piccola **miniatura** e un’**anteprima** più grande. Stanno sempre nel tuo account Cloudflare, così la libreria resta veloce qualunque cosa succeda agli originali.
- **Gli originali:** i file completi della tua fotocamera. Possono stare in uno qualsiasi dei posti qui sotto, e foto diverse possono stare in posti diversi.

## Dove possono stare gli originali

| Dove | Adatto per | Note |
| --- | --- | --- |
| **Cloudflare R2** (integrato) | Per iniziare; foto che apri spesso | Già configurato. Nessun costo per il download. |
| **Amazon S3** | Archivi grandi; archiviazione a lungo termine molto economica | Serve un account Amazon Web Services. Vedi [Collegare Amazon S3](/help/amazon-s3). |
| **Backblaze B2, Wasabi, R2 (secondo bucket)** | Alternative più economiche ad Amazon | Si collegano con chiavi di accesso, come S3. |
| **Il tuo NAS o computer** | Foto che tieni già a casa o in studio | Non si sposta nulla: un assistente le cataloga dove si trovano. Vedi [Computer e NAS](/help/computers-and-nas). |

La pagina **Archiviazione** elenca tutti i posti che hai collegato, uno per riga: di che tipo è, quanti originali conserva e quanto spazio occupano, e cosa lo usa (**Nuovi caricamenti**, **Archivio dei lavori**, **Backup del catalogo**, l’archivio di un assistente). Una di queste connessioni è la **Predefinita**: lì vanno i caricamenti a meno che tu non ne scelga un altro nel riquadro di caricamento. Premi una riga per aprire la pagina di quella connessione.

## Collegare un bucket

In **Archiviazione**, premi **Aggiungi una connessione** e scegli il provider. cf-dam compila ciò che può. Poi indichi:

- **Nome:** qualsiasi cosa ti aiuti a riconoscerlo, ad esempio «Archivio dello studio».
- **Bucket:** il nome del bucket, esattamente come lo mostra il provider.
- **Regione:** dove si trova il bucket, ad esempio `us-east-1`.
- **Cartella nel bucket** (facoltativa): tiene i file di cf-dam in una cartella, ad esempio `cf-dam`.
- **Come accedere:** chiavi di accesso o, per Amazon, l’opzione senza chiavi (vedi [Collegare Amazon S3](/help/amazon-s3)).
- **Classi di archiviazione offerte da questo bucket** e la **classe predefinita per i caricamenti**.

Premi **Aggiungi e prova**. cf-dam apre la pagina della nuova connessione e la prova: scrive un piccolo file di prova (dentro la cartella, se ne hai indicata una), lo rilegge e lo elimina, e ti dice se ha funzionato o perché no. Per una connessione Amazon senza chiavi apre invece i passaggi di AWS, perché finché non sono fatti non funziona nulla.

## La pagina di una connessione

- **Cosa è conservato qui:** quanti originali hanno una copia qui e quanto spazio occupano, per tipo di archiviazione (caldo, tiepido, freddo, archivio profondo), con link che mostrano quelle foto nella libreria. Inoltre le copie di archiviazione dei lavori ancora da fare e i backup del catalogo conservati qui. Sono contati dal catalogo, non guardando nel bucket.
- **Cosa la usa:** i nuovi caricamenti (se è la predefinita), l’archiviazione dei lavori consegnati, il backup giornaliero del catalogo, l’archivio di un assistente NAS o Mac, ciascuno con il punto in cui cambiarlo.
- **Caricare dal browser:** vedi sotto.
- **Cataloga i file già presenti in questo bucket:** vedi «Foto già presenti in un bucket» più sotto.
- **Configurazione AWS per questa connessione senza chiavi** (solo Amazon): i passaggi e le policy da creare in AWS. Vedi [Collegare Amazon S3](/help/amazon-s3).
- **Dettagli:** premi **Modifica** per rinominarla, cambiare le classi di archiviazione che offre e la classe predefinita, o cambiarne il ruolo (senza chiavi) o le chiavi di accesso. Un nuovo segreto sostituisce il vecchio; lascia vuoto il campo per mantenerlo. Quando salvi nuove credenziali, vengono provate subito. **Bucket, regione, endpoint e cartella** possono cambiare solo finché qui non è conservato nulla e nulla usa la connessione, perché gli originali sono salvati con questi nomi: per passare a un altro bucket, aggiungi una nuova connessione.
- **Rimuovi:** dimentica la connessione (il bucket e i suoi file restano come sono). Non si può rimuovere finché qui è conservato qualcosa o qualcosa la usa; la pagina elenca cosa.

## Caricare dal browser e la regola CORS

Quando carichi su una connessione S3 (è la predefinita, o l’hai scelta nel riquadro di caricamento), il browser invia le foto **direttamente al bucket**, non tramite cf-dam. Un bucket lo rifiuta a meno che non consenta questo sito, con un’impostazione sul bucket chiamata **regola CORS**.

1. Nella pagina della connessione, sotto **Caricare dal browser**, premi **Copia** accanto alla regola.
2. Nella console AWS: **S3**, il bucket, **Permissions**, **Cross-origin resource sharing (CORS)**, **Edit**. Incollala e salva. (Gli altri servizi hanno la stessa impostazione sul bucket.)
3. Tornato in cf-dam, premi **Provare il caricamento da questo browser**. Invia un byte come fa un caricamento e ti dice se il bucket l’ha accettato e, se no, perché.

La regola serve solo per caricare dal browser. Le copie fatte da cf-dam stesso (archiviazione dei lavori, backup, spostamenti tra classi, ripristini) e l’assistente NAS o Mac raggiungono il bucket anche senza.

## Foto già presenti in un bucket

Se il bucket contiene già delle foto, apri la pagina della connessione e, sotto **Cataloga i file già presenti in questo bucket**, premi **Importa**. Ogni file diventa ricercabile dove si trova: non viene copiato né spostato nulla. Puoi partire da una cartella, ad esempio `photos/2019/`. Le anteprime vengono create in background. I file nell’archivio profondo sono elencati con nome, dimensione e classe finché non li ripristini.

## Le classi di archiviazione, in breve

Amazon offre «classi» più economiche per i file che apri di rado. Più l’archiviazione costa poco, più tempo e denaro servono per riavere un file:

| Classe | Circa per terabyte al mese | Riavere un file |
| --- | --- | --- |
| Standard | $23 | Subito |
| Standard-IA (accesso poco frequente) | $12.50 | Subito, piccolo costo per GB |
| Glacier Flexible Retrieval | $3.60 | Da 3 a 12 ore |
| Glacier Deep Archive | $1 | Entro 12–48 ore |

I prezzi sono quelli pubblicati da Amazon per gli Stati Uniti al momento della stesura; controlla i tuoi sulla [pagina dei prezzi di S3 di Amazon](https://aws.amazon.com/s3/pricing/). Amazon addebita anche una **permanenza minima**: 30 giorni per le classi IA, 90 per Glacier e 180 per Deep Archive, anche se elimini o sposti il file prima.

Puoi spostare una foto tra le classi dalla sua pagina (**Sposta**) e riavere una foto da Glacier con **Richiedi il ripristino**. Vedi [Archiviare e ripristinare](/help/archiving).

## Le altre parti della pagina Archiviazione

- **Controlli:** cf-dam verifica regolarmente che gli originali che conosce siano ancora dove pensa. I problemi compaiono qui e come avviso.
- **Archivia i lavori consegnati:** una copia a freddo in S3 degli originali di ogni lavoro consegnato, qualche giorno dopo la consegna. Vedi [Lavori](/help/jobs).
- **Cloudflare Images questo mese:** quante immagini Cloudflare ha creato questo mese per anteprime, miniature, IA e filigrane, che Cloudflare fa pagare oltre quanto incluso nel tuo piano, con un avviso quando si supera il numero che imposti.
- **Anteprime:** controlla che ogni miniatura e anteprima ci sia davvero e ricrea quelle mancanti. Vedi [Backup e ripristino del catalogo](/help/backups).
- **Backup del catalogo:** copie giornaliere del catalogo stesso. Vedi [Backup e ripristino del catalogo](/help/backups).
