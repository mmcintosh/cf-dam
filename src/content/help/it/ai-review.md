---
title: "Revisione IA"
summary: "Far descrivere le tue foto a un modello di IA, quanto costa e come resti tu a decidere cosa scrive."
section: Your photos
order: 5
review: machine
source: 48fdc91af68c
---

La revisione IA guarda ogni foto e scrive dei suggerimenti: **testo alternativo**, una **didascalia**, una descrizione più lunga di **ciò che ha visto**, l’eventuale **testo nell’immagine** (cartelli, documenti), **parole chiave** suggerite e una nota sulla qualità. Rende ricercabile un grande archivio in un modo che nessuno ha il tempo di fare a mano, ed è ciò che legge la [ricerca per significato](/help/search).

Funziona con **Workers AI nel tuo account Cloudflare**. Le tue foto non vengono inviate a nessun’altra azienda e il modello non impara da esse.

## Decidi tu

Niente di ciò che scrive l’IA sostituisce le tue parole, a meno che tu non lo voglia. Nella [pagina di una foto](/help/photo-page), sotto **Suggerimenti IA**:

- **Usa questo** copia un suggerimento in un campo vuoto; **Sostituisci il mio** sovrascrive ciò che c’è.
- Le parole chiave suggerite sono subito ricercabili, segnate come dell’IA. **✓** ne mantiene una come tua, **×** la scarta, **Mantieni tutti** le mantiene tutte.
- **Analizza** la fa ripartire (per esempio dopo che hai cambiato il contesto qui sotto).

Per accettare i suggerimenti di molte foto insieme, selezionale nella libreria e usa **IA…**: **Usa le didascalie IA dove sono vuote**, **Usa il testo alternativo IA dove è vuoto**, **Mantieni i tag IA** oppure **Analizza di nuovo**.

## La pagina Revisione IA

**Revisione IA** nel menu mostra quante foto sono **analizzate**, **in coda**, **mai analizzate** e **non riuscite**, e quanto costa ogni 1.000 foto sul tuo archivio.

### Impostazioni (amministratori)

- **Revisione IA:** attiva o disattiva. Disattivata, si ferma ogni analisi; i suggerimenti già fatti restano.
- **Analizza i nuovi caricamenti:** ogni nuova foto viene messa in coda appena ha un’anteprima. Le foto che arrivano da un assistente vanno in coda dopo la prima scansione di una cartella.
- **Modello:** il modello di IA da usare. La pagina dice in cosa è bravo ciascuno.
- **Sul tuo lavoro:** una frase su di te, data al modello con ogni foto perché le sue parole chiave si adattino al tuo archivio, per esempio *«Fotografo di matrimoni e paesaggi nella Norvegia occidentale»* oppure *«Fotografia di uccelli, soprattutto nelle zone umide della Florida»*.

### Analizzare tutto in una volta

Se alcune foto non sono mai state analizzate, **Analizza l’archivio esistente** dice quante sono e quanto costerà, più o meno. Premi **Metti in coda** per iniziare. Le foto vengono elaborate in background, alcune alla volta; tu puoi continuare a lavorare. Una foto che non riesce viene riprovata un paio di volte, poi viene segnata come **non riuscita** con il motivo.

## Persone nelle foto

Accanto alla revisione IA, **Jev** di TypeSafe cerca le persone in ogni nuova foto, e quante sono, per il filtro **Persone** della libreria. È più veloce ed economico della revisione IA (circa 9 centesimi ogni 1.000 foto) e in una prova su 805 foto ha trovato persone in 87 dove la revisione IA ne trovava 47, per lo più piccole figure sullo sfondo. Non scrive testo.

- **Cosa viene inviato:** una copia di 1.024 px di ogni foto, senza nome del file, dati della fotocamera né luogo, va a TypeSafe (api.typesafe.ai). TypeSafe dichiara di non usarla per l’addestramento.
- **Foto precedenti:** il riquadro **Persone nelle foto** di questa pagina conta ciò che è stato trovato (ogni numero apre quelle foto nella libreria) e **Guardare N foto non ancora guardate** si occupa del resto.
- **Interruttori:** con **Cercare persone** disattivato non si invia più nulla a TypeSafe (le risposte già ottenute restano e il filtro continua a funzionare); con **Nelle foto nuove appena arrivano** disattivato, le foto nuove aspettano il pulsante.
- **Risposte sbagliate:** correggine una nella pagina della foto, o molte insieme nella libreria (selezionale, poi **Persone…**). Jev non cambia mai una risposta impostata a mano, e **Tornare alla risposta di Jev** la annulla.
- **Le foto che non è stato possibile guardare** sono elencate con il motivo: troppo piccole, rifiutate da TypeSafe o non riuscite tre volte (con **Riprova**).
- I video non vengono esaminati, né le foto sotto i 280 pixel per lato.

## Quanto costa

Workers AI si paga in **neuroni**. Cloudflare regala 10.000 neuroni al giorno, poi costa 0,011 $ ogni 1.000.

Un esempio reale: la revisione di 662 foto di uccelli ha usato circa 30.000 neuroni, circa **33 centesimi**, oppure circa 22 centesimi tolta la quota gratuita giornaliera. Sono più o meno 50 centesimi ogni 1.000 foto. La pagina Revisione IA mostra la cifra per il tuo archivio.

## Quanto è bravo?

È bravo a capire cosa c’è in un’immagine (*un airone cenerino in piedi in acqua bassa tra le canne*) e a leggere il testo. Non sa chi sono le persone, il nome dei luoghi che non riesce a leggere, né la storia dietro una foto. Quelle cose le aggiungi tu. Considera le sue parole chiave come una prima bozza, e il suo testo alternativo come una traccia da rivedere.
