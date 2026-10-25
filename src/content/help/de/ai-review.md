---
title: "KI-Prüfung"
summary: "Wie ein KI-Modell deine Fotos beschreibt, was das kostet und wie du bestimmst, was davon bleibt."
section: Your photos
order: 5
review: machine
source: bae228056176
---

Die KI-Prüfung sieht sich jedes Foto an und schreibt Vorschläge: **Alternativtext**, eine **Bildunterschrift**, eine längere Beschreibung dessen, **was sie gesehen hat**, **Text im Bild** (Schilder, Dokumente), vorgeschlagene **Stichwörter** und eine Notiz zur Qualität. So wird ein großes Archiv auf eine Weise durchsuchbar, für die niemand von Hand Zeit hat, und genau das liest die [Suche nach Bedeutung](/help/search).

Sie läuft mit **Workers AI in deinem eigenen Cloudflare-Konto**. Deine Fotos gehen an keine andere Firma, und das Modell lernt nicht aus ihnen.

## Du bestimmst

Nichts, was die KI schreibt, ersetzt deine eigenen Worte, außer du willst es. Auf der [Seite eines Fotos](/help/photo-page) unter **KI-Vorschläge**:

- **Übernehmen** kopiert einen Vorschlag in ein leeres Feld; **Meins ersetzen** überschreibt, was dort steht.
- Vorgeschlagene Stichwörter sind sofort durchsuchbar und als die der KI markiert. **✓** übernimmt eines als dein eigenes, **×** verwirft es, **Alle übernehmen** übernimmt alle.
- **Analysieren** lässt sie noch einmal laufen (zum Beispiel, nachdem du die Angaben unten geändert hast).

Um Vorschläge für viele Fotos auf einmal zu übernehmen, wähle sie in der Bibliothek aus und nutze **KI…**: **KI-Bildunterschriften nutzen, wo leer**, **KI-Alternativtext nutzen, wo leer**, **KI-Schlagwörter übernehmen** oder **Erneut analysieren**.

## Die Seite KI-Prüfung

**KI-Prüfung** (unter **Einrichtung** im Menü) zeigt, wie viele Fotos **analysiert**, **in der Warteschlange**, **nie analysiert** und **fehlgeschlagen** sind, und was es für dein Archiv pro 1.000 Fotos kostet.

### Einstellungen (Administratoren)

- **KI-Prüfung:** an oder aus. Aus stoppt jede Analyse; bereits gemachte Vorschläge bleiben.
- **Neue Uploads analysieren:** Jedes neue Foto wird eingereiht, sobald es eine Vorschau hat. Fotos von einem Helfer werden nach dem ersten Durchsuchen eines Ordners eingereiht.
- **Modell:** das KI-Modell, das genutzt wird. Die Seite sagt, wofür jedes gut ist.
- **Über deine Arbeit:** ein Satz über dich, den das Modell mit jedem Foto bekommt, damit seine Stichwörter zu deinem Archiv passen, zum Beispiel *„Hochzeits- und Landschaftsfotograf im Westen Norwegens“* oder *„Vogelfotografie, vor allem Feuchtgebiete in Florida“*.

### Alles auf einmal analysieren

Wenn einige Fotos noch nie analysiert wurden, sagt **Den Bestand analysieren**, wie viele es sind und ungefähr, was es kosten wird. Drücke **… einreihen**, um zu starten. Die Fotos werden im Hintergrund abgearbeitet, mehrere auf einmal; du kannst weiterarbeiten. Ein Foto, bei dem es schiefgeht, wird noch ein paarmal versucht und dann mit dem Grund als **fehlgeschlagen** markiert.

## Personen auf Fotos

Neben der KI-Prüfung sieht sich **Jev** von TypeSafe jedes neue Foto nach Personen an und zählt sie, für den Filter **Personen** in der Bibliothek. Es ist schneller und günstiger als die KI-Prüfung (etwa 9 Cent pro 1.000 Fotos) und fand in einem Test mit 805 Fotos Personen auf 87, wo die KI-Prüfung 47 fand, meist kleine Gestalten im Hintergrund. Es schreibt keinen Text.

- **Was gesendet wird:** eine Kopie jedes Fotos mit 1.024 px, ohne Dateinamen, Kameradaten und Ort, geht an TypeSafe (api.typesafe.ai). TypeSafe sagt, damit nicht zu trainieren.
- **Ältere Fotos:** Das Feld **Personen auf Fotos** auf dieser Seite zählt, was gefunden wurde (jede Zahl öffnet diese Fotos in der Bibliothek), und **N noch nicht angesehene Fotos ansehen** erledigt den Rest.
- **Schalter:** Ist **Nach Personen suchen** aus, wird nichts mehr an TypeSafe gesendet (vorhandene Antworten bleiben, und der Filter funktioniert weiter); ist **Bei neuen Fotos gleich beim Eintreffen** aus, warten neue Fotos auf die Schaltfläche.
- **Falsche Antworten:** auf der Seite des Fotos korrigieren, oder viele auf einmal in der Bibliothek (auswählen, dann **Personen…**). Jev ändert nie eine von Hand gesetzte Antwort, und **Zurück zu Jevs Antwort** macht sie rückgängig.
- **Fotos, die nicht angesehen werden konnten,** stehen mit dem Grund in einer Liste: zu klein, von TypeSafe abgelehnt oder dreimal fehlgeschlagen (mit **Erneut versuchen**).
- Videos werden nicht angesehen, ebenso wenig Fotos unter 280 Pixel an einer Seite.

## Was es kostet

Workers AI wird in **Neuronen** abgerechnet. Cloudflare schenkt dir 10.000 Neuronen pro Tag, danach kosten 1.000 0,011 $.

Ein echtes Beispiel: Die Prüfung von 662 Vogelfotos hat etwa 30.000 Neuronen gebraucht, etwa **33 Cent**, oder etwa 22 Cent nach dem kostenlosen Tageskontingent. Das sind ungefähr 50 Cent pro 1.000 Fotos. Die Seite KI-Prüfung zeigt die Zahl für dein eigenes Archiv.

## Wie gut ist sie?

Sie ist gut darin, zu erkennen, was auf einem Bild ist (*ein Graureiher, der zwischen Schilf im flachen Wasser steht*), und Text zu lesen. Sie weiß nicht, wer Menschen sind, kennt keine Ortsnamen, die sie nicht lesen kann, und nicht die Geschichte hinter einem Foto. Das ergänzt du. Sieh ihre Stichwörter als ersten Durchgang und ihren Alternativtext als Entwurf.
