---
title: "Duplicati"
summary: "Trovare file identici e copie simili, e tenere la migliore."
section: Your photos
order: 6
review: machine
source: 7fde0a7267ff
---

Gli archivi accumulano copie: la stessa foto caricata due volte, un’esportazione accanto al suo originale, un JPEG salvato di nuovo, la stessa cartella su due dischi. **Duplicati** le trova e ti suggerisce quale tenere.

## Due tipi

- I **file identici** sono lo stesso file byte per byte, da dovunque arrivino: per esempio un caricamento e la copia di un assistente sul NAS.
- Le **foto simili** sono file diversi della stessa immagine: ridimensionati, salvati di nuovo, esportati con un’altra qualità, leggermente modificati. cf-dam le trova grazie a un’«impronta» delle zone chiare e scure di ogni immagine, così scopre copie che un confronto tra file non vede. Anche due foto scattate a un istante di distanza possono sembrare simili: per questo le foto simili le controlli tu.

Le foto di scene uniformi (un cielo vuoto, la nebbia, un fotogramma nero) hanno pochissimo nella loro impronta, quindi vengono accoppiate solo quando impronta e dimensioni in pixel sono **esattamente** uguali.

I file identici non si possono nemmeno caricare due volte: il caricamento dice **Già nell’archivio** (vedi [Caricare le foto](/help/uploading)).

## Quale tenere

Ogni gruppo mostra tutte le copie con dimensioni in pixel, dimensione del file, tipo di file, data e fotocamera, e ne segna una come **Consigliata**, con il motivo. cf-dam preferisce, in quest’ordine:

1. **Più pixel**: l’immagine più grande.
2. **L’originale RAW**, poi un file senza perdita (TIFF, PNG), rispetto a un JPEG.
3. A parità di dimensioni, il file **meno compresso**: «Stesse dimensioni, ma meno compressa (707 KB contro 664 KB)».
4. **La tua scelta**, poi quella **valutata meglio**.
5. Altrimenti, quella arrivata per prima.

Il motivo è indicato, così puoi non essere d’accordo: scegli un’altra copia prima di premere il pulsante.

## Tenerne una

Scegli la copia da tenere e premi **Tieni la selezionata, rimuovi …**. Parole chiave, album, valutazione e scelta delle altre passano a quella che tieni, e le altre vengono rimosse dal catalogo.

> **Rimuovere un duplicato non elimina mai un file.** Toglie solo quella copia dal catalogo di cf-dam. I file originali restano dove sono, sul tuo NAS, sul computer o nell’archiviazione, e puoi riordinarli tu se vuoi.

## Non sono duplicati

Per le foto simili che non sono davvero copie (due fotogrammi di una raffica, per esempio):

- **Non sono duplicati** ignora tutto il gruppo;
- **Non è un duplicato** sotto una foto toglie solo quella dal gruppo.

Le coppie ignorate non vengono più suggerite.
