---
title: "Glossario"
summary: "Le parole che usano cf-dam e i servizi di archiviazione, spiegate in modo semplice."
section: Getting started
order: 9
review: machine
source: 1f33cb2730fb
---

**Revisione IA.** Un modello di IA che guarda ogni foto e scrive dei suggerimenti: testo alternativo, didascalia, descrizione, parole chiave. Decidi tu cosa tenere. Vedi [Revisione IA](/help/ai-review).

**Testo alternativo.** Una breve descrizione di una foto per chi non può vederla. I lettori di schermo la leggono ad alta voce; gallerie e siti web la usano.

**Archivio.** Una copia sicura ed economica dei tuoi originali, di solito in Glacier Deep Archive, per il giorno in cui qualcosa va storto. Vedi [Archiviare gli originali](/help/archiving).

**AWS (Amazon Web Services).** L’attività di Amazon che noleggia computer e spazio di archiviazione, separata dal suo negozio. S3 ne fa parte. Vedi [Collegare Amazon S3](/help/amazon-s3).

**Bucket.** Uno spazio di archiviazione con un nome in S3, R2 o servizi simili: come un disco nel cloud. cf-dam può tenere gli originali in uno o più bucket.

**Catalogo.** Tutto ciò che cf-dam sa delle tue foto: dettagli, parole chiave, didascalie, valutazioni, album, miniature e anteprime. Non gli originali in sé.

**Galleria cliente.** Un album condiviso con un cliente tramite un link privato, con password, scadenza e download propri, oppure con un cliente che accede a un account che mostra solo le sue gallerie. Vedi [Gallerie clienti](/help/client-galleries).

**Docker.** Un modo standard per eseguire piccoli programmi, come l’assistente di cf-dam, su un NAS. Ogni programma gira nel proprio «container» isolato.

**EXIF.** I dettagli che la fotocamera scrive in ogni foto: fotocamera, obiettivo, esposizione, data e ora e posizione GPS, se ce l’ha.

**Glacier e Deep Archive.** Le classi di archiviazione più economiche di Amazon, per i file che apri di rado. Un terabyte in Deep Archive costa circa un dollaro al mese, ma per riavere un file servono fino a 12 o 48 ore. Vedi [Archiviare gli originali](/help/archiving).

**HEIC.** Il formato foto degli iPhone. cf-dam lo legge.

**Assistente (agente).** Un piccolo programma sul tuo NAS o computer che cataloga le foto dove si trovano, senza spostarle. Vedi [Computer e NAS](/help/computers-and-nas).

**IPTC.** L’insieme standard di campi per descrivere le foto usato da agenzie, giornali, Lightroom e Photo Mechanic: titolo, autore, riga di credito, copyright, condizioni d’uso, contatti, luogo, lavoro.

**Parola chiave.** Una parola o frase che dice cosa c’è in una foto o di cosa parla. cf-dam le organizza in un albero, come *Luoghi › Norvegia › Bergen*. Vedi [Parole chiave](/help/keywords).

**Simile.** Una copia di una foto che non è lo stesso file: ridimensionata, salvata di nuovo, esportata un’altra volta. Vedi [Duplicati](/help/duplicates).

**Metadati.** Informazioni su una foto, anziché l’immagine stessa: EXIF, IPTC, parole chiave, didascalie, valutazioni.

**NAS (network-attached storage).** Un box di dischi collegato alla tua rete, come un Synology o un QNAP, che conserva i file per tutti i computer di casa o dello studio.

**Neuroni.** L’unità con cui Cloudflare misura (e fattura) Workers AI. 10.000 al giorno sono gratuiti; poi 0,011 $ ogni 1.000. Revisionare 1.000 foto ne usa circa 46.000.

**Originale.** Il file completo uscito dalla fotocamera o dal programma di modifica. cf-dam non lo modifica mai.

**Codice di abbinamento.** Le otto lettere che mostra un nuovo assistente. Inserendolo in cf-dam colleghi l’assistente al tuo archivio.

**Passkey.** Un modo per accedere con l’impronta, il volto, il PIN del dispositivo o il gestore di password al posto della password. Più sicura, e niente da ricordare. Vedi [Il tuo account e l’accesso](/help/account-security).

**Anteprima.** Una copia grande di una foto (fino a 2.048 pixel di larghezza) che cf-dam crea per la visualizzazione, la condivisione e la revisione IA, conservata nel tuo account Cloudflare.

**R2.** Lo spazio di archiviazione di Cloudflare. Miniature e anteprime di cf-dam stanno sempre lì, e anche gli originali possono starci.

**RAW.** Il file non elaborato che alcune fotocamere salvano (come `.CR3`, `.NEF`, `.ARW`). Contiene il massimo dei dettagli; lo sviluppi in Lightroom o simili.

**Ripristino.** Riportare indietro da Glacier una copia di un originale archiviato, così da poterla scaricare. Anche: riportare il catalogo da un backup. Vedi [Backup](/help/backups).

**S3.** Il servizio di archiviazione di Amazon, e la «lingua» che parlano anche molti altri servizi di archiviazione (R2, Backblaze B2, Wasabi).

**Classe di archiviazione.** Il modo in cui un file è conservato in S3: Standard (immediato, il più caro), Infrequent Access, Glacier, Deep Archive (il più lento, il più economico).

**Miniatura.** Una copia piccola di una foto (480 pixel di larghezza) per la griglia della libreria.

**Accesso in due passaggi.** Un secondo passaggio dopo la password: un codice da un’app sul telefono. Vedi [Il tuo account e l’accesso](/help/account-security).

**Filigrana.** Il tuo nome o logo sovrapposto alle foto mostrate nelle gallerie clienti e alle copie scaricate. Gli originali non hanno mai la filigrana.

**XMP.** Un modo standard per salvare i metadati (parole chiave, didascalie, valutazioni, etichette) dentro una foto o in un piccolo file accanto (un «sidecar»), che Lightroom, Capture One e Bridge leggono.
