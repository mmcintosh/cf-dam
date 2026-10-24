---
title: "Aufträge"
summary: "Jede Arbeit für einen Kunden von der Buchung bis zur Lieferung verfolgen: Shooting-Termine, Phasen, Alben, Galerien und was Aufmerksamkeit braucht."
section: Sharing
order: 4
review: machine
source: 3c44ab054383
---

Ein **Auftrag** ist eine Arbeit für einen Kunden: eine Hochzeit, ein Porträtshooting, ein Produktshooting. Er hält die Shooting-Termine fest, den Ort, wie weit die Arbeit ist, und seine Alben. Seine Galerien sind die Galerien seiner Alben. **Aufträge** steht im Menü unter **Kunden**; wie Kunden sehen das nur **Administratoren**.

## Einen Auftrag anlegen

- **Aus der Bibliothek**, der übliche Weg, nach dem Shooting: Filtere die Bibliothek auf die Fotos des Shootings (ein Album, ein Monat, ein Ordner, ein Stichwort) und drücke dann **Neuer Auftrag aus diesen Fotos**. Das Formular übernimmt die Shooting-Termine aus den Fotos und bietet an, die Fotos ins erste Album des Auftrags zu legen.
- **Von der Seite eines Kunden**: **Neuer Auftrag** dort wählt den Kunden schon für dich aus.
- **Unter Aufträge**: **Neuer Auftrag**. Im selben Formular kannst du einen neuen Kunden anlegen: Wähle **+ Neuer Kunde** und gib den Namen ein.

Gib ihm einen Titel für dein Team (*Hochzeit Hansen*) und, wenn du magst, einen Namen unter **Name für den Kunden** (*Eure Hochzeit*), die Art des Auftrags, das Datum des Shootings (und den letzten Tag, wenn es mehrere Tage dauert), den Ort und wann die Lieferung fällig ist.

## Phasen

Ein Auftrag durchläuft **Gebucht**, **Fotografiert**, **Bearbeitung**, **Auswahl durch Kunden**, **Finale Bearbeitung**, **Geliefert** und **Abgeschlossen**, oder er ist **Abgesagt**. Drücke auf der Seite des Auftrags auf eine Phase, um ihn dorthin zu verschieben, vorwärts oder zurück. **Auswahl durch Kunden** und **Finale Bearbeitung** (gestrichelt) lassen sich überspringen: Ein Porträt- oder Produktshooting hat oft keine Auswahl durch den Kunden.

Zwei Wechsel passieren von selbst, und der Verlauf vermerkt sie:

- **Gebucht → Fotografiert**, wenn Fotos, die an den Shooting-Terminen aufgenommen wurden, im Archiv ankommen.
- **→ Geliefert**, wenn du aus einem Album des Auftrags eine Galerie erstellst und dabei **Endgültige Lieferung** anhakst (siehe [Kundengalerien](/help/client-galleries)).

Alles andere liegt bei dir. **Abgeschlossen** ist für den Moment, wenn die Arbeit erledigt und bezahlt ist.

## Alben und Galerien

Auf der Seite des Auftrags listet **Alben** seine Alben mit ihren Fotos und Galerien:

- **Album hinzufügen** nimmt ein vorhandenes Album in den Auftrag auf. Ein Album gehört höchstens zu einem Auftrag; ein Foto kann in mehreren sein.
- **Neues Album mit den Fotos vom Shooting-Datum** erstellt eines aus allen Fotos, die an diesen Tagen aufgenommen wurden.
- **Galerie erstellen** öffnet das Album mit dem Galerieformular, bereit zum Ausfüllen.
- **Aus dem Auftrag nehmen** lässt das Album und seine Galerien, wie sie sind.

Ein Album, das zu einem Auftrag gehört, zeigt oben auf seiner Seite einen Link zum Auftrag.

## Originale

**Originale** auf der Seite des Auftrags zeigt, wo die Originaldateien seiner Fotos liegen:

- wie viele **jetzt lesbar** sind (aus dem eigenen Speicher des Archivs, von einem Computer oder NAS oder als wiederhergestellte Kopie);
- wie viele **wiederhergestellt werden müssen**: Sie liegen nur in einem kalten Archiv (Glacier oder Deep Archive), daher kann sie niemand herunterladen, bis sie zurückgeholt sind;
- wie viele **nur auf einem Computer oder NAS** liegen: Du kannst sie öffnen, aber eine Kundengalerie kann sie nicht als Originale anbieten;
- wie viele eine **kalte Sicherung** haben, also eine Kopie in Glacier oder Deep Archive. Solange die eigene Kopie des Archivs bleibt, macht eine kalte Sicherung ein Foto nicht unlesbar.

