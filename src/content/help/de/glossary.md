---
title: "Glossar"
summary: "Die Begriffe von cf-dam und Speicherdiensten, einfach erklärt."
section: Getting started
order: 9
review: machine
source: 1f33cb2730fb
---

**KI-Prüfung.** Ein KI-Modell sieht sich jedes Foto an und schreibt Vorschläge: Alternativtext, eine Bildunterschrift, eine Beschreibung, Stichwörter. Du entscheidest, was bleibt. Siehe [KI-Prüfung](/help/ai-review).

**Alternativtext.** Eine kurze Beschreibung eines Fotos für Menschen, die es nicht sehen können. Screenreader lesen sie vor; Galerien und Websites nutzen sie.

**Archiv.** Eine sichere, günstige Kopie deiner Originale, meist in Glacier Deep Archive, für den Tag, an dem etwas schiefgeht. Siehe [Archivieren](/help/archiving).

**AWS (Amazon Web Services).** Amazons Geschäft mit der Vermietung von Rechnern und Speicher, getrennt vom Onlineshop. S3 gehört dazu. Siehe [Amazon S3 verbinden](/help/amazon-s3).

**Bucket.** Ein benannter Speicherbereich in S3, R2 oder ähnlichen Diensten: wie ein Laufwerk in der Cloud. cf-dam kann Originale in einem oder mehreren davon aufbewahren.

**Katalog.** Alles, was cf-dam über deine Fotos weiß: Details, Stichwörter, Bildunterschriften, Bewertungen, Alben, Vorschaubilder und Vorschauen. Nicht die Originale selbst.

**Kundengalerie.** Ein Album, das du mit einem Kunden teilst: über einen privaten Link mit eigenem Passwort, Ablaufdatum und Downloads, oder mit einem Kunden, der sich in ein Konto anmeldet, das nur seine Galerien zeigt. Siehe [Kundengalerien](/help/client-galleries).

**Docker.** Ein üblicher Weg, kleine Programme wie den Helfer von cf-dam auf einem NAS laufen zu lassen. Jedes Programm läuft in seinem eigenen abgeschotteten „Container“.

**EXIF.** Angaben, die deine Kamera in jedes Foto schreibt: Kamera, Objektiv, Belichtung, Datum und Uhrzeit und, falls vorhanden, die GPS-Position.

**Glacier und Deep Archive.** Amazons günstigste Speicherklassen, für Dateien, die du selten öffnest. Ein Terabyte im Deep Archive kostet etwa einen Dollar im Monat, aber eine Datei zurückzuholen dauert bis zu 12 oder 48 Stunden. Siehe [Archivieren](/help/archiving).

**HEIC.** Das Fotoformat von iPhones. cf-dam liest es.

**Helfer (Agent).** Ein kleines Programm auf deinem NAS oder Computer, das Fotos dort erfasst, wo sie liegen, ohne sie zu verschieben. Siehe [Computer und NAS](/help/computers-and-nas).

**IPTC.** Der Standardsatz an Feldern zur Beschreibung von Fotos, den Agenturen, Zeitungen, Lightroom und Photo Mechanic nutzen: Überschrift, Urheber, Credit-Zeile, Copyright, Nutzungsbedingungen, Kontaktdaten, Ort, Auftrag.

**Stichwort.** Ein Wort oder Ausdruck dafür, was auf einem Foto ist oder worum es geht. cf-dam ordnet sie in einem Baum, etwa *Orte › Norwegen › Bergen*. Siehe [Stichwörter](/help/keywords).

**Doppelgänger.** Eine Kopie eines Fotos, die nicht dieselbe Datei ist: verkleinert, neu gespeichert, noch einmal exportiert. Siehe [Duplikate](/help/duplicates).

**Metadaten.** Informationen über ein Foto statt des Bildes selbst: EXIF, IPTC, Stichwörter, Bildunterschriften, Bewertungen.

**NAS (Netzwerkspeicher).** Ein Gerät mit Festplatten in deinem Netzwerk, etwa von Synology oder QNAP, das Dateien für alle Computer im Haus oder Studio bereithält.

**Neuronen.** So misst (und berechnet) Cloudflare Workers AI. 10.000 pro Tag sind kostenlos, danach kosten 1.000 0,011 $. Die Prüfung von 1.000 Fotos braucht ungefähr 46.000.

**Original.** Die vollständige Datei aus deiner Kamera oder deinem Bildbearbeitungsprogramm. cf-dam verändert sie nie.

**Kopplungscode.** Die acht Buchstaben, die ein neuer Helfer anzeigt. Gibst du sie in cf-dam ein, wird der Helfer mit deinem Archiv verbunden.

**Passkey.** Eine Anmeldung mit Fingerabdruck, Gesicht, Geräte-PIN oder Passwortmanager statt mit einem Passwort. Sicherer, und du musst dir nichts merken. Siehe [Dein Konto und die Anmeldung](/help/account-security).

**Vorschau.** Eine große Kopie eines Fotos (bis zu 2.048 Pixel breit), die cf-dam zum Ansehen, Teilen und für die KI-Prüfung erstellt und in deinem Cloudflare-Konto aufbewahrt.

**R2.** Cloudflares eigener Speicher. Die Vorschaubilder und Vorschauen von cf-dam liegen immer dort, und Originale können es auch.

**RAW.** Die unbearbeitete Datei, die manche Kameras speichern (etwa `.CR3`, `.NEF`, `.ARW`). Sie enthält die meisten Details; du entwickelst sie in Lightroom oder Ähnlichem.

**Wiederherstellen.** Eine Kopie eines archivierten Originals aus Glacier zurückholen, damit man sie herunterladen kann. Außerdem: den Katalog aus einer Sicherung zurückholen. Siehe [Sicherungen](/help/backups).

**S3.** Amazons Speicherdienst und die „Sprache“, die auch viele andere Speicherdienste sprechen (R2, Backblaze B2, Wasabi).

**Speicherklasse.** Wie eine Datei in S3 aufbewahrt wird: Standard (sofort, am teuersten), Infrequent Access, Glacier, Deep Archive (am langsamsten, am günstigsten).

**Vorschaubild.** Eine kleine Kopie eines Fotos (480 Pixel breit) für das Raster der Bibliothek.

**Zwei-Faktor-Anmeldung.** Ein zweiter Schritt nach deinem Passwort: ein Code aus einer App auf deinem Telefon. Siehe [Dein Konto und die Anmeldung](/help/account-security).

**Wasserzeichen.** Dein Name oder Logo über Fotos in Kundengalerien und in heruntergeladenen Kopien. Originale bekommen nie ein Wasserzeichen.

**XMP.** Ein Standard, um Metadaten (Stichwörter, Bildunterschriften, Bewertungen, Markierungen) in einem Foto oder in einer kleinen Datei daneben (einer „Begleitdatei“) zu speichern, die Lightroom, Capture One und Bridge lesen.
