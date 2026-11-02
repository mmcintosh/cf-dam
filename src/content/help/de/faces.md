---
title: "Gesichter finden"
summary: "cf-dam die Gesichter auf deinen Fotos finden lassen, damit du Personen per Klick benennst, und was dabei gespeichert wird."
section: Your photos
order: 11
review: machine
source: 8e435f8bf949
---

**Gesichter finden** zeigt auf der Seite eines Fotos unter **Personen** ein kleines Bild jedes gefundenen Gesichts. Klick eines an und gib ein, wer es ist: Das Foto wird mit der Person markiert, als hättest du den Namen von Hand hinzugefügt. Das spart Tipparbeit bei Fotos mit mehreren Personen, und so bekommt die Seite einer Person ein Bild ihres Gesichts.

Es ist **Finden, nicht Erkennen**. cf-dam ermittelt nie, wer jemand ist, und vergleicht nie ein Gesicht mit einem anderen. Jedes Gesicht benennst du selbst.

## Was gespeichert wird

Für jedes Gesicht: ein Rahmen (wo das Gesicht auf dem Foto ist) und wie sicher sich der Detektor war. Sonst nichts: keine Gesichtsmerkmale, kein „Gesichtsabdruck“, nichts, was für sich allein jemanden erkennbar machen könnte. Der Detektor (BlazeFace von Google) ermittelt auch, wo Augen, Nase und Mund sind; cf-dam verwirft das, bevor etwas gespeichert wird.

Gesichter werden auf deinen eigenen Geräten gefunden, von deinem Helfer (dem Programm auf deinem NAS oder Computer, das deine Fotos katalogisiert). Fotos und Gesichter werden dafür nie an andere gesendet. **Kunden sehen Gesichter nie**: nicht in Galerien, nicht in Downloads, nicht in Dateien.

## Einschalten

Lies unter **Einrichtung → KI-Prüfung → Gesichter finden**, was es bedeutet (siehe [Gesichter und das Recht](/help/faces-and-the-law)), hak **Ich habe das gelesen** an und drück **„Gesichter finden“ einschalten**. Dafür brauchst du die Berechtigung, Einstellungen zu ändern (standardmäßig Administratoren). Danach:

- sieht sich dein Helfer jedes neue Foto an, während er die Vorschau macht, und arbeitet ältere Fotos im Hintergrund ab, einige Hundert pro Minute;
- werden über die Website hochgeladene Fotos noch nicht angesehen (das kommt später, über die Seite eines Albums).

Dein Helfer muss aktuell sein: Ein älterer arbeitet weiter wie bisher, ohne Gesichter.

## Gesichter benennen

Klick auf der Seite eines Fotos ein Gesicht an:

- gib einen Namen ein (bereits benannte Personen werden angeboten) und drück **Benennen**;
- **Niemand zum Benennen** für Passanten, ein Gesicht auf einem Plakat oder eine Statue: Es wird beiseitegelegt und nicht wieder angeboten (**Zeigen** holt beiseitegelegte Gesichter zurück);
- **Namen entfernen** nimmt den Namen von diesem Gesicht; hat kein anderes Gesicht auf dem Foto diesen Namen, wird die Person auch vom Foto genommen.

Nimmst du unter **Personen** jemanden von einem Foto, verschwindet der Name auch von seinem Gesicht dort. Beim Zusammenführen zweier Personen wandern ihre Gesichter mit; beim Löschen einer Person werden ihre Gesichter beiseitegelegt, damit sie nicht erneut zum Benennen angeboten werden.

Ein benanntes Gesicht ändert sofort, was das Paar in einer Galerie finden kann, wenn die Galerie diese Person aufführt (siehe [Personen in einer Kundengalerie](/help/people-in-galleries)).

## Wie gut es ist

Es findet die meisten Gesichter bis etwa 3 % der Fotobreite: die hinteren Reihen einer Gruppe von etwa zwanzig Personen. Oft übersieht es teilweise verdeckte Gesichter (hinter einem anderen Kopf, einer Hand oder einem Handy) oder deutlich zur Seite gedrehte, und ab und zu umrahmt es etwas, das kein Gesicht ist, etwa ein gemustertes Kleid. Wen es übersieht, kannst du wie immer von Hand auf dem Foto benennen.

Das Finden von Gesichtern ändert nie die **Personen**-Anzahl eines Fotos; die Seite zeigt beides.

## Pausieren und entfernen

**Pausieren** stoppt jedes Finden sofort; alles bisher Gefundene bleibt, und du kannst weiter Gesichter benennen. Wieder eingeschaltet, geht es dort weiter, wo es aufgehört hat.

**Alle Gesichtsrahmen entfernen …** löscht, während pausiert ist, jedes vom Detektor gefundene Gesicht, benannt oder nicht. Die Namen bleiben als gewöhnliche Markierungen an den Fotos. Das läuft im Hintergrund, einige Tausend pro Minute.

## Wenn es fehlt

Eine Installation kann ganz ohne Gesichter finden eingerichtet sein. Dann sagt **Gesichter finden**, dass es nicht zu dieser Installation gehört, und nirgends erscheint etwas zu Gesichtern.
