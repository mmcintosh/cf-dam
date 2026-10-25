---
title: "Vendere foto"
summary: "Permettere ai clienti di acquistare file digitali dalla loro galleria: collegare Stripe, listini prezzi, ordini, rimborsi e di cosa sei responsabile."
section: Sharing
order: 5
review: machine
source: 43b5d0e7ac24
---

I clienti possono acquistare file digitali dalla loro galleria e pagare con Stripe, sul tuo account Stripe. I soldi vanno a te; cf-dam non prende commissioni. Le stampe arriveranno più avanti.

## Cosa ti serve

- Un account **Stripe** (stripe.com). Prova prima tutto con la **modalità test** di Stripe: non si muovono soldi veri, e cf-dam mostra **Modalità test** finché ci sei.
- Essere pronto ad agire come venditore: IVA o imposte sulle vendite, rimborsi e ricevute spettano a te. Stripe può calcolare e riscuotere le imposte per te, ma registrazione e dichiarazioni le fai tu.

## Collegare Stripe

In **Lavoro per i clienti → Ordini**, la sezione **Vendita** ti guida passo per passo (solo amministratori):

1. In Stripe, in **Developers → API keys**, crea una **chiave limitata** che possa scrivere Checkout Sessions e leggere Charges e Payment Intents. Incollala in **Chiave limitata Stripe**.
2. In Stripe, in **Developers → Webhooks**, aggiungi un endpoint all’indirizzo mostrato, con gli eventi elencati accanto.
3. Copia il **signing secret** di quell’endpoint (inizia con `whsec_`) in **Signing secret del webhook**, premi **Salva** e poi **Verifica**.

La chiave e il secret vengono conservati cifrati, non vengono mai più mostrati e restano fuori dai backup del catalogo (inseriscili di nuovo dopo un ripristino in una nuova installazione). In **Tu, il venditore**, scegli la **Valuta** (non si può cambiare una volta che prezzi o ordini la usano), il **Nome dell’attività** e le **Condizioni e rimborsi** mostrati nella pagina di pagamento di Stripe.

## Listini prezzi

Un listino dice quanto costano **Piccola**, **Grande** e **Dimensione piena**, e quanto costano **Tutte le foto** di una galleria in un colpo solo. Lascia vuoto un prezzo per non vendere quella dimensione. Crea quanti listini vuoi (per i matrimoni, per i ritratti…), poi scegline uno per una galleria, sotto il suo link, in **Vende con**.

- Una dimensione che la galleria già regala non viene venduta lì.
- **Piccola** e **Grande** sono ricavate dalla foto così come la vedono i clienti (con la tua rotazione e il tuo ritaglio), senza filigrana.
- **Dimensione piena** è il file originale, quindi viene offerta solo per originali JPEG e PNG che non hai ruotato né ritagliato in cf-dam, e solo finché l’originale si può leggere in quel momento (non su un NAS, non in un archivio profondo).

## Cosa vedono i clienti

Nella galleria, la vista grande di una foto ha **Acquista…** con ogni dimensione e il suo prezzo, e in cima alla galleria c’è **Acquista tutte le foto** quando ha un prezzo. Pagano sulla pagina di Stripe stessa (carta, Apple Pay, Google Pay, Link) e tornano alla loro **pagina dell’ordine**: il suo indirizzo è il loro link ai file, su qualsiasi dispositivo. La galleria mostra anche cosa hanno acquistato, nel browser con cui l’hanno acquistato.

## Ordini

**Lavoro per i clienti → Ordini** elenca cosa è stato acquistato: quando, da chi, da quale galleria, il totale e il suo stato.

- **Pagato**: i download funzionano.
- **Da controllare**: Stripe dice che è pagato, ma l’importo non corrisponde a quanto ordinato. Niente è scaricabile finché non hai controllato; risolvi in Stripe (rimborso, o contatta il cliente).
- **Rimborsato** e **Contestato**: i download si fermano. Fai i rimborsi nella tua dashboard di Stripe; l’ordine qui si aggiorna da solo.
- **In pagamento** e **Non pagato**: un cliente ha lasciato la pagina di pagamento; non è stato addebitato nulla.

Se il messaggio di Stripe su un pagamento va perso, cf-dam lo chiede a Stripe stesso qualche minuto dopo, così un ordine pagato non resta mai bloccato.
