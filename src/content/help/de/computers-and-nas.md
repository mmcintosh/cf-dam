---
title: "Computer und NAS"
summary: "Der kleine Helfer, der Fotos auf deinem NAS oder Computer katalogisiert, ohne sie zu verschieben, und wie du ihn einrichtest."
section: Computers and NAS
order: 1
review: machine
source: 2bbdf56551b0
---

Viele Fotografen bewahren ihre Fotos auf einem **NAS** auf (einem Netzwerklaufwerk im Studio oder zu Hause) oder auf den Laufwerken eines Computers. cf-dam kann sie **dort katalogisieren, wo sie sind**: Ein kleines Hilfsprogramm läuft neben den Fotos, liest jedes einzelne und schickt cf-dam seine Details, ein Vorschaubild und eine Vorschau. Die Originale werden nie verschoben und nie verändert.

Du kannst mehrere Helfer haben, zum Beispiel einen auf dem NAS und einen auf einem Laptop.

## Was der Helfer macht

- Er liest die Details jedes Fotos (Kamera, Datum, Ort, Stichwörter, Bildunterschriften) und erstellt ein Vorschaubild und eine Vorschau.
- Er schickt sie an cf-dam, damit die Fotos in der Bibliothek erscheinen und sich durchsuchen, verschlagworten und teilen lassen.
- Er scannt regelmäßig neu und erfasst neue, geänderte, umbenannte und gelöschte Fotos. Verschwindet die Datei eines Fotos, wird es als **fehlend** markiert, aber nie aus dem Katalog gelöscht.
- Auf Wunsch kopiert er Originale in einen Archiv-Bucket (siehe [Originale archivieren und wiederherstellen](/help/archiving)).
- Beim ersten großen Scan schickt er zuerst alle Vorschaubilder, damit sich die Bibliothek schnell füllt, und danach die größeren Vorschauen.

Er **liest** deine Fotoordner nur. Die eigenen Ordner von Synology (`@eaDir`, `#recycle`), Mac- und Windows-Kram und Lightroom-Caches werden immer übersprungen.

## Einen Helfer hinzufügen

Drücke auf **Computer und NAS** auf **Computer oder NAS hinzufügen** und wähle, wo er laufen soll. Die Seite zeigt dir für jeden Fall die genauen Schritte; hier ist der Überblick.

### Auf einem NAS

Der Helfer läuft als **Docker-Container**, ein übliches Verfahren, um kleine Programme auf einem NAS laufen zu lassen. Wähle dein NAS unter **Welches NAS?**, und cf-dam zeigt dir die Schritte dafür, mit einer fertigen Einrichtungsdatei (einer „Compose-Datei“) zum Kopieren:

| NAS | Wohin die Einrichtungsdatei kommt |
| --- | --- |
| Synology | Container Manager → Project → Create |
| QNAP | Container Station → Applications → Create |
| UGREEN | Die App Docker: ein Projekt anlegen |
| TerraMaster | Docker Manager: ein Projekt anlegen |
| Asustor | Portainer (aus App Central) → Stacks → Add stack |
| TrueNAS (24.10 oder neuer) | Apps → Discover Apps → ⋮ → Install via YAML |
| Unraid | Docker → Add Container (cf-dam nennt jedes Feld) oder das Plugin Compose Manager |
| OpenMediaVault | Services → Compose → Files → Add (mit omv-extras) |
| Ein anderer Linux-Computer | Datei speichern und `docker compose up -d` ausführen |

**Füge die Einrichtungsdatei unverändert ein: Es gibt nichts darin zu ändern.** Sie lässt den Helfer das Hauptlaufwerk deines NAS *lesen* (`:ro` heißt schreibgeschützt: Er kann dort nie etwas ändern oder löschen), und welche Fotoordner er katalogisiert, wählst du danach aus einer Liste in cf-dam. Der Helfer braucht etwa 1 GB Arbeitsspeicher und läuft auf NAS-Modellen mit Intel, AMD und ARM.

Fotos auch auf einem zweiten Laufwerk? In der Einrichtungsdatei zeigt ein Kommentar die eine Zeile, die du dafür hinzufügst.

NAS-Modelle von **WD My Cloud und Buffalo** können kein Docker ausführen. Lass den Helfer stattdessen auf einem Mac oder PC laufen, der die freigegebenen Ordner des NAS sieht.

### Auf einem Mac oder Windows-PC

1. Installiere **Node.js 24** (den LTS-Installer) von [nodejs.org](https://nodejs.org), falls es noch nicht da ist.
2. Entpacke den Helfer und öffne in seinem Ordner ein Terminal (Mac: **Terminal**; Windows: **PowerShell**).
3. Führe den Befehl aus, den die Seite zeigt. Er enthält schon die Adresse deines Archivs.
4. Wenn macOS auf dem Mac fragt, ob `node` deinen Bilder-Ordner, Laufwerke oder Netzwerkvolumes lesen darf, **erlaube es**.

Der Helfer startet von selbst, sobald du dich am Computer anmeldest, und zwar als du, damit er deine Laufwerke und Freigaben sieht.

## Koppeln

Jeder neue Helfer zeigt einen **Code aus acht Buchstaben**: auf seiner eigenen Seite (`http://your-nas:8790` oder `http://localhost:8790`) und in seinem Log.

1. Tippe den Code auf der Seite Computer und NAS in das Feld **Gib den Code ein**.
2. Gib dem Helfer einen Namen, etwa „Studio-NAS“, und drücke **Verbinden**.

Der Helfer bekommt einen Schlüssel, mit dem er nur Fotos an dieses Archiv schicken kann: Er kann nichts anderes lesen und niemandes Fotos ändern. Richtest du einen Helfer neu ein (etwa nach einer Neuinstallation des NAS), wähle **Wieder als „…“**, damit er seinen Eintrag, seine Ordner und Fotos zurückbekommt, statt alles doppelt zu schicken.

## Ordner auswählen

Wähle unter dem Helfer bei **Ordner** einen Ordner aus der Liste (sie zeigt die freigegebenen Ordner deines NAS und die Ordner darin, so wie das NAS sie benennt, etwa `/volume1/photo/2024`) und drücke **Diesen Ordner indizieren**. Der erste Scan startet sofort. Bei jedem Ordner steht, wann er zuletzt gescannt wurde. Ordner auf Wechsellaufwerken sind als solche gekennzeichnet und erscheinen offline, solange das Laufwerk nicht angeschlossen ist.

**Entfernen** beendet die Indizierung eines Ordners. Seine Fotos bleiben in cf-dam, als fehlend markiert.

## Im Blick behalten

Die Karte jedes Helfers zeigt, ob er **Online** ist, gerade **Scannt** oder wann er **Zuletzt gesehen** wurde; wie viele Fotos er hat; wie viele fehlen; und was er gerade tut. **Jetzt scannen** startet einen Scan, und **Pausieren** hält ihn an, bis du **Fortsetzen** drückst.

Hat sich ein Helfer eine Weile nicht gemeldet, erscheint eine Warnung für Administratoren (siehe [Warnungen und Aktivität](/help/alerts-and-activity)). Die üblichen Gründe: Das NAS oder der Computer ist aus, schläft, oder das Netzwerk hat sich geändert. Den Helfer (oder seinen Container) neu zu starten, behebt das meistens.

**Trennen** entfernt den Schlüssel eines Helfers. Seine Fotos bleiben in cf-dam.
