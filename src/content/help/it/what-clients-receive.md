---
title: "Cosa ricevono i clienti"
summary: "Cosa c’è nei file che i clienti scaricano o acquistano da una galleria, cosa possono leggere nella pagina e cosa controllare prima di inviare un link."
section: Sharing
order: 6
review: machine
source: f6588c6151b7
---

Una galleria mostra le tue foto, ma un file scaricato può contenere più dell’immagine. Questa pagina elenca cosa ricevono i clienti, così non se ne va con il file niente che volevi tenere privato.

## Nella pagina della galleria

- **Titoli, didascalie e testi alternativi** sono visibili a chiunque apra il link. Una didascalia come «Lily, 4 anni, con la nonna» nomina delle persone, quindi controlla le didascalie prima di condividere un album.
- **I nomi dei file** si vedono solo con **Mostra i nomi dei file** attivo.
- **Le persone che hai nominato** in cf-dam non vengono mai mostrate, e nemmeno parole chiave, valutazioni, luoghi sulla mappa o note.

## Nomi dei file

Con **Mostra i nomi dei file** disattivato, niente di ciò che riceve un cliente porta il vero nome del file. I download prendono il nome della galleria e il posto della foto al suo interno, per esempio `matrimonio-rossi-042.jpg`. Gli ordini e le ricevute di Stripe la chiamano **Foto 42**. Se è attivo, i file mantengono il loro vero nome.

## Download Piccolo e Grande

I download Piccolo e Grande sono JPEG che cf-dam crea dalla foto, con le tue modifiche (ritagli e rotazioni) e la filigrana se la galleria ne ha una.

## Originali

Un originale scaricato è **il file esattamente com’è stato caricato**. Questo comprende:

- **Tutto ciò che il tuo programma di fotoritocco ci ha scritto:** per esempio Lightroom può scriverci nomi di persone, parole chiave, didascalie, valutazioni e i tuoi recapiti.
- **Le informazioni della fotocamera:** alcune fotocamere e telefoni aggiungono la posizione GPS, il nome del proprietario della fotocamera e i propri nomi del riconoscimento facciale.
- **Nessuna modifica fatta in cf-dam.** Se qui hai tagliato fuori qualcuno con un ritaglio, nell’originale c’è ancora.

Anche i download a pagamento in **Dimensione piena** sono originali, venduti solo per foto JPEG e PNG senza modifiche in cf-dam.

Prima di offrire gli originali, controlla cosa include la tua esportazione. In Lightroom, l’impostazione **Metadati** dell’esportazione può includere solo copyright e recapiti, e togliere le informazioni su persone e luogo.

Gli originali arrivano sempre da cf-dam stesso. Anche se sono archiviati su Amazon S3, il cliente non riceve mai un link al tuo bucket.

> **Prossimamente:** cf-dam toglierà nomi di persone, parole chiave, didascalie e posizione dagli originali JPEG e PNG quando i clienti li scaricano, mantenendo i dati della fotocamera e il tuo copyright. Ogni galleria avrà un interruttore per inviare gli originali esattamente come sono archiviati.

## Altri tipi di file

Le foto RAW, TIFF, HEIC, WebP, AVIF e GIF e i video vengono sempre inviati come sono archiviati. Le foto da telefono (HEIC) e i video contengono spesso la posizione GPS.

## Vedi anche

- [Gallerie clienti](/help/client-galleries)
- [Vendere foto](/help/selling)
- [Persone nelle foto](/help/people-in-photos)
