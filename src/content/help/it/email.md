---
title: "Email"
summary: "Inviare inviti, reimpostazioni della password ed email delle gallerie dal tuo dominio: configurarla, attivarla e cosa fare quando si ferma."
section: Settings
order: 2
review: machine
source: a8d41006e12b
---

cf-dam può inviare email dal tuo dominio: inviti, reimpostazioni della password e messaggi sulle gallerie clienti. Finché non può, sono link che copi e passi tu stesso, e tutto il resto funziona come sempre.

L’email si configura in **Configurazione → Email**. La vedono solo gli amministratori.

## Cosa ti serve

- Il tuo dominio su **Cloudflare DNS** (lo stesso account Cloudflare in cui gira cf-dam).
- Il piano **Workers Paid**. L’invio è incluso fino a 3.000 email al mese; oltre, Cloudflare addebita una piccola somma.
- Un indirizzo da cui inviare. La cosa migliore è un **sottodominio**, per esempio `cf-dam@dam.yourstudio.com`: la posta da e verso il tuo indirizzo principale resta esattamente com’è, e le email ai clienti si costruiscono una reputazione propria.

## Configurarla

1. Nella dashboard di Cloudflare, apri **Email Service → Email Sending** e aggiungi il dominio da cui invierai (per esempio `dam.yourstudio.com`).
2. Quando mostra i record DNS che vuole aggiungere, accetta i tre record **cf-bounce**.
   - **Non** lasciargli aggiungere o sostituire un record `_dmarc` se ne hai già uno. Due record DMARC rompono DMARC per tutta la tua posta.
   - **Non** attivare **Email Routing** per un dominio la cui posta è gestita altrove (Google, Microsoft, Purelymail…): prenderebbe il controllo della posta in arrivo di quel dominio.
3. Accanto al codice di cf-dam, in un file chiamato `.env.deploy`, inserisci l’indirizzo di invio: `MAIL_FROM=cf-dam@dam.yourstudio.com`.
4. Esegui di nuovo il deploy. Il deploy controlla che il dominio possa inviare e aggiunge l’email solo se può; altrimenti dice perché e prosegue senza.
5. Apri **Configurazione → Email**, compila il **Nome dello studio** e l’indirizzo in **Le risposte vanno a** (la tua vera casella di posta) e premi **Attiva l’email**.

Attivare l’email fissa l’indirizzo web a cui puntano i link nelle email: quello che stai usando in quel momento, mostrato sulla pagina. Se più avanti sposti cf-dam su un nuovo indirizzo, apri Configurazione → Email dal nuovo indirizzo e premi **Usa questo indirizzo**.

## Controllare che funzioni

**Inviami un’email di prova** te ne invia una subito e ti dice immediatamente se non ci è riuscito. La prima volta, guarda anche nella cartella dello spam.

La pagina mostra anche quando è partita l’ultima email, quante ne sono partite nelle ultime 24 ore, cosa è in attesa e l’ultimo problema.

## Cosa viene inviato

- **Password dimenticata?** nella pagina di accesso: un link per scegliere una nuova password e poi un avviso che è stata cambiata. Vedi [Il tuo account e l’accesso](/help/account-security).
- **Inviti**: ai clienti che inviti a una galleria o aggiungi alla pagina di un cliente, e ai nuovi membri del team che scelgono la propria password, quando è spuntato **Invia loro l’invito per email** (o la casella corrispondente per il team). Vedi [Gallerie clienti](/help/client-galleries) e [Persone e ruoli](/help/people-and-roles).
- **Sulle gallerie**: **Scrivi ai membri**, un promemoria tre giorni prima che una galleria chiuda e un messaggio per te quando un cliente ha finito di scegliere. I clienti possono disattivare queste email per ogni galleria.
- **Problemi**: alle persone che vedono gli avvisi, quando qualcosa di nuovo richiede attenzione. Vedi [Avvisi e attività](/help/alerts-and-activity).

Ogni email parte con il nome del tuo studio, e le risposte vanno all’indirizzo che hai impostato.

## Quando qualcosa va storto

- Se il servizio di invio rifiuta l’account o l’indirizzo di invio, l’email **si ferma** (non viene inviato altro, quindi niente si accumula come errore) e un avviso lo segnala in **Team → Avvisi**. Risolvi in Cloudflare, poi invia un’email di prova: quando arriva, l’invio riparte e parte tutto ciò che era in attesa.
- Un messaggio che non va a buon fine per un motivo passeggero viene ritentato qualche minuto dopo, tre volte in tutto.
- Se si raggiunge il limite di invio del giorno, ciò che resta aspetta il giorno dopo, con un avviso.
- Un indirizzo che in passato ha respinto un messaggio (bounce) viene escluso dal servizio di invio; il messaggio viene segnato come non consegnato.

## Cosa viene conservato

Ogni email aspetta in una posta in uscita finché non viene inviata. I link che fanno accedere qualcuno o impostano una password vengono tolti non appena l’email è partita, e un messaggio il cui link è scaduto non viene mai inviato. La posta in uscita non fa parte dei backup del catalogo, e le voci vengono eliminate dopo 90 giorni.

## La copia di staging

Una copia di staging di cf-dam può contenere copie di clienti reali, quindi invia email solo agli indirizzi della sua lista consentita (`STAGING_MAIL_ALLOW_TO` in `.env.deploy`). Tutto il resto viene scartato, mai inviato.
