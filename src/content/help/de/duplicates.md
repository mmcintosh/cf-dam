---
title: "Duplikate"
summary: "Identische Dateien und Doppelgänger finden und die beste Fassung behalten."
section: Your photos
order: 6
review: machine
source: 7fde0a7267ff
---

In Archiven sammeln sich Kopien: dasselbe Foto zweimal hochgeladen, ein Export neben seinem Original, ein neu gespeichertes JPEG, derselbe Ordner auf zwei Laufwerken. **Duplikate** findet sie und schlägt vor, welche Fassung du behalten solltest.

## Zwei Arten

- **Identische Dateien** sind Byte für Byte dieselbe Datei, egal woher sie kommen: zum Beispiel ein Upload und die Kopie eines Helfers auf dem NAS.
- **Doppelgänger** sind verschiedene Dateien desselben Bildes: verkleinert, neu gespeichert, in anderer Qualität exportiert, leicht bearbeitet. cf-dam findet sie über einen „Fingerabdruck“ der hellen und dunklen Bereiche jedes Bildes und erwischt so Kopien, die ein Dateivergleich übersieht. Auch zwei Fotos, die kurz nacheinander aufgenommen wurden, können sich ähneln; deshalb prüfst du Doppelgänger selbst.

Fotos von schlichten Motiven (ein leerer Himmel, Nebel, ein schwarzes Bild) haben sehr wenig im Fingerabdruck. Sie werden deshalb nur gepaart, wenn Fingerabdruck und Pixelmaße **exakt** gleich sind.

Identische Dateien lassen sich gar nicht erst zweimal hochladen: Der Upload meldet **Schon im Archiv** (siehe [Fotos hochladen](/help/uploading)).

## Welche du behältst

Jede Gruppe zeigt jede Kopie mit Größe in Pixeln, Dateigröße, Dateityp, Datum und Kamera und markiert eine als **Vorgeschlagen**, mit Begründung. cf-dam bevorzugt, in dieser Reihenfolge:

1. **Mehr Pixel**: das größere Bild.
2. **Das RAW-Original**, dann eine verlustfreie Datei (TIFF, PNG), vor einem JPEG.
3. Bei gleicher Größe die **weniger komprimierte** Datei: „Gleiche Größe, aber weniger komprimiert (707 KB gegenüber 664 KB)“.
4. **Deine Auswahl**, dann die **höher bewertete**.
5. Sonst die, die zuerst hinzugekommen ist.

Die Begründung wird angezeigt, damit du widersprechen kannst: Wähle einfach eine andere Kopie, bevor du den Knopf drückst.

## Eine behalten

Wähle die Kopie, die bleiben soll, und drücke **Ausgewählte behalten, … entfernen**. Stichwörter, Alben, Bewertung und Auswahl der anderen gehen auf die behaltene über, und die anderen werden aus dem Katalog entfernt.

> **Ein Duplikat zu entfernen, löscht nie eine Datei.** Es nimmt nur diese Kopie aus dem Katalog von cf-dam. Die Originaldateien bleiben, wo sie sind, auf deinem NAS, Computer oder im Speicher, und du kannst sie aufräumen, wenn du willst.

## Keine Duplikate

Für Doppelgänger, die eigentlich keine Kopien sind (etwa zwei Bilder einer Serie):

- **Keine Duplikate** verwirft die ganze Gruppe;
- **Kein Duplikat** unter einem Foto nimmt nur dieses aus der Gruppe.

Verworfene Paare werden nicht noch einmal vorgeschlagen.
