---
title: "Lavori"
summary: "Seguire ogni lavoro per un cliente dalla prenotazione alla consegna: date del servizio, fasi, album, gallerie e cosa c’è da seguire."
section: Sharing
order: 4
review: machine
source: 8885dfc0fa09
---

Un **lavoro** è un incarico per un cliente: un matrimonio, un ritratto, un servizio di prodotto. Conserva le date del servizio, il luogo, a che punto è il lavoro e i suoi album. Le sue gallerie sono le gallerie dei suoi album. **Lavori** è la prima scheda di **Lavoro per i clienti** nel menu, accanto a **Clienti** e **Gallerie clienti**; come per i clienti, lo vedono solo gli **amministratori**.

## Creare un lavoro

- **Dalla Libreria**, il modo abituale, dopo il servizio: filtra la Libreria sulle foto del servizio (un album, un mese, una cartella, una parola chiave), poi premi **Nuovo lavoro da queste foto**. Il modulo compila le date del servizio dalle foto e propone di metterle nel primo album del lavoro.
- **Dalla pagina di un cliente**: lì **Nuovo lavoro** sceglie il cliente al posto tuo.
- **Da Lavori**: **Nuovo lavoro**. Nello stesso modulo puoi creare un nuovo cliente: scegli **+ Nuovo cliente** e scrivi il nome.

Dagli un titolo per il tuo team (*Matrimonio Rossi*) e, se vuoi, un **Nome che vede il cliente** (*Il vostro matrimonio*), il tipo di lavoro, la data del servizio (e l’ultimo giorno, per un servizio di più giorni), il luogo e la data prevista di consegna.

Nella pagina del lavoro, **Link al tuo CRM** conserva l’indirizzo di questo lavoro nel tuo CRM, con **Apri in…** accanto (vedi [Clienti](/help/clients)).

## Fasi

Un lavoro passa per **Prenotato**, **Scattato**, **Editing**, **Selezione del cliente**, **Ritocchi finali**, **Consegnato** e **Completato**, oppure è **Annullato**. Premi una fase nella pagina del lavoro per spostarlo lì, avanti o indietro. **Selezione del cliente** e **Ritocchi finali** (tratteggiate) si possono saltare: un ritratto o un servizio di prodotto spesso non prevede la selezione del cliente.

Due passaggi avvengono da soli, e la cronologia lo indica:

- **Prenotato → Scattato** quando arrivano nell’archivio foto scattate nelle date del servizio.
- **→ Consegnato** quando crei una galleria da uno degli album del lavoro con **Consegna finale** spuntata (vedi [Gallerie clienti](/help/client-galleries)).

Tutto il resto dipende da te. **Completato** è per quando il lavoro è finito e pagato.

## Album e gallerie

Nella pagina del lavoro, **Album** elenca i suoi album con le loro foto e gallerie:

- **Aggiungi un album** mette nel lavoro un album che hai già. Un album appartiene al massimo a un lavoro; una foto può stare in più album.
- **Nuovo album con le foto delle date del servizio** ne crea uno con tutte le foto scattate in quei giorni.
- **Crea una galleria** apre l’album con il modulo della galleria pronto.
- **Togli dal lavoro** lascia l’album e le sue gallerie come sono.

Un album che fa parte di un lavoro mostra un link al lavoro in cima alla sua pagina.

## Originali

**Originali**, nella pagina del lavoro, dice dove sono i file originali delle sue foto:

- quanti **sono leggibili ora** (dallo spazio di archiviazione dell’archivio, da un computer o NAS, o da una copia ripristinata);
- quanti **vanno ripristinati**: sono solo in un archivio a freddo (Glacier o Deep Archive), quindi nessuno può scaricarli finché non vengono recuperati;
- quanti sono **solo su un computer o NAS**: puoi aprirli, ma una galleria clienti non può offrirli come originali;
- quanti hanno un **backup a freddo**, cioè una copia in Glacier o Deep Archive. Se la copia dell’archivio resta, un backup a freddo non rende una foto illeggibile.

