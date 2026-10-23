---
title: "Dove sono conservati gli originali"
summary: "La differenza tra il catalogo e gli originali, e i posti in cui cf-dam può conservare gli originali."
section: Where photos are kept
order: 1
review: machine
source: 56c3bc77ccf9
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

La pagina **Archiviazione** elenca tutti i posti che hai collegato. Una di queste connessioni è la **Predefinita**: lì vanno i caricamenti a meno che tu non ne scelga un altro nel riquadro di caricamento.

## Collegare un bucket

In **Archiviazione**, premi **Aggiungi una connessione S3** e scegli il provider. cf-dam compila ciò che può. Poi indichi:

- **Nome:** qualsiasi cosa ti aiuti a riconoscerlo, ad esempio «Archivio dello studio».
- **Bucket:** il nome del bucket, esattamente come lo mostra il provider.
- **Regione:** dove si trova il bucket, ad esempio `us-east-1`.
- **Cartella nel bucket** (facoltativa): tiene i file di cf-dam in una cartella, ad esempio `cf-dam`.
- **Come accedere:** chiavi di accesso o, per Amazon, l’opzione senza chiavi (vedi [Collegare Amazon S3](/help/amazon-s3)).
- **Classi di archiviazione offerte da questo bucket** e la **classe predefinita per i caricamenti**.

Premi **Aggiungi e prova**. cf-dam scrive un piccolo file di prova, lo rilegge e lo elimina. «Connesso» significa che tutto ha funzionato; qualsiasi altro esito ne indica il motivo.

> **Caricare dal browser in un bucket** richiede un’altra impostazione sul bucket stesso, chiamata regola CORS. Il modulo mostra la regola esatta da copiare sotto «I caricamenti dal browser vanno direttamente nel bucket». Senza, i caricamenti in quel bucket falliscono con un errore di rete.

## Foto già presenti in un bucket

Se il bucket contiene già delle foto, apri **Cataloga i file già presenti in questo bucket** sotto la connessione e premi **Importa**. Ogni file diventa ricercabile dove si trova: non viene copiato né spostato nulla. Puoi partire da una cartella, ad esempio `photos/2019/`. Le anteprime vengono create in background. I file nell’archivio profondo sono elencati con nome, dimensione e classe finché non li ripristini.

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
- **Anteprime:** controlla che ogni miniatura e anteprima ci sia davvero e ricrea quelle mancanti. Vedi [Backup e ripristino del catalogo](/help/backups).
- **Backup del catalogo:** copie giornaliere del catalogo stesso. Vedi [Backup e ripristino del catalogo](/help/backups).
