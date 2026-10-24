---
title: "Wo die Originale liegen"
summary: "Der Unterschied zwischen dem Katalog und den Originalen, und die Orte, an denen cf-dam Originale aufbewahren kann."
section: Where photos are kept
order: 1
review: machine
source: 95bfc3f3803f
---

cf-dam bewahrt zwei verschiedene Dinge an zwei verschiedenen Orten auf.

- **Der Katalog:** alles, was cf-dam über jedes Foto weiß (Details, Stichwörter, Bildunterschriften, Bewertungen), dazu ein kleines **Vorschaubild** und eine größere **Vorschau**. Diese liegen immer in deinem Cloudflare-Konto, damit die Bibliothek schnell bleibt, egal was mit den Originalen passiert.
- **Die Originale:** die vollständigen Dateien aus deiner Kamera. Sie können an jedem der unten genannten Orte liegen, und verschiedene Fotos an verschiedenen Orten.

## Wo Originale liegen können

| Wo | Gut für | Hinweise |
| --- | --- | --- |
| **Cloudflare R2** (eingebaut) | Den Einstieg; Fotos, die du oft öffnest | Schon eingerichtet. Herunterladen kostet nichts. |
| **Amazon S3** | Große Archive; sehr günstiger Langzeitspeicher | Braucht ein Amazon-Web-Services-Konto. Siehe [Amazon S3 verbinden](/help/amazon-s3). |
| **Backblaze B2, Wasabi, R2 (zweiter Bucket)** | Günstigere Alternativen zu Amazon | Verbindung mit Zugriffsschlüsseln, wie bei S3. |
| **Dein NAS oder Computer** | Fotos, die du schon zu Hause oder im Studio aufbewahrst | Nichts wird verschoben: Ein Helfer erfasst sie dort, wo sie liegen. Siehe [Computer und NAS](/help/computers-and-nas). |

Die Seite **Speicher** listet jeden Ort auf, den du verbunden hast, eine Zeile pro Ort: welche Art es ist, wie viele Originale dort liegen und wie viel Platz sie belegen, und was ihn nutzt (**Neue Uploads**, **Auftragsarchiv**, **Katalogsicherungen**, das Archiv eines Helfers). Einer davon ist der **Standard**: Dorthin gehen Uploads, wenn du im Upload-Fenster keinen anderen wählst. Drück auf eine Zeile, um die eigene Seite dieser Verbindung zu öffnen.

## Einen Bucket verbinden

Drück auf **Speicher** auf **Verbindung hinzufügen** und wähle den Anbieter. cf-dam füllt aus, was es kann. Dann gibst du an:

- **Name:** alles, woran du ihn wiedererkennst, etwa „Studioarchiv“.
- **Bucket:** der Name des Buckets, genau so, wie der Anbieter ihn anzeigt.
- **Region:** wo der Bucket liegt, etwa `us-east-1`.
- **Ordner im Bucket** (optional): hält die Dateien von cf-dam in einem Ordner zusammen, etwa `cf-dam`.
- **Anmeldung:** Zugriffsschlüssel oder, bei Amazon, die schlüssellose Variante (siehe [Amazon S3 verbinden](/help/amazon-s3)).
- **Speicherklassen dieses Buckets** und die **Standardklasse für Uploads**.

Drück **Hinzufügen und testen**. cf-dam öffnet die Seite der neuen Verbindung und testet sie: Es schreibt eine kleine Testdatei (im Ordner, falls du einen angegeben hast), liest sie zurück und löscht sie, und sagt, ob das geklappt hat oder warum nicht. Bei einer schlüssellosen Amazon-Verbindung öffnet es stattdessen die AWS-Schritte, denn bevor die erledigt sind, funktioniert nichts.

## Die Seite einer Verbindung

- **Was hier liegt:** wie viele Originale hier eine Kopie haben und wie viel Platz sie belegen, nach Art des Speichers (schnell, mittel, kalt, Tiefenarchiv), mit Links, die diese Fotos in der Bibliothek zeigen. Außerdem die Kopien aus der Auftragsarchivierung, die noch ausstehen, und die Katalogsicherungen, die hier liegen. Gezählt wird aus dem Katalog, nicht durch einen Blick in den Bucket.
- **Wofür sie genutzt wird:** neue Uploads (wenn sie der Standard ist), das Archivieren gelieferter Aufträge, die tägliche Katalogsicherung, das Archiv eines NAS- oder Mac-Helfers, jeweils mit dem Ort, an dem du das änderst.
- **Hochladen aus dem Browser:** siehe unten.
- **Dateien erfassen, die schon in diesem Bucket liegen:** siehe „Fotos, die schon in einem Bucket liegen“ unten.
- **AWS-Einrichtung für diese schlüssellose Verbindung** (nur bei Amazon): die Schritte und Richtlinien, die du in AWS anlegst. Siehe [Amazon S3 verbinden](/help/amazon-s3).
- **Angaben:** Drück **Bearbeiten**, um sie umzubenennen, die angebotenen Speicherklassen und die Standardklasse zu ändern oder ihre Rolle (schlüssellos) oder ihre Zugriffsschlüssel zu ändern. Ein neues Geheimnis ersetzt das alte; lässt du das Feld leer, bleibt es erhalten. Neue Zugangsdaten werden beim Speichern sofort getestet. **Bucket, Region, Endpunkt und Ordner** lassen sich nur ändern, solange dort nichts liegt und nichts die Verbindung nutzt, denn die Originale sind unter diesen Namen gespeichert: Für einen anderen Bucket füge eine neue Verbindung hinzu.
- **Entfernen:** vergisst die Verbindung (der Bucket und seine Dateien bleiben, wie sie sind). Sie lässt sich nicht entfernen, solange dort etwas liegt oder etwas sie nutzt; die Seite listet auf, was.

