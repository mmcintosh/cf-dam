---
title: "Was Kunden erhalten"
summary: "Was in den Dateien steckt, die Kunden aus einer Galerie herunterladen oder kaufen, was sie auf der Seite lesen können, und was Sie vor dem Senden eines Links prüfen sollten."
section: Sharing
order: 6
review: machine
source: f6588c6151b7
---

Eine Galerie zeigt Ihre Fotos, aber eine heruntergeladene Datei kann mehr enthalten als das Bild. Diese Seite listet auf, was Kunden erhalten, damit nichts mitgeht, was Sie privat halten wollten.

## Auf der Galerieseite

- **Titel, Bildunterschriften und Alternativtexte** sieht jeder, der den Link öffnet. Eine Bildunterschrift wie „Lily, 4, mit Oma“ nennt Personen. Prüfen Sie Bildunterschriften also, bevor Sie ein Album teilen.
- **Dateinamen** werden nur mit **Dateinamen anzeigen** gezeigt.
- **Personen, die Sie in cf-dam benannt haben,** werden nie gezeigt, ebenso wenig Stichwörter, Bewertungen, Orte auf der Karte oder Notizen.

## Dateinamen

Ist **Dateinamen anzeigen** aus, trägt nichts, was ein Kunde erhält, den echten Dateinamen. Downloads heißen nach der Galerie und dem Platz des Fotos darin, zum Beispiel `hochzeit-schmidt-042.jpg`. Bestellungen und Stripe-Belege nennen es **Foto 42**. Ist es an, behalten Dateien ihren echten Namen.

## Downloads Klein und Groß

Die Downloads Klein und Groß sind JPEGs, die cf-dam aus dem Foto erstellt, mit Ihren Bearbeitungen (Zuschnitt und Drehen) und dem Wasserzeichen, wenn die Galerie eines hat.

## Originale

Ein heruntergeladenes Original ist **die Datei genau so, wie sie hochgeladen wurde**. Dazu gehört:

- **Alles, was Ihre Bildbearbeitung hineingeschrieben hat:** Lightroom kann zum Beispiel Namen von Personen, Stichwörter, Bildunterschriften, Bewertungen und Ihre Kontaktdaten hineinschreiben.
- **Die Angaben der Kamera:** Manche Kameras und Telefone fügen den GPS-Standort, den Namen des Kamerabesitzers und ihre eigenen Namen aus der Gesichtserkennung hinzu.
- **Keine Bearbeitungen aus cf-dam.** Wenn Sie hier jemanden weggeschnitten haben, ist die Person im Original noch da.

Bezahlte Downloads in **Volle Größe** sind ebenfalls Originale und werden nur für JPEG- und PNG-Fotos ohne Bearbeitung in cf-dam verkauft.

Bevor Sie Originale anbieten, prüfen Sie, was Ihr Export enthält. In Lightroom kann die Export-Einstellung **Metadaten** nur Copyright und Kontaktdaten aufnehmen und Angaben zu Personen und Ort entfernen.

Originale kommen immer von cf-dam selbst. Auch wenn sie auf Amazon S3 liegen, bekommt der Kunde nie einen Link zu Ihrem Bucket.

> **Als Nächstes:** cf-dam wird beim Herunterladen durch Kunden Namen von Personen, Stichwörter, Bildunterschriften und den Standort aus JPEG- und PNG-Originalen entfernen und Kameraangaben und Ihr Copyright behalten. Jede Galerie bekommt einen Schalter, um Originale genau wie gespeichert zu senden.

## Andere Dateitypen

RAW-, TIFF-, HEIC-, WebP-, AVIF- und GIF-Fotos sowie Videos werden immer wie gespeichert gesendet. Handyfotos (HEIC) und Videos enthalten oft den GPS-Standort.

## Siehe auch

- [Kundengalerien](/help/client-galleries)
- [Fotos verkaufen](/help/selling)
- [Personen auf Fotos](/help/people-in-photos)
