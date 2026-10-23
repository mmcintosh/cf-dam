---
title: "Amazon S3 verbinden"
summary: "Eine Schritt-für-Schritt-Anleitung, vom Eröffnen eines Amazon-Web-Services-Kontos bis dahin, dass cf-dam dort Originale ablegt."
section: Where photos are kept
order: 2
review: machine
source: a41b1d1edfa1
---

Amazon kennt man vor allem als Shop, aber über ein eigenes Geschäft, **Amazon Web Services (AWS)**, vermietet es auch Speicherplatz. Der Speicherdienst heißt **S3**. Viele Fotografen nutzen ihn, weil ein Teil davon, **Glacier Deep Archive**, ein Terabyte für etwa einen Dollar im Monat aufbewahrt.

Diese Anleitung bringt dich von null bis dahin, dass cf-dam Originale in S3 speichert. Plane beim ersten Mal etwa 30 Minuten ein. Du brauchst eine E-Mail-Adresse, ein Telefon und eine Kredit- oder Debitkarte.

> Für cf-dam brauchst du Amazon nicht. Originale können im eigenen Speicher von Cloudflare bleiben oder auf deinem NAS. Komm hierher zurück, wenn du günstigen Langzeitspeicher möchtest.

## 1. Ein AWS-Konto eröffnen

Dein AWS-Konto ist von jedem Amazon-Einkaufskonto getrennt, auch wenn es dieselbe E-Mail-Adresse nutzt.

