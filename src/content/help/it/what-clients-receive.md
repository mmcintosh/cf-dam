---
title: "Cosa ricevono i clienti"
summary: "Cosa c’è nei file che i clienti scaricano o acquistano da una galleria, cosa possono leggere nella pagina e cosa controllare prima di inviare un link."
section: Sharing
order: 6
review: machine
source: 95d3e6ae60c7
---

Una galleria mostra le tue foto, ma un file scaricato può contenere più dell’immagine. Questa pagina elenca cosa ricevono i clienti, così non se ne va con il file niente che volevi tenere privato.

## Nella pagina della galleria

- **Titoli, didascalie e testi alternativi** sono visibili a chiunque apra il link. Una didascalia come «Lily, 4 anni, con la nonna» nomina delle persone, quindi controlla le didascalie prima di condividere un album.
- **I nomi dei file** si vedono solo con **Mostra i nomi dei file** attivo.
- **Le persone che hai nominato** in cf-dam non vengono mai mostrate, e nemmeno parole chiave, valutazioni, luoghi sulla mappa o note.

## Nomi dei file

Con **Mostra i nomi dei file** disattivato, niente di ciò che riceve un cliente porta il vero nome del file. I download prendono il nome della galleria e il posto della foto al suo interno, per esempio `matrimonio-rossi-042.jpg`. Gli ordini e le ricevute di Stripe la chiamano **Foto 42**. Se è attivo, i file mantengono il loro vero nome.

## Download Piccolo e Grande

I download Piccolo e Grande sono JPEG che cf-dam crea dalla foto, con le tue modifiche (ritagli e rotazioni) e la filigrana se la galleria ne ha una. Non contengono nulla del file originale tranne il tuo **autore** e il tuo **avviso di copyright**, presi dai campi Diritti della foto in cf-dam. Se li cambi, il download successivo riporta quelli nuovi.

## Originali

Un originale scaricato è il file com’è stato caricato, **ripulito** all’uscita quando è un JPEG o un PNG:

- **Tolto:** i nomi delle persone (comprese le aree dei volti di Lightroom), didascalie e descrizioni, parole chiave, valutazioni, commenti, la posizione GPS, il nome del proprietario della fotocamera, le note private del produttore (alcune contengono nomi del riconoscimento facciale) e le credenziali dei contenuti (C2PA).
- **Mantenuto:** l’immagine stessa, intatta; le impostazioni della fotocamera e la data; e il tuo **autore** e **avviso di copyright**, dai campi Diritti della foto in cf-dam.
- **Le foto HDR da telefono**, che nascondono una seconda immagine nel file, arrivano come immagine standard.
- **Nessuna modifica fatta in cf-dam.** Se qui hai tagliato fuori qualcuno con un ritaglio, nell’originale c’è ancora.

Se un file non si può ripulire con certezza, non viene inviato affatto: al cliente viene chiesto di contattarti e l’**Attività** indica quale galleria.

**Invia gli originali esattamente come archiviati** (nelle impostazioni della galleria, in Download) invia gli originali intatti, con tutto ciò che il tuo programma e la tua fotocamera ci hanno scritto. Usalo solo dopo aver controllato cosa include la tua esportazione. In Lightroom, l’impostazione **Metadati** dell’esportazione può includere solo copyright e recapiti.

Anche i download a pagamento in **Dimensione piena** sono originali, ripuliti allo stesso modo, e venduti solo per foto JPEG e PNG senza modifiche in cf-dam.

Gli originali arrivano sempre da cf-dam stesso. Anche se sono archiviati su Amazon S3, il cliente non riceve mai un link al tuo bucket.

## Altri tipi di file

Le foto RAW, TIFF, HEIC, WebP, AVIF e GIF e i video vengono sempre inviati come sono archiviati, senza pulizia, qualunque sia l’impostazione della galleria. Le foto da telefono (HEIC) e i video contengono spesso la posizione GPS.

## Vedi anche

- [Gallerie clienti](/help/client-galleries)
- [Vendere foto](/help/selling)
- [Persone nelle foto](/help/people-in-photos)
