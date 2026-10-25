---
title: "Dein Konto und die Anmeldung"
summary: "Passkeys, Zwei-Faktor-Anmeldung, dein Passwort, wo du angemeldet bist, und API-Schlüssel."
section: People and security
order: 2
review: machine
source: f65cab557caa
---

Deine Seite **Konto** (der letzte Punkt im Menü) enthält alles dazu, wie du dich anmeldest. Dort findest du auch [Darstellung und Barrierefreiheit](/help/appearance).

Dein Archiv enthält Jahre an Arbeit und private Momente anderer Menschen. Fünf Minuten für eine sichere Anmeldung lohnen sich also.

## Passkeys: der einfachste und sicherste Weg

Mit einem **Passkey** meldest du dich per Fingerabdruck, Gesicht oder Geräte-PIN an, oder mit einem Passwort-Manager wie 1Password, statt mit einem Passwort. Es gibt nichts zu tippen und nichts, was eine gefälschte Website stehlen könnte.

1. Drücke unter **Passkeys** auf **Passkey hinzufügen**.
2. Dein Browser oder Passwort-Manager fragt, wo er ihn speichern soll; folge seinen Schritten.

Füge auf jedem Gerät, das du nutzt, einen hinzu (oder einen in einem Passwort-Manager, der sie synchronisiert; die Liste zeigt dann **synchronisiert**). Aus Sicherheitsgründen braucht das Hinzufügen eines Passkeys eine Anmeldung innerhalb der letzten 15 Minuten: Wenn danach gefragt wird, melde dich ab, wieder an und füge ihn dann hinzu.

## Zwei-Faktor-Anmeldung mit einer Authenticator-App

Wenn du dich mit einem Passwort anmeldest, füge einen zweiten Schritt hinzu: einen sechsstelligen Code aus einer App auf deinem Telefon (Google Authenticator, Microsoft Authenticator, 1Password, Authy und andere).

1. Drücke unter **Zwei-Faktor-Anmeldung** auf **Zwei-Faktor-Anmeldung einrichten** und bestätige dein Passwort.
2. Scanne den Code mit deiner Authenticator-App (oder tipp den Schlüssel ein, der unter **Scannen geht nicht?** steht).
3. Tipp den Code ein, den die App zeigt, und drücke **Bestätigen und einschalten**.
4. **Bewahre die Backup-Codes** sicher auf, etwa in deinem Passwort-Manager oder ausgedruckt. Jeder funktioniert einmal, falls du dein Telefon verlierst. Sie werden nicht noch einmal angezeigt.

Wenn du dich mit einem Passkey anmeldest, brauchst du keine Codes. Dein Administrator kann das eine oder das andere für alle verlangen (siehe [Personen und Rollen](/help/people-and-roles)).

**Telefon und Backup-Codes verloren?** Frag einen Administrator: Unter **Team → Konten** schaltet **Telefon oder Passkey verloren** deine Codes aus, damit du sie neu einrichten kannst.

## Dein Passwort

Mindestens 12 Zeichen. Ein kurzer Satz, den du dir merkst, ist besser als ein Zeichensalat, den du vergisst. Ändere es unter **Passwort**: Tipp das aktuelle ein, dann das neue. Nach zu vielen falschen Versuchen wird das Konto eine Weile gesperrt, und ein Administrator kann es entsperren.

Vergessen? Wenn dieses Archiv E-Mails senden kann (siehe [E-Mail](/help/email)), hat die Anmeldeseite **Passwort vergessen?**: Gib deine Adresse ein, und ein Link für ein neues Passwort kommt an, der einmal und eine Stunde lang funktioniert. Er beendet auch alle anderen Anmeldungen, hebt eine Sperre auf, und du bekommst eine E-Mail, dass sich das Passwort geändert hat. Die Zwei-Faktor-Anmeldung fragt weiterhin nach ihrem Code. Ohne E-Mail bitte einen Administrator um ein vorläufiges Passwort.

## Wo du angemeldet bist

Jeder Browser bleibt angemeldet, bis er eine Woche lang nicht benutzt wurde. **Wo du angemeldet bist** listet sie auf und markiert **Dieser Browser**. Melde alle, die du nicht kennst, mit **Abmelden** ab und ändere dann dein Passwort.

## API-Schlüssel

Für Skripte und andere Programme, die mit deinem Archiv arbeiten, etwa ein Exportskript. Ein Schlüssel kann nur, was du kannst, beschränkt auf die **Bereiche**, die du wählst, und er kann ablaufen. Der Schlüssel wird **einmal** angezeigt, wenn du ihn erstellst: Kopiere ihn dann. Teile Schlüssel nie und schick sie nie per E-Mail.

Die meisten Leute brauchen nie einen. Die Helfer auf deinem NAS und deinen Computern bekommen beim Koppeln ihre eigenen Schlüssel; die erstellst du nicht hier.