## Hochladen aus dem Browser und die CORS-Regel

Wenn du zu einer S3-Verbindung hochlädst (sie ist der Standard, oder du hast sie im Upload-Fenster gewählt), schickt dein Browser die Fotos **direkt an den Bucket**, nicht über cf-dam. Ein Bucket lehnt das ab, außer er lässt diese Seite zu, über eine Einstellung am Bucket, die **CORS-Regel** heißt.

1. Drück auf der Seite der Verbindung unter **Hochladen aus dem Browser** neben der Regel auf **Kopieren**.
2. In der AWS-Konsole: **S3**, der Bucket, **Permissions**, **Cross-origin resource sharing (CORS)**, **Edit**. Füge sie ein und speichere. (Andere Dienste haben dieselbe Einstellung am Bucket.)
3. Drück zurück in cf-dam auf **Hochladen aus diesem Browser testen**. Es schickt ein Byte so, wie es ein Upload tut, und sagt, ob der Bucket es angenommen hat, und wenn nicht, warum.

Die Regel brauchst du nur zum Hochladen aus dem Browser. Die eigenen Kopien von cf-dam (Aufträge archivieren, Sicherungen, Verschieben zwischen Klassen, Wiederherstellungen) und der NAS- oder Mac-Helfer erreichen den Bucket auch ohne sie.

## Fotos, die schon in einem Bucket liegen

Liegen im Bucket schon Fotos, öffne die Seite der Verbindung und drück unter **Dateien erfassen, die schon in diesem Bucket liegen** auf **Importieren**. Jede Datei wird dort durchsuchbar, wo sie liegt: Nichts wird kopiert oder verschoben. Du kannst bei einem Ordner anfangen, etwa `photos/2019/`. Vorschauen entstehen im Hintergrund. Dateien im Tiefenspeicher werden mit Name, Größe und Klasse aufgeführt, bis du sie wiederherstellst.

## Speicherklassen, kurz erklärt

Amazon bietet günstigere „Klassen“ für Dateien, die du selten öffnest. Je günstiger der Speicher, desto länger dauert es und desto mehr kostet es, eine Datei zurückzuholen:

| Klasse | Ungefähr pro Terabyte und Monat | Eine Datei zurückholen |
| --- | --- | --- |
| Standard | 23 $ | Sofort |
| Standard-IA (seltener Zugriff) | 12,50 $ | Sofort, kleine Gebühr pro GB |
| Glacier Flexible Retrieval | 3,60 $ | 3 bis 12 Stunden |
| Glacier Deep Archive | 1 $ | Innerhalb von 12 bis 48 Stunden |

Die Preise sind Amazons veröffentlichte US-Preise zum Zeitpunkt dieses Textes; deine findest du auf [Amazons S3-Preisseite](https://aws.amazon.com/s3/pricing/). Amazon berechnet außerdem eine **Mindestdauer**: 30 Tage für die IA-Klassen, 90 für Glacier und 180 für Deep Archive, auch wenn du die Datei früher löschst oder verschiebst.

Ein einzelnes Foto kannst du auf seiner Seite zwischen Klassen verschieben (**Verschieben**) und mit **Wiederherstellung anfordern** aus Glacier zurückholen. Siehe [Archivieren und wiederherstellen](/help/archiving).

## Die anderen Teile der Seite Speicher

- **Prüfungen:** cf-dam stellt regelmäßig sicher, dass die Originale, die es kennt, noch dort sind, wo es sie vermutet. Probleme erscheinen hier und als Warnung.
- **Gelieferte Aufträge archivieren:** eine kalte Kopie der Originale jedes gelieferten Auftrags in S3, einige Tage nach der Lieferung. Siehe [Aufträge](/help/jobs).
- **Cloudflare Images in diesem Monat:** wie viele Bilder Cloudflare in diesem Monat für Vorschauen, Vorschaubilder, KI und Wasserzeichen erstellt hat, was Cloudflare über das Kontingent deines Tarifs hinaus berechnet, mit einer Warnung, wenn die Zahl über dem Wert liegt, den du festlegst.
- **Vorschauen:** prüft, ob jedes Vorschaubild und jede Vorschau wirklich da ist, und erstellt fehlende neu. Siehe [Sicherungen und den Katalog wiederherstellen](/help/backups).
- **Katalogsicherungen:** tägliche Kopien des Katalogs selbst. Siehe [Sicherungen und den Katalog wiederherstellen](/help/backups).
