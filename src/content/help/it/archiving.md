---
title: "Archiviare e ripristinare gli originali"
summary: "Tenere una copia sicura ed economica di ogni originale in Amazon Glacier, e recuperare una foto quando ti serve."
section: Where photos are kept
order: 3
review: machine
source: f92f0190ae52
---

Un **archivio** è una copia dei tuoi originali in un posto sicuro ed economico, per il giorno in cui un disco si guasta o qualcuno ruba un NAS. **Glacier Deep Archive** di Amazon conserva un terabyte per circa un dollaro al mese. Il rovescio della medaglia è che recuperare un file richiede ore: serve per conservare, non per l’uso quotidiano.

cf-dam può archiviare in due modi, a seconda di dove sono i tuoi originali.

## Originali su un NAS o un computer

L’assistente sul tuo NAS o computer può copiare da solo ogni originale in un bucket S3.

1. Per prima cosa collega un bucket nella pagina **Archiviazione** (vedi [Collegare Amazon S3](/help/amazon-s3)).
2. In **Computer e NAS**, trova l’assistente e, sotto **Archivia gli originali**, premi **Configura l’archiviazione**.
3. Scegli il **Bucket** e la **Classe di archiviazione**: **Deep Archive** per la conservazione più economica.
4. Scegli le ore in cui può lavorare (**Dalle** e **Alle**, secondo l’orologio dell’assistente), ad esempio di notte, e un limite di velocità in Mbps così non satura la tua connessione internet. La stessa ora in entrambi vuol dire a qualsiasi ora; 0 Mbps vuol dire nessun limite.
5. Salva.

L’assistente copia ogni originale dopo che è rimasto intatto per un giorno (così non archivia un file che stai ancora modificando) e controlla ogni parte appena arriva. **Legge** soltanto i tuoi file: non li modifica né li elimina mai. Il pannello mostra cosa è stato inviato, cosa manca e quanto ci vorrà, più o meno.

Puoi usare **Modifica** per cambiare le impostazioni o **Smetti di archiviare** in qualsiasi momento. Ciò che è già nel bucket resta lì.

## Originali già in un bucket

Per una foto il cui originale è in S3, la sua pagina mostra dove si trova e con **Sposta** puoi portarlo in un’altra classe di archiviazione, ad esempio da Standard a Deep Archive.

> Amazon fattura una **permanenza minima**: 30 giorni per le classi IA, 90 giorni per Glacier e 180 giorni per Deep Archive. Spostare una foto prima costa comunque l’intero periodo, quindi sposta solo le foto che sei sicuro di lasciare lì.

## Recuperare una foto da Glacier

Un file in Glacier o Deep Archive non si può aprire subito. Prima Amazon deve riportarne indietro una copia:

1. Apri la pagina della foto. Sotto l’archiviazione dell’originale, scegli quanto in fretta:

   | Velocità | Glacier Flexible Retrieval | Deep Archive | Costo |
   | --- | --- | --- | --- |
   | **Accelerato** | minuti | non disponibile | il più alto |
   | **Standard** | da 3 a 5 ore | entro 12 ore | circa 20 $ per TB da Deep Archive |
   | **Bulk** | da 5 a 12 ore | entro 48 ore | il più basso: circa 2,50 $ per TB da Deep Archive |

2. In **Mantieni ripristinato per**, scegli per quanto tempo tenerla ripristinata (dopo, la copia sparisce e l’originale resta archiviato).
3. Premi **Richiedi il ripristino**.

cf-dam controlla il ripristino da solo e ti mostra quando è pronto; **Controlla lo stato** lo chiede subito ad Amazon. Una volta ripristinata, la foto si può scaricare come al solito finché la copia non scade.

Le tue miniature e anteprime non sono mai in Glacier: puoi sempre vedere, cercare, assegnare parole chiave e condividere ogni foto, anche quando il suo originale è nell’archivio più profondo.
