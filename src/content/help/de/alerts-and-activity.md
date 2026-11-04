---
title: "Warnungen und Aktivität"
summary: "Probleme, um die sich jemand kümmern muss, und das Protokoll, wer was getan hat."
section: People and security
order: 3
review: machine
source: 8c052952756a
---

Beide Seiten sind für Administratoren.

## Warnungen

cf-dam prüft sich alle fünf Minuten selbst und gibt eine **Warnung** aus, wenn sich ein Mensch um etwas kümmern muss. Das Menü zeigt neben **Warnungen**, wie viele offen sind.

| Warnung | Was sie meistens bedeutet | Was du tust |
| --- | --- | --- |
| Ein Helfer ist offline | Ein NAS oder Computer ist aus, schläft oder hat seine Netzwerkverbindung verloren. | Prüfe, ob er an ist. Starte den Helfer (oder seinen Container) nach einer Netzwerkänderung neu. |
| Ein Helfer darf einen Ordner nicht lesen | Der Computer oder das NAS lässt ihn nicht hinein: Auf einem Mac wurde ihm der Zugriff auf Bilder, ein Laufwerk oder ein Netzwerkvolume verweigert. | Auf einem Mac: **Systemeinstellungen → Datenschutz & Sicherheit → Dateien und Ordner** (oder **Festplattenvollzugriff**), `node` erlauben. Auf einem NAS: die Berechtigungen des Ordners. |
| Probleme beim Archivieren | Ein Helfer konnte keine Originale in den Archiv-Bucket kopieren. | Die Warnung sagt, warum: oft liegt es an den Berechtigungen des Buckets. |
| Probleme mit dem Speicher | Originale lagen nicht dort, wo cf-dam sie erwartet hat, oder ein Bucket lässt sich nicht lesen. | Öffne **Speicher → Prüfungen**. |
| Sicherungen schlagen fehl oder sind überfällig | Die tägliche Sicherung des Katalogs wurde nicht fertig. | Siehe [Sicherungen](/help/backups); prüfe den Sicherungs-Bucket. |
| Vorschauen hängen | Einige Vorschaubilder oder Vorschauen konnten nicht erstellt werden. | **Speicher → Vorschauen → Die hängenden erneut versuchen**. |
| Fotos konnten nicht verarbeitet werden oder warten | Eine Datei ließ sich nicht lesen (beschädigt oder eine Art, die cf-dam nicht öffnen kann), oder Fotos warten seit über einem Tag, weil die Hintergrundarbeit nicht durchkommt. | **Zu …** zeigt die nicht verarbeiteten in der Bibliothek: lade sie erneut hoch oder entferne sie. Zu wartenden Fotos siehe *Hintergrundarbeit* unten. |
| KI-Prüfung aufgegeben | Das KI-Modell ist bei einigen Fotos dreimal gescheitert; die Warnung nennt seinen letzten Fehler. | **Zu …** zeigt sie in der Bibliothek. Ist die Ursache behoben, wähle sie aus und nimm **KI… → Erneut analysieren**. |
| Archivierung stockt | Originale warten darauf, ins Archiv kopiert zu werden, und seit über einem Tag wurde keins kopiert. | Prüfe die Speicherverbindung des Archivs: öffne sie unter **Speicher** und drück **Testen**. |
| AWS hat die Rolle abgelehnt | Amazon hat die schlüssellose Rolle von cf-dam für eine Speicherverbindung abgelehnt: Die Rolle oder ihre Vertrauensrichtlinie wurde geändert oder entfernt. | **Zu …** öffnet die Verbindung. Bring die Rolle in AWS in Ordnung (siehe [Amazon S3](/help/amazon-s3)) und drück dann **Testen**. |
| Hintergrundarbeit schlägt fehl oder steht | Die Arbeit, die cf-dam jede Minute erledigt (Verarbeitung, KI, Prüfungen, Sicherungen), hat einen Fehler oder ist nicht gelaufen. | Die Warnung sagt, welcher Teil. Steht alles still, such im Cloudflare-Dashboard in den Logs des Workers nach Fehlern oder stelle neu bereit. |

Jede Warnung sagt, seit wann sie besteht, und **Zu …** führt dich zur Seite, auf der du das Problem behebst. Ist es behoben, schließt sich die Warnung von selbst und wandert nach **In den letzten zwei Wochen behoben**.

**Ausblenden** nimmt eine Warnung aus der Zählung, während du dich darum kümmerst (oder wenn du entschieden hast, dass sie unwichtig ist). Kommt sie nach der Behebung wieder, zählt sie erneut; **Wieder mitzählen** macht das Ausblenden rückgängig.

### Per E-Mail

Wenn dieses Archiv E-Mails senden kann (siehe [E-Mail](/help/email)), bekommen die Personen, die Warnungen sehen, auch eine E-Mail, wenn eine neue aufkommt: höchstens eine am Tag für jede Art von Problem, mit einer Liste dessen, was offen ist, und einem Link hierher. Für einen Desktop-Helfer, der still wird (ein Laptop im Ruhezustand), gibt es keine E-Mail, ebenso wenig für Probleme mit der E-Mail selbst. Schalte diese E-Mails unter **Konto → E-Mails bei Problemen** ab oder wieder ein.

## Aktivität

**Aktivität** ist das Protokoll, wer sich angemeldet und wer was geändert hat, das Neueste zuerst: Anmeldungen (auch fehlgeschlagene), hinzugefügte oder geänderte Personen, Rollen, Änderungen an der Zwei-Faktor-Anmeldung, Speicherverbindungen, Importe, Löschungen, geteilte Galerien, eingereihte KI-Prüfungen, geänderte Einstellungen und Hintergrundarbeit wie Sicherungen und Prüfungen.

Grenze sie nach **Art** des Ereignisses oder nach **Person** ein. Hier schaust du zuerst nach, wenn sich etwas geändert hat und du nicht weißt, wie.
