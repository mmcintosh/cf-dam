---
title: "Fotos verkaufen"
summary: "Kunden digitale Dateien aus ihrer Galerie kaufen lassen: Stripe verbinden, Preislisten, Bestellungen, Erstattungen und wofür du verantwortlich bist."
section: Sharing
order: 5
review: machine
source: 43b5d0e7ac24
---

Kunden können digitale Dateien aus ihrer Galerie kaufen und mit Stripe bezahlen, über dein eigenes Stripe-Konto. Das Geld geht an dich; cf-dam nimmt keine Provision. Abzüge kommen später.

## Was du brauchst

- Ein **Stripe**-Konto (stripe.com). Probier zuerst alles im **Testmodus** von Stripe aus: Es fließt kein echtes Geld, und cf-dam zeigt **Testmodus**, solange du darin bist.
- Die Bereitschaft, als Verkäufer aufzutreten: Umsatzsteuer, Erstattungen und Belege sind deine Sache. Stripe kann die Steuer für dich berechnen und einziehen, aber anmelden und erklären musst du sie selbst.

## Stripe verbinden

Unter **Kundenarbeit → Bestellungen** führt dich der Abschnitt **Verkaufen** durch die Einrichtung (nur für Administratoren):

1. Erstelle in Stripe unter **Developers → API keys** einen **eingeschränkten Schlüssel**, der Checkout Sessions schreiben und Charges und Payment Intents lesen darf. Füge ihn in **Eingeschränkter Stripe-Schlüssel** ein.
2. Füge in Stripe unter **Developers → Webhooks** einen Endpoint mit der angezeigten Adresse hinzu, mit den daneben aufgeführten Events.
3. Kopiere das **Signing Secret** dieses Endpoints (es beginnt mit `whsec_`) in **Webhook Signing Secret**, drücke **Speichern** und dann **Prüfen**.

Schlüssel und Secret werden verschlüsselt gespeichert, nie wieder angezeigt und nicht in Katalog-Backups aufgenommen (gib sie nach dem Wiederherstellen in eine neue Installation erneut ein). Wähle unter **Du als Verkäufer** die **Währung** (sie lässt sich nicht mehr ändern, sobald Preise oder Bestellungen sie verwenden), unter **Firmenname** den Namen deines Unternehmens und unter **Bedingungen und Erstattungen** den Text, der auf der Bezahlseite von Stripe gezeigt wird.

## Preislisten

Eine Preisliste legt fest, was **Klein**, **Groß** und **Volle Größe** kosten und was **Alle Fotos** einer Galerie zusammen kosten. Lass einen Preis leer, um diese Größe nicht zu verkaufen. Leg so viele Listen an, wie du willst (für Hochzeiten, für Porträts …), und wähle dann für eine Galerie unter ihrem Link eine davon in **Verkauft mit**.

- Eine Größe, die die Galerie schon kostenlos hergibt, wird dort nicht verkauft.
- **Klein** und **Groß** entstehen aus dem Foto so, wie Kunden es sehen (mit deiner Drehung und deinem Zuschnitt), ohne Wasserzeichen.
- **Volle Größe** ist die Originaldatei. Sie wird daher nur für JPEG- und PNG-Originale angeboten, die du in cf-dam nicht gedreht oder zugeschnitten hast, und nur solange sich das Original gerade lesen lässt (nicht auf einem NAS, nicht im Deep-Archive-Speicher).

## Was Kunden sehen

In der Galerie hat die große Ansicht eines Fotos **Kaufen…** mit jeder Größe und ihrem Preis, und oben in der Galerie steht **Alle Fotos kaufen**, wenn dafür ein Preis festgelegt ist. Sie bezahlen auf der eigenen Seite von Stripe (Karte, Apple Pay, Google Pay, Link) und kommen danach auf ihre **Bestellseite** zurück: Ihre Adresse ist ihr Link zu den Dateien, auf jedem Gerät. Die Galerie zeigt außerdem, was sie gekauft haben, in dem Browser, mit dem sie gekauft haben.

## Bestellungen

**Kundenarbeit → Bestellungen** listet auf, was gekauft wurde: wann, von wem, aus welcher Galerie, die Summe und den Status.

- **Bezahlt**: Downloads funktionieren.
- **Zu prüfen**: Laut Stripe ist bezahlt, aber der Betrag passt nicht zur Bestellung. Nichts lässt sich herunterladen, bis du es dir angesehen hast; kläre es in Stripe (Erstattung oder den Kunden kontaktieren).
- **Erstattet** und **Angefochten**: Downloads werden gestoppt. Erstattungen machst du in deinem Stripe-Dashboard; die Bestellung hier zieht von selbst nach.
- **Wird bezahlt** und **Nicht bezahlt**: Ein Kunde hat die Bezahlseite verlassen; es wurde nichts abgebucht.

Wenn die Nachricht von Stripe zu einer Zahlung verloren geht, fragt cf-dam ein paar Minuten später selbst bei Stripe nach, damit eine bezahlte Bestellung nie hängen bleibt.
