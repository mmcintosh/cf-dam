---
title: "Computer e NAS"
summary: "Il piccolo programma che cataloga le foto sul tuo NAS o computer senza spostarle, e come configurarlo."
section: Computers and NAS
order: 1
review: machine
source: 2bbdf56551b0
---

Molti fotografi tengono le foto su un **NAS** (un disco di rete in studio o a casa) o sui dischi di un computer. cf-dam può catalogarle **dove si trovano**: un piccolo assistente gira accanto alle foto, le legge una per una e invia a cf-dam i loro dettagli, una miniatura e un’anteprima. Gli originali non si spostano mai e non vengono mai modificati.

Puoi avere più assistenti, ad esempio uno sul NAS e uno su un portatile.

## Cosa fa l’assistente

- Legge i dettagli di ogni foto (fotocamera, data, luogo, parole chiave, didascalie) e crea una miniatura e un’anteprima.
- Li invia a cf-dam, così le foto compaiono nella libreria e si possono cercare, etichettare con parole chiave e condividere.
- Ripete la scansione di tanto in tanto e rileva le foto nuove, modificate, rinominate ed eliminate. Una foto il cui file scompare viene segnata come **mancante**, mai eliminata dal catalogo.
- Se vuoi, copia gli originali in un bucket di archiviazione (vedi [Archiviare e ripristinare gli originali](/help/archiving)).
- In una prima scansione grande invia prima tutte le miniature, così la libreria si riempie in fretta, poi le anteprime più grandi.

Si limita sempre a **leggere** le tue cartelle di foto. Le cartelle di sistema di Synology (`@eaDir`, `#recycle`), i file superflui di Mac e Windows e le cache di Lightroom vengono sempre saltati.

## Aggiungere un assistente

In **Computer e NAS**, premi **Aggiungi un computer o un NAS**, poi scegli dove gira. La pagina mostra i passaggi esatti per ogni caso; eccone lo schema.

### Su un NAS

L’assistente gira come **container Docker**, un modo standard per far girare piccoli programmi su un NAS. Scegli il tuo NAS in **Quale NAS?** e cf-dam ti mostra i passaggi, con un file di configurazione pronto (un «compose file») da copiare:

| NAS | Dove va il file di configurazione |
| --- | --- |
| Synology | Container Manager → Project → Create |
| QNAP | Container Station → Applications → Create |
| UGREEN | L’app Docker: crea un progetto |
| TerraMaster | Docker Manager: crea un progetto |
| Asustor | Portainer (da App Central) → Stacks → Add stack |
| TrueNAS (24.10 o successivo) | Apps → Discover Apps → ⋮ → Install via YAML |
| Unraid | Docker → Add Container (cf-dam elenca ogni campo), oppure il plugin Compose Manager |
| OpenMediaVault | Services → Compose → Files → Add (con omv-extras) |
| Un altro computer Linux | Salva il file ed esegui `docker compose up -d` |

**Incolla il file di configurazione così com’è: non c’è niente da cambiare.** Permette all’assistente di *leggere* il disco principale del NAS (`:ro` significa sola lettura: non può mai modificare né eliminare nulla lì) e poi scegli tu quali cartelle di foto catalogare, da un elenco in cf-dam. L’assistente richiede circa 1 GB di memoria e funziona sui NAS Intel, AMD e ARM.

Hai foto anche su un secondo disco? Il file di configurazione contiene un commento con l’unica riga da aggiungere.

I NAS **WD My Cloud e Buffalo** non possono eseguire Docker. Fai girare l’assistente su un Mac o un PC che vede le cartelle condivise del NAS.

### Su un Mac o un PC Windows

1. Installa **Node.js 24** (il programma di installazione LTS) da [nodejs.org](https://nodejs.org), se non c’è già.
2. Decomprimi l’assistente e apri un terminale (Mac: **Terminale**; Windows: **PowerShell**) nella sua cartella.
3. Esegui il comando che mostra la pagina. Contiene già l’indirizzo del tuo archivio.
4. Su un Mac, quando macOS chiede se `node` può leggere la cartella Immagini, i dischi o i volumi di rete, **consentilo**.

L’assistente si avvia da solo ogni volta che accedi al computer, con il tuo utente, così vede i tuoi dischi e le tue condivisioni.

## Abbinamento

Ogni nuovo assistente mostra un **codice di otto lettere**: nella sua pagina (`http://your-nas:8790` o `http://localhost:8790`) e nel suo log.

1. Scrivi il codice in **Inserisci il codice** nella pagina Computer e NAS.
2. Dai un nome all’assistente, ad esempio «NAS dello studio», e premi **Collega**.

L’assistente riceve una chiave che può solo inviare foto a questo archivio: non può leggere nient’altro né modificare le foto di nessuno. Se stai configurando di nuovo un assistente (ad esempio dopo aver reinstallato il NAS), scegli **Di nuovo come «…»** così recupera la sua voce, le sue cartelle e le sue foto invece di inviare tutto due volte.

## Scegliere le cartelle

Sotto l’assistente, in **Cartelle**, scegli una cartella dall’elenco (mostra le cartelle condivise del NAS e le cartelle al loro interno, con i nomi che usa il NAS, ad esempio `/volume1/photo/2024`) e premi **Indicizza questa cartella**. La prima scansione parte subito. Ogni cartella mostra quando è stata scansionata l’ultima volta. Le cartelle su dischi rimovibili lo indicano, e risultano offline mentre il disco è scollegato.

**Rimuovi** smette di indicizzare una cartella. Le sue foto restano in cf-dam, segnate come mancanti.

## Tenerlo d’occhio

La scheda di ogni assistente mostra se è **Online**, se è in **Scansione in corso** o quando è stato **visto l’ultima volta**; quante foto ha; quante ne mancano; e cosa sta facendo. **Scansiona ora** avvia una scansione, e **Metti in pausa** lo ferma finché non premi **Riprendi**.

Se un assistente non si fa sentire da un po’, compare un avviso per gli amministratori (vedi [Avvisi e attività](/help/alerts-and-activity)). Le cause più comuni sono il NAS o il computer spento o in standby, oppure un cambio di rete. Riavviare l’assistente (o il suo container) risolve quasi sempre.

**Scollega** rimuove la chiave di un assistente. Le sue foto restano in cf-dam.
