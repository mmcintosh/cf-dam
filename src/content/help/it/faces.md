---
title: "Trovare i volti"
summary: "Lasciare che cf-dam trovi i volti nelle tue foto per dare un nome alle persone con un clic, e cosa viene conservato."
section: Your photos
order: 11
review: machine
source: ebbb7b10466e
---

**Trova volti** mostra nella pagina di una foto, sotto **Persone**, una piccola immagine di ogni volto trovato. Fai clic su una e scrivi chi è: la foto viene taggata con quella persona, come se avessi aggiunto il nome a mano. Fa risparmiare tempo con le foto di più persone, ed è così che la pagina di una persona ottiene un’immagine del suo volto.

Si tratta di **trovare, non di riconoscere**. cf-dam non stabilisce mai chi è qualcuno e non confronta mai un volto con un altro. Ogni volto lo nomini tu.

## Cosa viene conservato

Per ogni volto: un riquadro (dove si trova il volto nella foto) e quanto era sicuro il rilevatore. Nient’altro: nessun tratto del viso, nessuna «impronta facciale», niente che da solo possa identificare qualcuno. Il rilevatore (BlazeFace di Google) calcola anche dove sono occhi, naso e bocca; cf-dam lo scarta prima di salvare qualsiasi cosa.

I volti vengono trovati sui tuoi dispositivi, dal tuo helper (il programma sul tuo NAS o computer che cataloga le foto). Foto e volti non vengono mai inviati ad altri per questo. **I clienti non vedono mai i volti**: né nelle gallerie, né nei download, né nei file.

## Attivarlo

In **Configurazione → Revisione IA → Trova volti**, leggi cosa comporta (vedi [I volti e la legge](/help/faces-and-the-law)), spunta **Ho letto** e premi **Attiva «Trova volti»**. Serve il permesso di modificare le impostazioni (gli amministratori, per impostazione predefinita). Dopodiché:

- il tuo helper esamina ogni nuova foto mentre ne crea l’anteprima, e lavora sulle foto più vecchie in background, qualche centinaio al minuto;
- le foto caricate dal sito web vengono esaminate dal loro album: nella pagina di un album (o di un lavoro), **Trova i volti in questo album** esamina le foto non ancora esaminate, in quella scheda. Tieni aperta la scheda (e in primo piano, su un telefono) finché non ha finito; chiuderla la ferma, e il resto aspetta la prossima volta. Una scheda fa qualche migliaio di foto all’ora.

Il tuo helper deve essere aggiornato: uno più vecchio continua come prima, senza volti.

## Dare un nome ai volti

Nella pagina di una foto, fai clic su un volto:

- scrivi un nome (vengono proposte le persone già nominate) e premi **Assegna**;
- **Nessuno da nominare** per un passante, un volto su un manifesto o una statua: viene messo da parte e non viene più proposto (**Mostra** fa ricomparire i volti messi da parte);
- **Togli il nome** toglie il nome da quel volto; se nessun altro volto della foto ha quel nome, la persona viene tolta anche dalla foto.

Togliere qualcuno da una foto sotto **Persone** toglie anche il suo nome dal suo volto in quella foto. Unire due persone sposta i loro volti; eliminare una persona mette da parte i suoi volti, così non vengono più proposti.

Dare un nome a un volto cambia subito ciò che la coppia può trovare in una galleria, se la galleria elenca quella persona (vedi [Persone in una galleria cliente](/help/people-in-galleries)).

## Nominarne molti in una volta

Nella pagina di un album (o di un lavoro), **Volti da nominare** mostra i volti trovati lì che nessuno ha nominato o messo da parte, i più grandi prima. Spunta più volti della stessa persona, scrivi o scegli il suo nome una volta e premi **Assegna**: ogni volto spuntato viene nominato e ogni foto taggata. **Nessuno da nominare** mette da parte i volti spuntati. **Foto** sotto un volto apre la sua foto.

## Quanto funziona bene

Trova la maggior parte dei volti fino a circa il 3% della larghezza di una foto: le ultime file di un gruppo di una ventina di persone. Spesso non vede i volti in parte coperti (da un’altra testa, una mano o un telefono) o molto girati di lato, e ogni tanto incornicia qualcosa che non è un volto, come un vestito a fantasia. Chi non viene trovato si può nominare a mano nella foto, come sempre.

Trovare i volti non cambia mai il numero di **Persone** di una foto; la pagina mostra entrambi.

## Mettere in pausa e rimuovere

**Metti in pausa** ferma subito ogni ricerca; tutto ciò che è stato trovato resta, e puoi continuare a dare nomi ai volti. Riattivato, riprende da dove si era fermato.

**Rimuovi tutti i riquadri dei volti…**, in pausa, elimina ogni volto trovato dal rilevatore, con nome o senza. I nomi restano sulle foto come normali tag. Avviene in background, qualche migliaio al minuto.

## Se non c’è

Un’installazione può essere configurata senza la ricerca dei volti. In tal caso **Trova volti** dice che non fa parte di questa installazione, e non compare nulla sui volti da nessuna parte.
