---
title: "Avvisi e attività"
summary: "I problemi che richiedono qualcuno e il registro di chi ha fatto cosa."
section: People and security
order: 3
review: machine
source: bf3a2942f6b3
---

Entrambe le pagine sono per gli amministratori.

## Avvisi

cf-dam si controlla da solo ogni cinque minuti e genera un **avviso** quando qualcosa richiede una persona. Il menu mostra quanti sono aperti accanto ad **Avvisi**.

| Avviso | Cosa significa di solito | Cosa fare |
| --- | --- | --- |
| Un assistente è offline | Un NAS o un computer è spento, in stop o ha perso la connessione di rete. | Controlla che sia acceso. Dopo un cambio di rete, riavvia l’assistente (o il suo container). |
| Un assistente non può leggere una cartella | Il computer o il NAS non lo fa entrare: su un Mac gli è stato negato l’accesso a Immagini, a un disco o a un volume di rete. | Su un Mac: **Impostazioni di Sistema → Privacy e sicurezza → File e cartelle** (oppure **Accesso completo al disco**), consenti `node`. Su un NAS: i permessi della cartella. |
| Problemi di archiviazione a lungo termine | Un assistente non è riuscito a copiare gli originali nel bucket di archivio. | L’avviso dice perché: spesso sono i permessi del bucket. |
| Problemi di archiviazione | Gli originali che cf-dam si aspettava non erano dove pensava, oppure un bucket non si può leggere. | Apri **Archiviazione → Controlli**. |
| Backup non riusciti o in ritardo | Il backup giornaliero del catalogo non è stato completato. | Vedi [Backup](/help/backups); controlla il bucket dei backup. |
| Anteprime bloccate | Alcune miniature o anteprime non sono state create. | **Archiviazione → Anteprime → Riprova quelle bloccate**. |
| Lavoro in background che non riesce o è fermo | Il lavoro che cf-dam fa ogni minuto (elaborazione, IA, controlli, backup) ha un errore o non è partito. | L’avviso dice quale parte. Se si è fermato del tutto, cerca errori nei log del Worker nella dashboard di Cloudflare, oppure ripubblica. |

Ogni avviso dice da quando è attivo, e **Vai a** porta alla pagina che lo risolve. Quando il problema è sistemato, l’avviso si chiude da solo e passa in **Risolti nelle ultime due settimane**.

**Ignora** toglie un avviso dal conteggio mentre te ne occupi (o se hai deciso che non importa). Torna a contare se si ripresenta dopo essere stato risolto; **Riconteggialo** annulla l’ignora.

### Per email

Quando questo archivio può inviare email (vedi [Email](/help/email)), le persone che vedono gli avvisi ricevono anche un’email quando se ne apre uno nuovo: al massimo una al giorno per ogni tipo di problema, con l’elenco di ciò che è aperto e un link a questa pagina. Non arriva nessuna email quando un assistente desktop smette di farsi sentire (un portatile in stop), né per i problemi con l’email stessa. Disattiva queste email, o riattivale, in **Account → Email sui problemi**.

## Attività

**Attività** è il registro di chi ha effettuato l’accesso e di chi ha cambiato cosa, dal più recente: accessi (anche quelli non riusciti), persone aggiunte o modificate, ruoli, modifiche all’accesso in due passaggi, connessioni di archiviazione, importazioni, eliminazioni, gallerie condivise, revisione IA messa in coda, impostazioni cambiate e lavoro in background come backup e controlli.

Restringila per **Tipo** di evento o per **Persona**. È il primo posto dove guardare quando qualcosa è cambiato e non sai come.
