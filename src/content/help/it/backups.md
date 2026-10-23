---
title: "Backup e ripristino del catalogo"
summary: "Copie giornaliere del catalogo, come riportarlo in una nuova installazione e il controllo delle anteprime."
section: Where photos are kept
order: 4
review: machine
source: 85a0a0571ca4
---

Gli **originali** delle tue foto sono protetti da dove li conservi (vedi [Archiviare e ripristinare gli originali](/help/archiving)). Il **catalogo** (dettagli di ogni foto, parole chiave, didascalie, valutazioni, album, gallerie e persone) è protetto dai **backup del catalogo**.

## Attivare i backup

In **Archiviazione**, sotto **Backup del catalogo**:

1. **Esegui il backup su:** scegli un bucket. Va bene qualsiasi bucket collegato; quello integrato c’è già.
2. **Ogni giorno alle:** l’ora (in UTC; cf-dam mostra accanto la tua ora locale).
3. **Conserva per:** quanti giorni di backup tenere. Quelli più vecchi vengono eliminati, ma mai il più recente.
4. Premi **Salva**. Il primo backup parte entro un minuto; **Esegui ora il backup** ne avvia uno in qualsiasi momento.

> **Se puoi, usa un bucket fuori da Cloudflare.** Il bucket integrato è nello stesso account Cloudflare del catalogo: protegge dagli errori, ma non dalla perdita dell’account. Un bucket in Amazon S3 (o Backblaze B2, Wasabi…) protegge da entrambi.

### Cosa c’è in un backup, e cosa no

| C’è | Non c’è |
| --- | --- |
| Dettagli di ogni foto, parole chiave, didascalie, valutazioni, etichette | I file originali (sono dove li conservi tu) |
| Album, gallerie clienti, i loro visitatori e le loro scelte | Password, passkey, codici in due passaggi, accessi |
| Persone e i loro ruoli | Chiavi API |
| Parole chiave, preimpostazioni, impostazioni, connessioni degli assistenti | Miniature e anteprime (vengono ricreate) |

Siccome le password non sono nel backup, dopo un ripristino tutti ricevono una nuova password.

## Riportare indietro il catalogo

Un ripristino va in un cf-dam **nuovo e vuoto** (ad esempio dopo essere ripartito in un nuovo account Cloudflare):

1. Installa cf-dam come al solito. Nella prima pagina, scegli **Ripristina da un backup** invece di **Inizia un nuovo archivio**.
2. Indica **Dove sono i backup**: l’archiviazione integrata di questa installazione, se li ha ancora, oppure un bucket S3. Bastano chiavi di sola lettura; vengono conservate solo fino alla fine del ripristino.
3. **Scegli un backup** dall’elenco e crea il primo amministratore.

Il ripristino avviene in background e puoi seguirlo nella pagina. Se si ferma (per un problema di rete, ad esempio), premi **Riprova**: riprende da dove si era fermato.

Dopo un ripristino:

- Gli **assistenti** sul tuo NAS e sui tuoi computer si collegano di nuovo e ritrovano le loro voci, così non inviano tutto due volte. Vedi [Computer e NAS](/help/computers-and-nas).
- **Miniature e anteprime** vengono ricreate: dagli originali dove cf-dam può leggerli, e dagli assistenti per gli originali su un NAS.

## Il controllo delle anteprime

In **Archiviazione**, sotto **Anteprime**, **Controlla ogni anteprima** chiede all’archiviazione integrata di ogni miniatura e anteprima, e ricrea quelle che mancano. Con un milione di foto ci vogliono alcune ore e costa ben meno di un dollaro. **Riprova quelle bloccate** ritenta quelle che non è stato possibile creare.

Di solito non ti serve: cf-dam si accorge di un’anteprima mancante la prima volta che qualcuno la apre. È lì per dopo un ripristino, o per stare tranquillo.
