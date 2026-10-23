---
title: "Originale archivieren und wiederherstellen"
summary: "Eine sichere, günstige Kopie jedes Originals in Amazon Glacier aufbewahren und ein Foto zurückholen, wenn du es brauchst."
section: Where photos are kept
order: 3
review: machine
source: f92f0190ae52
---

Ein **Archiv** ist eine Kopie deiner Originale an einem sicheren, günstigen Ort, für den Tag, an dem eine Festplatte ausfällt oder ein NAS gestohlen wird. Amazons **Glacier Deep Archive** bewahrt ein Terabyte für etwa einen Dollar im Monat auf. Der Haken: Eine Datei zurückzuholen dauert Stunden. Es ist also zum Aufbewahren gedacht, nicht für den Alltag.

cf-dam kann auf zwei Arten archivieren, je nachdem, wo deine Originale liegen.

## Originale auf einem NAS oder Computer

Der Helfer auf deinem NAS oder Computer kann jedes Original selbst in einen S3-Bucket kopieren.

1. Verbinde zuerst auf der Seite **Speicher** einen Bucket (siehe [Amazon S3 verbinden](/help/amazon-s3)).
2. Such auf **Computer und NAS** den Helfer und drück unter **Originale archivieren** auf **Archivierung einrichten**.
3. Wähle den **Bucket** und die **Speicherklasse**: **Deep Archive** für die günstigste Aufbewahrung.
4. Wähle die Stunden, in denen er arbeiten darf (**Von** und **Bis**, nach der Uhr des Helfers), zum Beispiel nachts, und ein Geschwindigkeitslimit in Mbit/s, damit er deine Internetverbindung nicht auslastet. Dieselbe Uhrzeit in beiden heißt jederzeit; 0 Mbit/s heißt ohne Limit.
5. Speichere.

Der Helfer kopiert jedes Original, sobald es einen Tag lang unverändert ist (damit er keine Datei archiviert, die du noch bearbeitest), und prüft jeden Teil beim Eintreffen. Er **liest** deine Dateien nur: Er ändert oder löscht sie nie. Das Feld zeigt, was schon gesendet ist, was noch fehlt und ungefähr wie lange es dauert.

Mit **Ändern** passt du die Einstellungen jederzeit an, mit **Archivierung beenden** hörst du auf. Was schon im Bucket liegt, bleibt dort.

## Originale, die schon in einem Bucket liegen

Bei einem Foto, dessen Original in S3 liegt, zeigt seine Seite, wo es ist, und mit **Verschieben** bringst du es in eine andere Speicherklasse, zum Beispiel von Standard nach Deep Archive.

> Amazon berechnet eine **Mindestdauer**: 30 Tage für die IA-Klassen, 90 Tage für Glacier und 180 Tage für Deep Archive. Verschiebst du ein Foto früher wieder heraus, kostet es trotzdem den ganzen Zeitraum. Verschieb also nur Fotos, bei denen du sicher bist, dass du sie in Ruhe lässt.

## Ein Foto aus Glacier zurückholen

Eine Datei in Glacier oder Deep Archive lässt sich nicht sofort öffnen. Amazon muss erst eine Kopie zurückholen:

1. Öffne die Seite des Fotos. Wähle beim Speicher des Originals, wie schnell es gehen soll:

   | Geschwindigkeit | Glacier Flexible Retrieval | Deep Archive | Kosten |
   | --- | --- | --- | --- |
   | **Beschleunigt** | Minuten | nicht verfügbar | am höchsten |
   | **Standard** | 3 bis 5 Stunden | innerhalb von 12 Stunden | etwa 20 $ pro TB aus Deep Archive |
   | **Bulk** | 5 bis 12 Stunden | innerhalb von 48 Stunden | am niedrigsten: etwa 2,50 $ pro TB aus Deep Archive |

2. Wähle, wie lange es **Wiederhergestellt halten für** gelten soll (danach verschwindet die Kopie, und das Original bleibt archiviert).
3. Drück **Wiederherstellung anfordern**.

cf-dam verfolgt die Wiederherstellung selbst und zeigt, wann sie fertig ist; **Status prüfen** fragt sofort bei Amazon nach. Nach der Wiederherstellung lässt sich das Foto wie gewohnt herunterladen, bis die Kopie abläuft.

Deine Vorschaubilder und Vorschauen liegen nie in Glacier: Du kannst jedes Foto immer sehen, durchsuchen, verschlagworten und teilen, auch wenn sein Original im tiefsten Archiv liegt.
