---
title: "Was Kunden erhalten"
summary: "Was in den Dateien steckt, die Kunden aus einer Galerie herunterladen oder kaufen, was sie auf der Seite lesen können, und was du vor dem Senden eines Links prüfen solltest."
section: Sharing
order: 6
review: machine
source: b8678ddf83a1
---

Eine Galerie zeigt deine Fotos, aber eine heruntergeladene Datei kann mehr enthalten als das Bild. Diese Seite listet auf, was Kunden erhalten, damit nichts mitgeht, was du privat halten wolltest.

## Auf der Galerieseite

- **Titel, Bildunterschriften und Alternativtexte** sieht jeder, der den Link öffnet. Eine Bildunterschrift wie „Lily, 4, mit Oma“ nennt Personen. Prüf Bildunterschriften also, bevor du ein Album teilst.
- **Dateinamen** werden nur mit **Dateinamen anzeigen** gezeigt.
- **Personen, die du in cf-dam benannt hast,** werden nur dem eigenen Paar der Galerie gezeigt, unter den Namen, die du wählst, wenn du die Galerie so einstellst (siehe [Personen in einer Kundengalerie](/help/people-in-galleries)). Stichwörter, Bewertungen, Orte auf der Karte und Notizen werden nie gezeigt.

## Dateinamen

Ist **Dateinamen anzeigen** aus, trägt nichts, was ein Kunde erhält, den echten Dateinamen. Downloads heißen nach der Galerie und dem Platz des Fotos darin, zum Beispiel `hochzeit-schmidt-042.jpg`. Bestellungen und Stripe-Belege nennen es **Foto 42**. Ist es an, behalten Dateien ihren echten Namen.

## Downloads Klein und Groß

Die Downloads Klein und Groß sind JPEGs, die cf-dam aus dem Foto erstellt, mit deinen Bearbeitungen (Zuschnitt und Drehen) und dem Wasserzeichen, wenn die Galerie eines hat. Sie enthalten nichts aus der Originaldatei außer deinem **Urheber** und deinem **Copyright-Vermerk** aus den Rechte-Feldern des Fotos in cf-dam. Wenn du diese änderst, enthält der nächste Download die neuen.

## Originale

Ein heruntergeladenes Original ist die Datei, wie sie hochgeladen wurde, beim Senden **bereinigt**, wenn es ein JPEG oder PNG ist:

- **Entfernt:** Namen von Personen (auch Lightrooms Gesichtsbereiche), Bildunterschriften und Beschreibungen, Stichwörter, Bewertungen, Kommentare, der GPS-Standort, der Name des Kamerabesitzers, die privaten Notizen des Kameraherstellers (manche enthalten Namen aus der Gesichtserkennung) und Inhaltsnachweise (C2PA).
- **Behalten:** das Bild selbst, unverändert; Kameraeinstellungen und Datum; und dein **Urheber** und **Copyright-Vermerk** aus den Rechte-Feldern des Fotos in cf-dam.
- **HDR-Fotos von Handys**, die ein zweites Bild in der Datei verstecken, kommen als normales Bild an.
- **Keine Bearbeitungen aus cf-dam.** Wenn du hier jemanden weggeschnitten hast, ist die Person im Original noch da.

Kann eine Datei nicht sicher bereinigt werden, wird sie gar nicht gesendet: Der Kunde wird gebeten, sich an dich zu wenden, und die **Aktivität** zeigt, welche Galerie.

**Originale genau wie gespeichert senden** (in den Einstellungen der Galerie, unter Downloads) sendet Originale unverändert, mit allem, was deine Software und deine Kamera hineingeschrieben haben. Nutze das nur, wenn du geprüft hast, was dein Export enthält. In Lightroom kann die Export-Einstellung **Metadaten** nur Copyright und Kontaktdaten aufnehmen.

Bezahlte Downloads in **Volle Größe** sind ebenfalls Originale, genauso bereinigt, und werden nur für JPEG- und PNG-Fotos ohne Bearbeitung in cf-dam verkauft.

Originale kommen immer von cf-dam selbst. Auch wenn sie auf Amazon S3 liegen, bekommt der Kunde nie einen Link zu deinem Bucket.

## Andere Dateitypen

RAW-, TIFF-, HEIC-, WebP-, AVIF- und GIF-Fotos sowie Videos werden immer wie gespeichert gesendet, ohne Bereinigung, unabhängig von der Einstellung der Galerie. Handyfotos (HEIC) und Videos enthalten oft den GPS-Standort.

## Siehe auch

- [Kundengalerien](/help/client-galleries)
- [Fotos verkaufen](/help/selling)
- [Personen auf Fotos](/help/people-in-photos)
- [Personen in einer Kundengalerie](/help/people-in-galleries)
