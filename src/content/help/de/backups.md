---
title: "Sicherungen und den Katalog wiederherstellen"
summary: "Tägliche Kopien des Katalogs, wie du ihn in eine neue Installation zurückholst, und die Vorschauprüfung."
section: Where photos are kept
order: 4
review: machine
source: 144f5352577b
---

Die **Originale** deiner Fotos schützt der Ort, an dem du sie aufbewahrst (siehe [Originale archivieren und wiederherstellen](/help/archiving)). Den **Katalog** (Details, Stichwörter, Bildunterschriften und Bewertungen jedes Fotos, Alben, Galerien und Personen) schützen die **Katalogsicherungen**.

## Sicherungen einschalten

Auf **Speicher**, unter **Katalogsicherungen**:

1. **Sichern nach:** Wähle einen Bucket. Jeder verbundene Bucket geht; der eingebaute ist schon da.
2. **Täglich um:** die Uhrzeit (in UTC; cf-dam zeigt deine Ortszeit daneben).
3. **Aufbewahren:** wie viele Tage an Sicherungen behalten werden. Ältere werden gelöscht, aber nie die neueste.
4. Drück **Speichern**. Die erste Sicherung startet innerhalb einer Minute; **Jetzt sichern** startet jederzeit eine.

> **Nimm wenn möglich einen Bucket außerhalb von Cloudflare.** Der eingebaute Bucket liegt im selben Cloudflare-Konto wie der Katalog. Er schützt also vor Fehlern, aber nicht davor, das Konto zu verlieren. Ein Bucket in Amazon S3 (oder Backblaze B2, Wasabi…) schützt vor beidem.

### Was in einer Sicherung steckt und was nicht

| Drin | Nicht drin |
| --- | --- |
| Details, Stichwörter, Bildunterschriften, Bewertungen, Markierungen jedes Fotos | Die Originaldateien (sie liegen, wo du sie aufbewahrst) |
| Alben, Kundengalerien, ihre Besucher und Auswahlen | Passwörter, Passkeys, Codes für den zweiten Schritt, Anmeldungen |
| Personen und ihre Rollen | API-Schlüssel |
| Stichwörter, Vorlagen, Einstellungen, Verbindungen der Helfer | Vorschaubilder und Vorschauen (sie werden neu erstellt) |

Weil Passwörter nicht in einer Sicherung stecken, bekommt nach einer Wiederherstellung jeder ein neues Passwort.

## Den Katalog zurückholen

Eine Wiederherstellung geht in ein **neues, leeres** cf-dam (zum Beispiel nach einem Neuanfang in einem neuen Cloudflare-Konto):

1. Installiere cf-dam wie gewohnt. Wähle auf der ersten Seite **Aus einer Sicherung wiederherstellen** statt **Neues Archiv beginnen**.
2. Gib an, **wo die Sicherungen liegen**: im eingebauten Speicher dieser Installation, falls er sie noch hat, oder in einem S3-Bucket. Schlüssel mit Lesezugriff genügen; sie werden nur bis zum Ende der Wiederherstellung aufbewahrt.
3. **Wähle eine Sicherung** aus der Liste und lege den ersten Administrator an.

Die Wiederherstellung läuft im Hintergrund, und du kannst sie auf der Seite verfolgen. Bricht sie ab (etwa wegen eines Netzwerkproblems), **versuch es erneut**: Sie macht dort weiter, wo sie aufgehört hat.

Nach einer Wiederherstellung:

- **Helfer** auf deinen NAS und Computern koppeln sich neu und bekommen ihre eigenen Einträge zurück, damit sie nicht alles doppelt schicken. Siehe [Computer und NAS](/help/computers-and-nas).
- **Vorschaubilder und Vorschauen** werden neu erstellt: aus den Originalen, wo cf-dam sie lesen kann, und von den Helfern für Originale auf einem NAS.

### Was eine Wiederherstellung nicht zurückholen kann

Eine Sicherung kopiert eine Tabelle nach der anderen, bei einem großen Katalog über Stunden, während weitergearbeitet wird. Sie ist also kein einzelner Augenblick: Ein paar Zeilen können darin sein ohne das, wozu sie gehören, etwa ein Stichwort, das die KI-Prüfung vorgeschlagen hat, nachdem die Stichwörter schon kopiert waren, oder ein Foto, das ein Helfer in dieser Zeit gefunden hat. Eine Wiederherstellung lässt solche Zeilen aus oder leert einen Verweis auf etwas, das neuer ist als die Sicherung, und sagt am Ende, wie viele es waren:

- **Ausgelassene Zeilen**, Tabelle für Tabelle.
- **Geleerte Verweise**: Ein Album, dessen Auftrag neuer ist als die Sicherung, kommt zum Beispiel ohne seinen Auftrag zurück.
- **Fotos ohne Original**: Ihre Speicherorte waren neuer als die Sicherung. Ein Helfer, der eingerichtet wurde, während die Sicherung lief, fügt seine Dateien als neue Fotos wieder hinzu; die alten Kopien findest du dann mit dem Filter **Original nirgends vorhanden** in der Bibliothek und kannst sie löschen.
- **Eine unvollständige Sicherung**: Enthält eine Sicherung weniger Zeilen, als sie angibt, ist sie vielleicht beschädigt. Wenn etwas fehlt, stell eine ältere wieder her.

## Die Vorschauprüfung

Auf **Speicher**, unter **Vorschauen**, fragt **Jede Vorschau prüfen** den eingebauten Speicher nach jedem Vorschaubild und jeder Vorschau und erstellt fehlende neu. Bei einer Million Fotos dauert das einige Stunden und kostet deutlich unter einem Dollar. **Die hängenden erneut versuchen** probiert alle noch einmal, die sich nicht erstellen ließen.

Normalerweise brauchst du das nicht: cf-dam bemerkt eine fehlende Vorschau, sobald jemand sie zum ersten Mal öffnet. Es ist für die Zeit nach einer Wiederherstellung da, oder zur Beruhigung.

**Jede Vorschau neu erstellen** erstellt Vorschaubild und Vorschau jedes Fotos neu, so wie cf-dam sie jetzt erstellt: seit November 2026 etwas schärfer. Fotos, deren Originale cf-dam lesen kann, werden hier erstellt, einige auf einmal; jedes kostet zwei Cloudflare-Images-Transformationen. Fotos auf einem NAS oder Computer erstellt ihr Helfer kostenlos neu. Fotos, die sich gerade nicht gut erstellen lassen (ein Original nur im Archiv, eine über die Website hochgeladene RAW-Datei), behalten ihre bisherigen. Bis eine neue Vorschau da ist, wird die alte gezeigt. Danach werden die Fotos erneut nach Gesichtern durchsucht, und die Namen, die du vergeben hast, bleiben erhalten.
