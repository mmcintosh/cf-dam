---
title: "Il tuo account e l’accesso"
summary: "Passkey, accesso in due passaggi, la tua password, dove hai effettuato l’accesso e chiavi API."
section: People and security
order: 2
review: machine
source: cb640b660183
---

La pagina **Account** (l’ultima voce del menu) raccoglie tutto ciò che riguarda il modo in cui accedi. È anche dove si trova [Aspetto e accessibilità](/help/appearance).

Il tuo archivio contiene anni di lavoro e momenti privati delle persone: vale la pena dedicare cinque minuti a rendere sicuro l’accesso.

## Passkey: il modo più semplice e sicuro

Una **passkey** ti fa accedere con l’impronta, il volto o il PIN del dispositivo, oppure con un gestore di password come 1Password, al posto della password. Non c’è niente da digitare e niente che un sito falso possa rubare.

1. In **Passkey**, premi **Aggiungi una passkey**.
2. Il browser o il gestore di password ti chiede dove conservarla; segui i suoi passaggi.

Aggiungine una su ogni dispositivo che usi (oppure una in un gestore di password che le sincronizza; l’elenco indica **sincronizzata**). Per sicurezza, per aggiungere una passkey serve un accesso fatto negli ultimi 15 minuti: se te lo chiede, esci, accedi di nuovo e aggiungila.

## Accesso in due passaggi con un’app di autenticazione

Se accedi con una password, aggiungi un secondo passaggio: un codice di sei cifre da un’app sul telefono (Google Authenticator, Microsoft Authenticator, 1Password, Authy e altre).

1. In **Accesso in due passaggi**, premi **Configura l’accesso in due passaggi** e conferma la password.
2. Scansiona il codice con l’app di autenticazione (oppure digita la chiave mostrata sotto **Non riesci a scansionare?**).
3. Digita il codice che mostra l’app e premi **Verifica e attiva**.
4. **Conserva i codici di backup** in un posto sicuro, come il tuo gestore di password o un foglio stampato. Ognuno funziona una volta se perdi il telefono. Non verranno mostrati di nuovo.

Non ti servono i codici quando accedi con una passkey. L’amministratore può rendere obbligatorio l’uno o l’altro per tutti (vedi [Persone e ruoli](/help/people-and-roles)).

**Hai perso il telefono e i codici di backup?** Chiedi a un amministratore: in **Persone**, **Telefono o passkey persi** disattiva i tuoi codici così puoi configurarli di nuovo.

## La tua password

Almeno 12 caratteri. Una frase breve che ricorderai è meglio di un miscuglio che dimenticherai. Cambiala in **Password**: digita quella attuale, poi quella nuova. Dopo troppi tentativi sbagliati l’account si blocca per un po’, e un amministratore può sbloccarlo.

## Dove hai effettuato l’accesso

Ogni browser resta connesso finché non resta inutilizzato per una settimana. **Dove hai effettuato l’accesso** li elenca e segna **Questo browser**. Con **Esci** disconnetti quelli che non riconosci, poi cambia la password.

## Chiavi API

Servono a script e altri programmi che lavorano con il tuo archivio, come uno script di esportazione. Una chiave può fare solo ciò che puoi fare tu, nei limiti degli **ambiti** che scegli, e può scadere. La chiave viene mostrata **una sola volta**, quando la crei: copiala subito. Non condividere mai le chiavi e non metterle nelle email.

Alla maggior parte delle persone non ne serve mai una. Gli assistenti sul tuo NAS e sui tuoi computer ricevono le proprie chiavi quando vengono abbinati; non le crei qui.
