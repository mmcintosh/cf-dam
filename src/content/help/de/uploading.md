---
title: "Fotos hochladen"
summary: "Fotos und Videos von deinem Computer hinzufügen, wohin sie kommen und was danach mit ihnen passiert."
section: Your photos
order: 3
review: machine
source: 6589f6acdb5e
---

Hochladen eignet sich für ein paar Hundert Fotos auf einmal oder für Fotos von einem Computer, der sie nicht behalten soll. Für ein ganzes NAS oder eine große Sammlung auf einem Computer ist ein Helfer besser: Er erfasst die Fotos dort, wo sie sind, ohne die Originale hochzuladen (siehe [Computer und NAS](/help/computers-and-nas)).

## So lädst du hoch

1. Drücke in der **Bibliothek** auf **Hochladen**.
2. Wähle, wohin die Originale kommen: **Originale speichern in** (die Voreinstellung ist schon gewählt) und die **Speicherklasse**. Siehe [Wo die Originale liegen](/help/storage).
3. Zieh Fotos, RAW-Dateien und Videos auf das Feld oder klicke darauf, um sie auszuwählen. Du kannst einen **ganzen Ordner** hineinziehen: cf-dam öffnet ihn und die Ordner darin und lädt alles hoch, was darin liegt (versteckte Dateien werden übersprungen).

Jede Datei zeigt ihren Fortschritt: **Suche nach Duplikaten…**, dann einen Prozentwert, dann **Hochgeladen**. Große Dateien werden in Teilen hochgeladen, bis zu 5 TB pro Datei, und du kannst währenddessen weiterarbeiten. **Abbrechen** stoppt eine Datei. Wenn alles fertig ist, drücke **Bibliothek aktualisieren**, um sie zu sehen.

## Duplikate werden übersprungen

Vor dem Hochladen prüft cf-dam, ob das Archiv genau diese Datei schon hat, egal ob sie früher hochgeladen oder von einem Helfer erfasst wurde. Wenn ja, zeigt die Datei **Schon im Archiv** mit einem Link zum Foto und wird nicht noch einmal hochgeladen. (Dateien über 512 MB überspringen diese Prüfung, weil sie das Lesen der ganzen Datei bedeuten würde.)

Kopien, die nicht identisch sind, etwa ein kleinerer Export oder ein neu gespeichertes JPEG, werden hochgeladen und tauchen dann unter [Duplikate](/help/duplicates) als Doppelgänger auf.

## Was danach passiert

Wenige Sekunden nach jedem Hochladen erledigt cf-dam Folgendes:

1. Es liest die Angaben: Kamera, Objektiv, Belichtung, Datum, GPS und alle Stichwörter, Titel, Bildunterschriften, Credits und Copyrights, die schon in der Datei stehen;
2. es erstellt ein Vorschaubild und eine Vorschau;
3. es ermittelt Stadt und Land aus der GPS-Position;
4. es macht das Foto durchsuchbar;
5. es reiht das Foto für die [KI-Prüfung](/help/ai-review) ein, wenn die für neue Fotos eingeschaltet ist.

## Dateiarten

| Art | Hinweise |
| --- | --- |
| JPEG, PNG, WebP, AVIF, GIF, HEIC (iPhone) | Vorschauen erstellt cf-dam. |
| Dateien über etwa 20 MB | Dein Browser erstellt die Vorschau vor dem Hochladen, weil Cloudflares Bilddienst nur Dateien bis 20 MB liest. |
| RAW (Kameradateien), TIFF | Die Vorschauen kommen aus dem kleinen JPEG, das die meisten Kameras in die Datei legen. Gibt es keins, hat das Foto keine Vorschau, bis ein Helfer eine erstellt. |
| Video | Dein Browser erstellt ein Vorschaubild, wenn er das Video abspielen kann. |

## Direkt ins Tiefenarchiv

Wenn du direkt in **Glacier** oder **Deep Archive** hochlädst, erstellt dein Browser zuerst die Vorschau, weil das Original danach stundenlang nicht gelesen werden kann. Um das Original später zu bekommen, braucht es eine Wiederherstellung: siehe [Originale archivieren und wiederherstellen](/help/archiving).
