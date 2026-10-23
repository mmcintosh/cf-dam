---
title: "Caricare le foto"
summary: "Aggiungere foto e video dal tuo computer, dove finiscono e cosa succede dopo."
section: Your photos
order: 3
review: machine
source: 6589f6acdb5e
---

Il caricamento va bene per qualche centinaio di foto alla volta, o per foto da un computer che non le terrà. Per un intero NAS o una grande raccolta su un computer è meglio un assistente: cataloga le foto dove si trovano, senza caricare gli originali (vedi [Computer e NAS](/help/computers-and-nas)).

## Come caricare

1. Nella **Libreria**, premi **Carica**.
2. Scegli dove vanno gli originali: **Archivia gli originali in** (la destinazione predefinita è già scelta) e la **Classe di archiviazione**. Vedi [Dove sono conservati gli originali](/help/storage).
3. Trascina foto, file RAW e video nel riquadro, oppure fai clic per sceglierli. Puoi trascinare **un’intera cartella**: cf-dam la apre, insieme alle cartelle al suo interno, e carica tutto ciò che contengono (i file nascosti vengono saltati).

Ogni file mostra il suo avanzamento: **Ricerca di duplicati…**, poi una percentuale, poi **Caricato**. I file grandi salgono a pezzi, fino a 5 TB ciascuno, e intanto puoi continuare a lavorare. **Annulla** ne ferma uno. Quando hanno finito, premi **Aggiorna la libreria** per vederli.

## I duplicati vengono saltati

Prima di caricare, cf-dam controlla se l’archivio ha già esattamente quel file, che sia stato caricato prima o catalogato da un assistente. Se c’è, il file indica **Già nell’archivio**, con un link alla foto, e non viene caricato di nuovo. (I file oltre 512 MB saltano questo controllo, perché richiederebbe di leggere l’intero file.)

Le copie non identiche, come un’esportazione più piccola o un JPEG salvato di nuovo, vengono caricate e poi compaiono in [Duplicati](/help/duplicates) come somiglianti.

## Cosa succede dopo

Pochi secondi dopo ogni caricamento, cf-dam:

1. legge i dettagli: fotocamera, obiettivo, esposizione, data, GPS e le parole chiave, il titolo, la didascalia, i crediti e il copyright già presenti nel file;
2. crea una miniatura e un’anteprima;
3. ricava città e paese dalla posizione GPS;
4. la rende ricercabile;
5. la mette in coda per la [revisione IA](/help/ai-review), se è attiva per le nuove foto.

## Tipi di file

| Tipo | Note |
| --- | --- |
| JPEG, PNG, WebP, AVIF, GIF, HEIC (iPhone) | Anteprime create da cf-dam. |
| File oltre circa 20 MB | Il tuo browser crea l’anteprima prima del caricamento, perché il servizio immagini di Cloudflare legge solo file fino a 20 MB. |
| RAW (file della fotocamera), TIFF | Le anteprime vengono dal piccolo JPEG che la maggior parte delle fotocamere mette dentro il file. Se manca, la foto resta senza anteprima finché un assistente non ne crea una. |
| Video | Il tuo browser crea un fotogramma di copertina, se riesce a riprodurre il video. |

## Direttamente nell’archivio profondo

Se carichi direttamente in **Glacier** o **Deep Archive**, il tuo browser crea prima l’anteprima, perché poi nulla potrà rileggere l’originale per ore. Per riavere l’originale in seguito serve un ripristino: vedi [Archiviare e ripristinare gli originali](/help/archiving).
