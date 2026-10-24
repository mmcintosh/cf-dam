---
title: "Collegare Amazon S3"
summary: "Una guida passo passo, dall’apertura di un account Amazon Web Services fino a cf-dam che ci conserva gli originali."
section: Where photos are kept
order: 2
review: machine
source: 63cdd90c1d97
---

Amazon è nota soprattutto come negozio, ma noleggia anche spazio di archiviazione tramite un’attività separata, **Amazon Web Services (AWS)**. Il suo servizio di archiviazione si chiama **S3**. Molti fotografi lo usano perché una sua parte, **Glacier Deep Archive**, conserva un terabyte per circa un dollaro al mese.

Questa guida ti porta da zero a cf-dam che archivia gli originali in S3. La prima volta conta circa 30 minuti. Ti servono un indirizzo email, un telefono e una carta di credito o di debito.

> Non ti serve Amazon per usare cf-dam. Gli originali possono restare nell’archiviazione di Cloudflare o sul tuo NAS. Torna qui quando vuoi un’archiviazione economica a lungo termine.

## 1. Apri un account AWS

Il tuo account AWS è separato da qualsiasi account per gli acquisti su Amazon, anche se usa la stessa email.

1. Vai su [aws.amazon.com](https://aws.amazon.com) e scegli **Create an AWS account**.
2. Indica un indirizzo email e un nome per l’account (va bene il nome del tuo studio). AWS ti invia un codice via email per confermare l’indirizzo.
3. Scegli una password robusta. Questo primo accesso è il **root user**: il proprietario dell’account, che può fare tutto. Conserva la sua password nel tuo gestore di password.
4. Inserisci i tuoi dati di contatto e una carta di pagamento. AWS può fare un piccolo addebito temporaneo per verificare la carta.
5. Conferma il tuo numero di telefono con il codice che AWS ti invia.
6. Scegli un piano. I nuovi account partono comunque con un po’ di credito gratuito.

> **Sul piano Free:** al momento in cui scriviamo, il piano Free termina dopo sei mesi (o quando finisce il credito), e un account non aggiornato entro allora viene chiuso, insieme ai suoi file. Un archivio deve durare: scegli il piano **Paid** fin dall’inizio, oppure imposta un promemoria per aggiornarlo. Paghi solo ciò che usi.

## 2. Proteggi l’account

Prima di archiviare qualsiasi cosa:

1. Accedi, apri il menu sotto il nome del tuo account (in alto a destra) e scegli **Security credentials**.
2. In **Multi-factor authentication (MFA)**, scegli **Assign MFA device** e aggiungi una passkey, un’app di autenticazione o una chiave di sicurezza. Da quel momento servirà per accedere come root user.
3. Imposta un avviso di spesa: cerca **Budgets** nella console, scegli **Create budget**, seleziona il modello per il costo mensile e indica un importo piccolo, come 10 $, e la tua email. AWS ti scrive se i costi del mese lo superano.

## 3. Crea un bucket

Un **bucket** è uno spazio di archiviazione con un nome. Per cf-dam ne basta uno.

1. Nella casella di ricerca in cima alla console AWS, scrivi **S3** e aprilo.
2. Scegli **Create bucket**.
3. **Bucket name:** lettere minuscole, numeri e trattini, come `smith-studio-archive`. Deve essere unico in tutto AWS, quindi aggiungi qualcosa di tuo.
4. **Region:** scegli quella più vicina a te (ad esempio **US East (N. Virginia)** è `us-east-1`; **Europe (London)** è `eu-west-2`). Annota il codice: cf-dam te lo chiederà.
5. Lascia attivo **Block all public access**. Le tue foto restano private; a cf-dam non serve che siano pubbliche.
6. Lascia le altre impostazioni come sono e scegli **Create bucket**.

## 4. Collegalo a cf-dam

cf-dam può accedere al tuo bucket in due modi. **Senza chiavi** è più sicuro: non viene mai salvato nessun segreto simile a una password. Usa le **chiavi di accesso** se il modo senza chiavi non fa per te, ad esempio se il tuo cf-dam non è su `https`.

### Senza chiavi (consigliato)

Ti serve l’**ID del tuo account AWS**: il numero di 12 cifre nel menu sotto il nome del tuo account, in alto a destra nella console AWS.

1. In cf-dam, apri **Archiviazione** e premi **Aggiungi una connessione**.
2. Scegli **Amazon S3**, poi **Senza chiavi: un ruolo IAM (consigliato)**.
3. Compila **Nome**, il nome del **Bucket**, il codice della **Regione** e, se vuoi, una **Cartella nel bucket** come `cf-dam`.
4. **ARN del ruolo:** scrivi `arn:aws:iam::`, poi l’ID di 12 cifre del tuo account, poi `:role/cf-dam`. Ad esempio: `arn:aws:iam::123456789012:role/cf-dam`. (Creerai questo ruolo tra poco.)
5. Premi **Aggiungi e prova**. cf-dam apre la pagina della nuova connessione.
6. In quella pagina, **Configurazione AWS per questa connessione senza chiavi** è aperta. Mostra tre cose da copiare: un **URL e un’audience del provider di identità**, una **policy di attendibilità** e una **policy di autorizzazioni**.

Ora nella console AWS:

7. Cerca **IAM** e aprilo. Scegli **Identity providers**, poi **Add provider**.
8. Scegli **OpenID Connect**. Incolla l’**URL del provider** e l’**audience** da cf-dam. Scegli **Add provider**.
9. In IAM, scegli **Roles**, poi **Create role**.
10. Scegli **Custom trust policy**, cancella quello che c’è nella casella e incolla la **policy di attendibilità** da cf-dam (il pulsante **Copia** la copia). Scegli **Next**.
11. Salta l’elenco delle autorizzazioni (scegli **Next**). Chiama il ruolo esattamente `cf-dam`, poi **Create role**.
12. Apri il nuovo ruolo. In **Permissions**, scegli **Add permissions**, poi **Create inline policy**.
13. Scegli **JSON**, cancella quello che c’è e incolla la **policy di autorizzazioni** da cf-dam. Scegli **Next**, chiamala `cf-dam-bucket` e scegli **Create policy**.

Torna in cf-dam e premi **Prova** sulla connessione. «Connesso: un oggetto di prova è stato scritto, riletto ed eliminato» vuol dire che hai finito.

La policy di autorizzazioni fa entrare cf-dam solo in **quel bucket** (e in quella cartella): lì può aggiungere, leggere, eliminare e ripristinare file, ed elencarli. Non può toccare nient’altro nel tuo account AWS.

### Con le chiavi di accesso

1. Nella console AWS, apri **IAM**, scegli **Users**, poi **Create user**. Chiamalo `cf-dam`. Non dargli accesso alla console. Scegli **Next**.
2. Scegli **Attach policies directly**, poi **Next** e **Create user** (aggiungerai una policy tra poco).
3. Apri il nuovo utente. Scegli **Add permissions**, poi **Create inline policy**, poi **JSON**, e incolla questo, mettendo il nome del tuo bucket dove c’è scritto `YOUR-BUCKET` (due volte):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:RestoreObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::YOUR-BUCKET" }
  ]
}
```

4. Chiama la policy `cf-dam-bucket` e creala.
5. Nella scheda **Security credentials** dell’utente, scegli **Create access key**, seleziona **Application running outside AWS** e creala.
6. AWS mostra un **Access key ID** e una **Secret access key**. Il segreto viene mostrato **una sola volta**: tieni aperta questa pagina.
7. In cf-dam, **Archiviazione → Aggiungi una connessione → Amazon S3 → Chiavi di accesso**. Compila nome, bucket, regione e cartella, incolla entrambe le chiavi e premi **Aggiungi e prova**.

cf-dam cifra il segreto prima di salvarlo e non lo mostra mai più. Non inviare mai le chiavi via email e non incollarle da nessun’altra parte.

## 5. Se caricherai direttamente in questo bucket

Quando carichi dal browser su una connessione S3, i file vanno direttamente dal tuo computer ad Amazon. Il bucket deve consentirlo:

1. Nella pagina della connessione in cf-dam, sotto **Caricare dal browser**, premi **Copia** accanto alla regola.
2. Nella console AWS, apri il bucket, poi **Permissions**, scorri fino a **Cross-origin resource sharing (CORS)** e scegli **Edit**.
3. Incolla la regola e scegli **Save changes**.
4. Tornato in cf-dam, premi **Provare il caricamento da questo browser**.

Non ti serve se le tue foto arrivano in S3 solo tramite importazione o spostamento.

## 6. Rendilo predefinito (facoltativo)

Nella pagina della connessione, premi **Imposta come predefinita** per mandarci i nuovi caricamenti. Puoi comunque scegliere un’altra destinazione nella finestra di caricamento.

## Quanto costa

| | Circa (prezzi USA) |
| --- | --- |
| Archiviare in S3 Standard | 23 $ per terabyte al mese |
| Archiviare in Glacier Deep Archive | 1 $ per terabyte al mese (permanenza minima di 180 giorni) |
| Recuperare un file da Deep Archive | circa 20 $ per terabyte (opzione «Bulk», più economica: circa 2,50 $), più un’attesa fino a 12 o 48 ore |
| Scaricare fuori da AWS | circa 90 $ per terabyte dopo i primi 100 GB al mese |
| Miniature e anteprime di cf-dam | niente da Amazon: sono in Cloudflare |

Controlla la [pagina dei prezzi di S3 di Amazon](https://aws.amazon.com/s3/pricing/) per la tua regione. Vedi [Archiviare e ripristinare](/help/archiving) per spostare le foto in Glacier e recuperarle.

## Se la prova non riesce

| Cosa dice cf-dam | Di solito vuol dire |
| --- | --- |
| Access Denied | La policy di autorizzazioni ha un nome di bucket diverso, o una cartella che non corrisponde a quella della connessione. |
| Un messaggio sulla regione, o un «redirect» | Il codice della regione in cf-dam non corrisponde alla regione del bucket. |
| Not authorized to perform `sts:AssumeRoleWithWebIdentity` | Senza chiavi: l’URL o l’audience del provider di identità, o la policy di attendibilità del ruolo, non corrispondono a ciò che ha mostrato cf-dam. Copiali di nuovo. |
| The role can't be found | L’ARN del ruolo ha un errore di battitura, oppure il ruolo non si chiama `cf-dam`. |
| I caricamenti non riescono con un errore di rete | Manca la regola CORS del bucket (passo 5): **Provare il caricamento da questo browser** lo segnala. |

Ancora bloccato? Il [glossario](/help/glossary) spiega i termini di AWS. Un errore di battitura nel ruolo o nelle chiavi si corregge con **Modifica** nella pagina della connessione. Con **Rimuovi** puoi anche togliere una connessione che non ha mai funzionato e ricominciare (cf-dam non rimuove una connessione che contiene ancora originali o che qualcosa usa: la pagina dice cosa).