1. Geh zu [aws.amazon.com](https://aws.amazon.com) und wähle **Create an AWS account**.
2. Gib eine E-Mail-Adresse und einen Kontonamen an (der Name deines Studios passt gut). AWS schickt dir einen Code, um die Adresse zu bestätigen.
3. Wähle ein starkes Passwort. Diese erste Anmeldung ist der **root user**: der allmächtige Besitzer des Kontos. Bewahre sein Passwort in deinem Passwortmanager auf.
4. Trag deine Kontaktdaten und eine Zahlungskarte ein. AWS belastet die Karte eventuell kurz mit einem kleinen Betrag, um sie zu prüfen.
5. Bestätige deine Telefonnummer mit dem Code, den AWS schickt.
6. Wähle einen Tarif. Neue Konten starten in jedem Fall mit etwas Gratisguthaben.

> **Zum Free-Tarif:** Zum Zeitpunkt dieses Textes endet der Free-Tarif nach sechs Monaten (oder wenn das Guthaben aufgebraucht ist), und ein Konto, das bis dahin nicht hochgestuft wurde, wird geschlossen, mitsamt seinen Dateien. Ein Archiv soll lange halten, also wähle entweder gleich den **Paid**-Tarif oder stell dir eine Erinnerung zum Hochstufen. Du zahlst nur, was du nutzt.

## 2. Das Konto schützen

Bevor du etwas speicherst:

1. Melde dich an, öffne das Menü unter deinem Kontonamen (oben rechts) und wähle **Security credentials**.
2. Wähle unter **Multi-factor authentication (MFA)** die Option **Assign MFA device** und füge einen Passkey, eine Authenticator-App oder einen Sicherheitsschlüssel hinzu. Ab jetzt braucht die Anmeldung als root user diesen zweiten Schritt.
3. Richte eine Kostenwarnung ein: Such in der Konsole nach **Budgets**, wähle **Create budget**, nimm die Vorlage für monatliche Kosten und gib einen kleinen Betrag an, etwa 10 $, und deine E-Mail-Adresse. AWS schreibt dir, wenn die Kosten des Monats ihn überschreiten.

## 3. Einen Bucket anlegen

Ein **Bucket** ist ein benannter Speicherbereich. Für cf-dam genügt einer.

1. Tippe oben in der AWS-Konsole **S3** ins Suchfeld und öffne es.
2. Wähle **Create bucket**.
3. **Bucket name:** Kleinbuchstaben, Ziffern und Bindestriche, etwa `smith-studio-archive`. Der Name muss in ganz AWS einmalig sein, also hänge etwas Eigenes an.
4. **Region:** Wähle die nächstgelegene (zum Beispiel ist **US East (N. Virginia)** `us-east-1`; **Europe (London)** ist `eu-west-2`). Merk dir den Code: cf-dam fragt danach.
5. Lass **Block all public access** eingeschaltet. Deine Fotos bleiben privat; cf-dam braucht sie nicht öffentlich.
6. Lass die übrigen Einstellungen, wie sie sind, und wähle **Create bucket**.

## 4. Mit cf-dam verbinden

cf-dam kann sich auf zwei Wegen bei deinem Bucket anmelden. **Schlüssellos** ist sicherer: Es wird nie ein passwortähnliches Geheimnis gespeichert. Nimm **Zugriffsschlüssel**, wenn schlüssellos bei dir nicht klappt, zum Beispiel wenn dein cf-dam nicht über `https` läuft.

### Schlüssellos (empfohlen)

Du brauchst deine **AWS account ID**: die 12-stellige Zahl im Menü unter deinem Kontonamen, oben rechts in der AWS-Konsole.

1. Öffne in cf-dam **Speicher** und drücke **S3-Verbindung hinzufügen**.
2. Wähle **Amazon S3**, dann **Schlüssellos: eine IAM-Rolle (empfohlen)**.
3. Trag einen **Name**, den Namen des **Bucket**, den Code der **Region** und, wenn du magst, einen **Ordner im Bucket** wie `cf-dam` ein.
4. **Rollen-ARN:** Tippe `arn:aws:iam::`, dann deine 12-stellige Konto-ID, dann `:role/cf-dam`. Zum Beispiel: `arn:aws:iam::123456789012:role/cf-dam`. (Die Rolle legst du gleich an.)
5. Drücke **Hinzufügen und testen**. Der Test schlägt vorerst fehl: Das ist so gewollt.
6. Öffne unter der neuen Verbindung **AWS-Einrichtung für diese schlüssellose Verbindung**. Dort stehen drei Dinge zum Kopieren: eine **URL und Audience des Identitätsanbieters**, eine **Vertrauensrichtlinie** und eine **Berechtigungsrichtlinie**.

Jetzt in der AWS-Konsole:

7. Such nach **IAM** und öffne es. Wähle **Identity providers**, dann **Add provider**.
8. Wähle **OpenID Connect**. Füge die **Provider-URL** und die **Audience** aus cf-dam ein. Wähle **Add provider**.
9. Wähle in IAM **Roles**, dann **Create role**.
10. Wähle **Custom trust policy**, lösche, was im Feld steht, und füge die **Vertrauensrichtlinie** aus cf-dam ein (der Knopf **Kopieren** kopiert sie). Wähle **Next**.
11. Überspring die Liste der Berechtigungen (wähle **Next**). Nenne die Rolle genau `cf-dam`, dann **Create role**.
12. Öffne die neue Rolle. Wähle unter **Permissions** die Option **Add permissions**, dann **Create inline policy**.
13. Wähle **JSON**, lösche, was dort steht, und füge die **Berechtigungsrichtlinie** aus cf-dam ein. Wähle **Next**, nenne sie `cf-dam-bucket` und dann **Create policy**.

Zurück in cf-dam drückst du bei der Verbindung auf **Testen**. „Verbunden: Ein Testobjekt wurde geschrieben, zurückgelesen und gelöscht.“ heißt, du bist fertig.

Die Berechtigungsrichtlinie lässt cf-dam nur in **diesen einen Bucket** (und Ordner): Es kann dort Dateien hinzufügen, lesen, löschen und wiederherstellen und sie auflisten. Alles andere in deinem AWS-Konto kann es nicht anfassen.

### Mit Zugriffsschlüsseln

1. Öffne in der AWS-Konsole **IAM**, wähle **Users**, dann **Create user**. Nenne ihn `cf-dam`. Gib ihm keinen Konsolenzugang. Wähle **Next**.
2. Wähle **Attach policies directly**, dann **Next** und **Create user** (eine Richtlinie fügst du gleich hinzu).
3. Öffne den neuen Benutzer. Wähle **Add permissions**, dann **Create inline policy**, dann **JSON**, und füge das hier ein. Setz deinen Bucket-Namen dort ein, wo `YOUR-BUCKET` steht (zweimal):

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

4. Nenne die Richtlinie `cf-dam-bucket` und leg sie an.
5. Wähle auf dem Reiter **Security credentials** des Benutzers **Create access key**, nimm **Application running outside AWS** und leg ihn an.
6. AWS zeigt eine **Access key ID** und einen **Secret access key**. Das Geheimnis wird **nur ein einziges Mal** angezeigt: Lass diese Seite offen.
7. In cf-dam: **Speicher → S3-Verbindung hinzufügen → Amazon S3 → Zugriffsschlüssel**. Trag Name, Bucket, Region und Ordner ein, füge beide Schlüssel ein und drücke **Hinzufügen und testen**.

cf-dam verschlüsselt das Geheimnis, bevor es gespeichert wird, und zeigt es nie wieder an. Schick Schlüssel nie per E-Mail und füge sie nirgendwo sonst ein.

## 5. Wenn du direkt in diesen Bucket hochlädst

Wenn du im Browser zu einer S3-Verbindung hochlädst, gehen die Dateien direkt von deinem Computer zu Amazon. Der Bucket muss das erlauben:

1. Öffne im Formular **S3-Verbindung hinzufügen** in cf-dam (oder wenn du eine weitere hinzufügst) **Browser-Uploads gehen direkt in den Bucket** und kopiere die Regel.
2. Öffne in der AWS-Konsole den Bucket, dann **Permissions**, scroll zu **Cross-origin resource sharing (CORS)** und wähle **Edit**.
3. Füge die Regel ein und wähle **Save changes**.

Das brauchst du nicht, wenn deine Fotos nur durch Importieren oder Verschieben nach S3 gelangen.

## 6. Als Standard festlegen (optional)

Drück auf **Speicher** bei der Verbindung **Als Standard festlegen**, damit neue Uploads dorthin gehen. Im Upload-Fenster kannst du trotzdem einen anderen Ort wählen.

## Was es kostet

| | Ungefähr (US-Preise) |
| --- | --- |
| Speichern in S3 Standard | 23 $ pro Terabyte und Monat |
| Speichern in Glacier Deep Archive | 1 $ pro Terabyte und Monat (mindestens 180 Tage) |
| Eine Datei aus Deep Archive zurückholen | etwa 20 $ pro Terabyte (günstigere Option „Bulk“: etwa 2,50 $), plus bis zu 12 oder 48 Stunden Wartezeit |
| Herunterladen aus AWS | etwa 90 $ pro Terabyte nach den ersten 100 GB im Monat |
| Vorschaubilder und Vorschauen von cf-dam | nichts bei Amazon: Sie liegen bei Cloudflare |

Die Preise für deine Region findest du auf [Amazons S3-Preisseite](https://aws.amazon.com/s3/pricing/). Wie du Fotos in Glacier verschiebst und zurückholst, steht unter [Archivieren und wiederherstellen](/help/archiving).

## Wenn der Test fehlschlägt

| Was cf-dam sagt | Bedeutet meistens |
| --- | --- |
| Access Denied | In der Berechtigungsrichtlinie steht ein anderer Bucket-Name oder ein Ordner, der nicht zum Ordner der Verbindung passt. |
| Eine Meldung über die Region oder ein „redirect“ | Der Region-Code in cf-dam passt nicht zur Region des Buckets. |
| Not authorized to perform `sts:AssumeRoleWithWebIdentity` | Schlüssellos: URL oder Audience des Identitätsanbieters oder die Vertrauensrichtlinie der Rolle passen nicht zu dem, was cf-dam angezeigt hat. Kopiere sie noch einmal. |
| Die Rolle wird nicht gefunden | Im Rollen-ARN ist ein Tippfehler, oder die Rolle heißt nicht `cf-dam`. |
| Uploads scheitern mit einem Netzwerkfehler | Die CORS-Regel des Buckets fehlt (Schritt 5). |

Kommst du immer noch nicht weiter? Das [Glossar](/help/glossary) erklärt die AWS-Begriffe. Eine Verbindung, die nie funktioniert hat, kannst du **Entfernen** und neu anfangen. (cf-dam entfernt keine, die noch Originale enthält: Verschieb sie zuerst.)