Die Liste unter **Aufträge** zeigt dasselbe in Kurzform: *Lesbar* oder *n wiederherzustellen*, und *kalte Sicherung*, wenn jedes Foto eine hat.

### Einen Auftrag wiederherstellen

Vor einer Nachbestellung von Abzügen zum Beispiel drückst du **n Originale wiederherstellen…**. Wähle die **Geschwindigkeit** (*Bulk*: am günstigsten, bis zu 48 Stunden; *Standard*: schneller, bis zu 12 Stunden) und wie viele Tage die Kopien bleiben sollen, dann **Kosten anzeigen**: das Holen aus dem Archiv, das Behalten der Kopien und was es kostet, wenn Kunden alle einmal herunterladen (oft der größte Teil). Dann bestätige. Die Seite zeigt, wie weit die Wiederherstellung ist und bis wann die Kopien bereitstehen. Die Originale bleiben im Archiv; die wiederhergestellten Kopien verschwinden nach den gewählten Tagen.

Wiederherstellen braucht die Berechtigung, Speicherklassen zu verwalten (Administratorrechte schließen sie ein).

Wenn eine Galerie Originale anbietet und einige Originale des Albums archiviert sind oder nur auf einem NAS liegen, weist das Galerieformular darauf hin, bevor du den Link erstellst.

## Archivieren nach der Lieferung

Wenn **Gelieferte Aufträge archivieren** eingeschaltet ist (auf der Seite **Speicher**: Wähle die S3-Verbindung, **Deep Archive** oder **Glacier Flexible** und wie viele Tage nach der Lieferung), bekommt jedes Original in den Alben eines gelieferten Auftrags eine Kopie in dieser kalten Klasse, sobald die Tage vorbei sind. Die Kopie im eigenen Speicher von cf-dam bleibt, also öffnet sich nichts langsamer: Die kalte Kopie ist eine Sicherung, deren Aufbewahrung sehr wenig kostet.

- Bevor du es einschaltest, zeigt **Was würde jetzt archiviert?**, wie viele Aufträge, Originale und GB auf einmal kopiert würden (jeder Auftrag, der schon lange genug geliefert ist, zählt mit), was das Aufbewahren im Monat kostet und was das Hochladen einmalig kostet.
- Jeder Teil einer Kopie wird beim Ankommen geprüft, und am Ende wird die Größe der Kopie verglichen. Eine unterbrochene Kopie macht dort weiter, wo sie stehen geblieben ist.
- Wenn du einen Auftrag erneut lieferst, etwa nachdem du ihn zurück auf **Bearbeitung** gesetzt hast, beginnen seine Tage von vorn.
- **Warm halten** auf der Seite eines Auftrags sorgt dafür, dass er nie automatisch archiviert wird (Nachbestellungen, Alben in Arbeit).
- **Jetzt archivieren** kopiert einen Auftrag sofort, in der Klasse, die du wählst (braucht die Berechtigung, Speicherverbindungen zu verwalten).
- Originale, die nur auf einem Computer oder NAS liegen, archiviert dessen Helfer, wenn dieser Ordner nach S3 archiviert (**Computer und NAS**); sonst zeigt der Auftrag, wie viele außen vor bleiben.
- Originale, die nach drei Versuchen nicht kopiert werden konnten, erscheinen als Warnung.

Unter **Originale** auf der Seite des Auftrags zeigt **Kalte Sicherung**, wie es steht: wann er archiviert wird, wie weit eine Kopie ist, wann er archiviert wurde oder was im Weg ist.

## Was Aufmerksamkeit braucht

Oben unter **Aufträge** listet **Braucht Aufmerksamkeit**:

- eine Lieferung, die in den nächsten 7 Tagen fällig oder schon überfällig ist;
- ein Shooting vor mehr als 3 Tagen, von dem noch keine Fotos da sind;
- eine Galerie eines Auftrags, die in den nächsten 7 Tagen schließt;
- eine Auswahlgalerie ohne Favoriten nach 14 Tagen.

**Laufend** zeigt offene Aufträge nach Phase, das nächste Shooting zuerst; **Geliefert und abgeschlossen** und **Alle** zeigen den Rest. Such nach Titel, Ort oder Kunde; Akzente spielen keine Rolle.

## Einen Auftrag löschen

**Auftrag löschen** unten auf seiner Seite (zweimal drücken) entfernt nur den Auftrag: Alben und Galerien bleiben. Wenn du einen Kunden löschst (siehe [Kunden](/help/clients)), werden auch seine Aufträge entfernt.
