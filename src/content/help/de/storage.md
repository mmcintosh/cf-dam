---
title: "Wo die Originale liegen"
summary: "Der Unterschied zwischen dem Katalog und den Originalen, und die Orte, an denen cf-dam Originale aufbewahren kann."
section: Where photos are kept
order: 1
review: machine
source: 56c3bc77ccf9
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

Die Seite **Speicher** listet jeden Ort auf, den du verbunden hast. Einer davon ist der **Standard**: Dorthin gehen Uploads, wenn du im Upload-Fenster keinen anderen wählst.

## Einen Bucket verbinden

Drück auf **Speicher** auf **S3-Verbindung hinzufügen** und wähle den Anbieter. cf-dam füllt aus, was es kann. Dann gibst du an:

- **Name:** alles, woran du ihn wiedererkennst, etwa „Studioarchiv“.
- **Bucket:** der Name des Buckets, genau so, wie der Anbieter ihn anzeigt.
- **Region:** wo der Bucket liegt, etwa `us-east-1`.
- **Ordner im Bucket** (optional): hält die Dateien von cf-dam in einem Ordner zusammen, etwa `cf-dam`.
- **Anmeldung:** Zugriffsschlüssel oder, bei Amazon, die schlüssellose Variante (siehe [Amazon S3 verbinden](/help/amazon-s3)).
- **Speicherklassen dieses Buckets** und die **Standardklasse für Uploads**.

Drück **Hinzufügen und testen**. cf-dam schreibt eine kleine Testdatei, liest sie zurück und löscht sie. „Verbunden“ heißt, alles hat geklappt; alles andere kommt mit dem Grund.

> **Hochladen aus dem Browser in einen Bucket** braucht noch eine Einstellung am Bucket selbst, eine sogenannte CORS-Regel. Das Formular zeigt die genaue Regel zum Kopieren unter „Browser-Uploads gehen direkt in den Bucket“. Ohne sie scheitern Uploads in diesen Bucket mit einem Netzwerkfehler.

## Fotos, die schon in einem Bucket liegen

Liegen im Bucket schon Fotos, öffne unter der Verbindung **Dateien erfassen, die schon in diesem Bucket liegen** und drück **Importieren**. Jede Datei wird dort durchsuchbar, wo sie liegt: Nichts wird kopiert oder verschoben. Du kannst bei einem Ordner anfangen, etwa `photos/2019/`. Vorschauen entstehen im Hintergrund. Dateien im Tiefenspeicher werden mit Name, Größe und Klasse aufgeführt, bis du sie wiederherstellst.

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
- **Vorschauen:** prüft, ob jedes Vorschaubild und jede Vorschau wirklich da ist, und erstellt fehlende neu. Siehe [Sicherungen und den Katalog wiederherstellen](/help/backups).
- **Katalogsicherungen:** tägliche Kopien des Katalogs selbst. Siehe [Sicherungen und den Katalog wiederherstellen](/help/backups).
