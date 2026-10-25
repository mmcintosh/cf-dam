---
title: "E-Mail"
summary: "Einladungen, Passwort-Zurücksetzungen und Galerie-E-Mails von deiner eigenen Domain senden: einrichten, einschalten, und was zu tun ist, wenn es aufhört."
section: Settings
order: 2
review: machine
source: a8d41006e12b
---

cf-dam kann E-Mails von deiner eigenen Domain senden: Einladungen, Passwort-Zurücksetzungen und Nachrichten zu Kundengalerien. Solange das nicht geht, sind das Links, die du kopierst und selbst weitergibst, und alles andere funktioniert wie gewohnt.

E-Mail wird unter **Einrichtung → E-Mail** eingerichtet. Nur Administratoren sehen es.

## Was du brauchst

- Deine Domain in **Cloudflare DNS** (im selben Cloudflare-Konto, in dem cf-dam läuft).
- Den Tarif **Workers Paid**. Bis zu 3.000 E-Mails im Monat ist das Senden inbegriffen; darüber hinaus berechnet Cloudflare einen kleinen Betrag.
- Eine Adresse, von der gesendet wird. Am besten eine **Subdomain**, zum Beispiel `cf-dam@dam.yourstudio.com`: E-Mails an und von deiner Hauptadresse bleiben genau, wie sie sind, und E-Mails an Kunden bauen ihren eigenen Ruf auf.

## Einrichten

1. Öffne im Cloudflare-Dashboard **Email Service → Email Sending** und füge die Domain hinzu, von der du senden wirst (zum Beispiel `dam.yourstudio.com`).
2. Wenn die DNS-Einträge angezeigt werden, die hinzugefügt werden sollen, übernimm die drei **cf-bounce**-Einträge.
   - Lass **keinen** `_dmarc`-Eintrag hinzufügen oder ersetzen, wenn du schon einen hast. Zwei DMARC-Einträge machen DMARC für deine gesamte E-Mail kaputt.
   - Schalte **Email Routing** **nicht** für eine Domain ein, deren E-Mail woanders abgewickelt wird (Google, Microsoft, Purelymail…): Es würde die eingehende E-Mail dieser Domain übernehmen.
3. Trag neben dem Code von cf-dam, in einer Datei namens `.env.deploy`, die Absenderadresse ein: `MAIL_FROM=cf-dam@dam.yourstudio.com`.
4. Führ den Deploy erneut aus. Der Deploy prüft, ob die Domain senden kann, und fügt E-Mail nur hinzu, wenn sie es kann; sonst sagt er, warum, und macht ohne E-Mail weiter.
5. Öffne **Einrichtung → E-Mail**, trag bei **Name des Studios** den Namen deines Studios und bei **Antworten gehen an** deine Adresse (dein echtes Postfach) ein und drück **E-Mail einschalten**.

Mit dem Einschalten wird die Webadresse festgelegt, auf die Links in E-Mails zeigen: die, die du in dem Moment benutzt, und sie steht auf der Seite. Wenn du cf-dam später unter eine neue Adresse umziehst, öffne Einrichtung → E-Mail von der neuen Adresse aus und drück **Diese Adresse verwenden**.

## Prüfen, ob es funktioniert

**Schick mir eine Test-E-Mail** schickt dir sofort eine und sagt gleich, wenn es nicht geklappt hat. Schau beim ersten Mal auch in deinen Spam-Ordner.

Die Seite zeigt außerdem, wann die letzte E-Mail rausging, wie viele in den letzten 24 Stunden rausgingen, was wartet und das letzte Problem.

## Was gesendet wird

- **Passwort vergessen?** auf der Anmeldeseite: ein Link, um ein neues Passwort zu wählen, und danach ein Hinweis, dass es geändert wurde. Siehe [Dein Konto und die Anmeldung](/help/account-security).
- **Einladungen**: an Kunden, die du zu einer Galerie einlädst oder zur Seite eines Kunden hinzufügst, und an neue Teammitglieder, die ihr eigenes Passwort wählen, wenn **Einladung per E-Mail schicken** (oder das entsprechende Kästchen beim Team) angehakt ist. Siehe [Kundengalerien](/help/client-galleries) und [Personen und Rollen](/help/people-and-roles).
- **Zu Galerien**: **Mitgliedern mailen**, eine Erinnerung drei Tage bevor eine Galerie schließt und eine Nachricht an dich, wenn ein Kunde mit dem Auswählen fertig ist. Kunden können diese E-Mails für jede Galerie einzeln abschalten.
- **Probleme**: an die Personen, die Warnungen sehen, wenn etwas Neues Aufmerksamkeit braucht. Siehe [Warnungen und Aktivität](/help/alerts-and-activity).

Jede E-Mail kommt unter dem Namen deines Studios, und Antworten gehen an die Adresse, die du festgelegt hast.

## Wenn etwas schiefgeht

- Wenn der Versanddienst das Konto oder die Absenderadresse ablehnt, **hält** E-Mail **an** (es wird nichts mehr gesendet, also stapelt sich nichts als Fehlschläge), und eine Warnung sagt es unter **Team → Warnungen**. Behebe es in Cloudflare und schick dann eine Test-E-Mail: Sobald sie durchkommt, startet das Senden wieder und alles, was gewartet hat, geht raus.
- Eine Nachricht, die aus einem vorübergehenden Grund fehlschlägt, wird ein paar Minuten später erneut versucht, insgesamt dreimal.
- Wenn das Tageslimit für das Senden erreicht ist, wartet der Rest bis zum nächsten Tag, mit einer Warnung.
- Eine Adresse, die schon einmal zurückgekommen ist (Bounce), lässt der Versanddienst aus; die Nachricht wird als nicht zugestellt markiert.

## Was aufbewahrt wird

Jede E-Mail wartet in einem Postausgang, bis sie gesendet ist. Links, mit denen sich jemand anmeldet oder ein Passwort festlegt, werden daraus entfernt, sobald die E-Mail raus ist, und eine Nachricht, deren Link abgelaufen ist, wird nie gesendet. Der Postausgang gehört nicht zu den Katalogsicherungen, und Einträge verschwinden nach 90 Tagen.

## Die Staging-Kopie

Eine Staging-Kopie von cf-dam kann Kopien echter Kunden enthalten, deshalb schickt sie E-Mails immer nur an die Adressen auf ihrer Erlaubnisliste (`STAGING_MAIL_ALLOW_TO` in `.env.deploy`). Alles andere wird verworfen, nie gesendet.