L’elenco **Lavori** mostra lo stesso in breve: *Leggibili* o *n da ripristinare*, e *backup a freddo* quando ogni foto ne ha uno.

### Ripristinare un lavoro

Prima di un ordine di ristampe, per esempio, premi **Ripristina n originali…**. Scegli la **Velocità** (*Bulk*: la più economica, fino a 48 ore; *Standard*: più veloce, fino a 12 ore) e per quanti giorni tenere le copie, poi **Vedi il costo**: tirarli fuori dall’archivio, tenere le copie e quanto costa se i clienti li scaricano tutti una volta (spesso la parte maggiore). Poi conferma. La pagina mostra a che punto è il ripristino e fino a quando le copie sono pronte. Gli originali restano nell’archivio; le copie ripristinate spariscono dopo i giorni scelti.

Il ripristino richiede il permesso di gestire i livelli di archiviazione (gli amministratori ce l’hanno).

Quando una galleria offre gli originali e alcuni originali dell’album sono archiviati o solo su un NAS, il modulo della galleria lo segnala prima che tu crei il link.

## Archiviare dopo la consegna

Quando **Archivia i lavori consegnati** è attivo (nella pagina **Archiviazione**: scegli la connessione S3, **Deep Archive** o **Glacier Flexible** e quanti giorni dopo la consegna), ogni originale negli album di un lavoro consegnato riceve una copia in quella classe a freddo, passati quei giorni. La copia nello spazio di archiviazione di cf-dam resta, quindi niente diventa più lento da aprire: la copia a freddo è un backup che costa pochissimo tenere.

- Prima di attivarlo, **Cosa archivierebbe ora?** mostra quanti lavori, originali e GB copierebbe in una volta (conta ogni lavoro già consegnato da abbastanza tempo), quanto costa al mese tenerli e quanto costa caricarli una volta.
- Ogni parte di una copia viene controllata quando arriva, e alla fine si confronta la dimensione della copia. Una copia interrotta riprende da dove si era fermata.
- Se consegni di nuovo un lavoro, per esempio dopo averlo riportato a **Editing**, i suoi giorni ripartono da capo.
- **Tieni caldo** nella pagina di un lavoro fa sì che non venga mai archiviato automaticamente (ristampe, album in lavorazione).
- **Archivia ora** copia subito un lavoro, nella classe che scegli (richiede il permesso di gestire le connessioni di archiviazione).
- Gli originali che sono solo su un computer o NAS li archivia il suo assistente quando quella cartella archivia su S3 (**Computer e NAS**); altrimenti il lavoro indica quanti ne restano fuori.
- Gli originali che non è stato possibile copiare dopo tre tentativi compaiono come avviso.

Sotto **Originali**, nella pagina del lavoro, **Backup a freddo** dice a che punto è: quando verrà archiviato, a che punto è una copia, quando è stato archiviato o cosa lo blocca.

## Cosa c’è da seguire

In cima a **Lavori**, **Da seguire** elenca:

- una consegna prevista entro 7 giorni, o in ritardo;
- un servizio di più di 3 giorni fa di cui non ci sono ancora foto;
- una galleria di un lavoro che chiude entro 7 giorni;
- una galleria di selezione senza preferite dopo 14 giorni.

**In corso** mostra i lavori aperti per fase, prima il servizio più vicino; **Consegnati e chiusi** e **Tutti** mostrano il resto. Cerca per titolo, luogo o cliente; gli accenti non contano.

## Eliminare un lavoro

**Elimina lavoro**, in fondo alla sua pagina (premilo due volte), rimuove solo il lavoro: i suoi album e le sue gallerie restano. Cancellare un cliente (vedi [Clienti](/help/clients)) rimuove anche i suoi lavori.
