---
title: "Ordinateurs et NAS"
summary: "Le petit assistant qui catalogue les photos de votre NAS ou de votre ordinateur sans les déplacer, et comment l’installer."
section: Computers and NAS
order: 1
review: machine
source: 2bbdf56551b0
---

Beaucoup de photographes gardent leurs photos sur un **NAS** (un disque réseau au studio ou à la maison) ou sur les disques d’un ordinateur. cf-dam peut les cataloguer **là où elles sont** : un petit programme assistant tourne à côté des photos, lit chacune d’elles et envoie à cf-dam ses détails, une vignette et un aperçu. Les originaux ne bougent jamais et ne sont jamais modifiés.

Vous pouvez avoir plusieurs assistants, par exemple un sur le NAS et un sur un ordinateur portable.

## Ce que fait l’assistant

- Il lit les détails de chaque photo (appareil, date, lieu, mots-clés, légendes) et crée une vignette et un aperçu.
- Il les envoie à cf-dam, pour que les photos apparaissent dans la photothèque et puissent être recherchées, taguées et partagées.
- Il repasse régulièrement, et repère les photos nouvelles, modifiées, renommées et supprimées. Une photo dont le fichier disparaît est marquée **manquante**, jamais supprimée du catalogue.
- Il peut aussi copier les originaux vers un bucket d’archivage (voir [Archiver et restaurer les originaux](/help/archiving)).
- Lors d’un gros premier passage, il envoie d’abord toutes les vignettes, pour que la photothèque se remplisse vite, puis les aperçus plus grands.

Il ne fait que **lire** vos dossiers de photos. Les dossiers propres à Synology (`@eaDir`, `#recycle`), le bric-à-brac de Mac et Windows et les caches de Lightroom sont toujours ignorés.

## Ajouter un assistant

Sur **Ordinateurs et NAS**, appuyez sur **Ajouter un ordinateur ou un NAS**, puis choisissez où il tourne. La page affiche les étapes exactes pour chaque cas ; en voici les grandes lignes.

### Sur un NAS

L’assistant tourne dans un **conteneur Docker**, une façon standard de faire tourner de petits programmes sur un NAS. Choisissez votre NAS sous **Quel NAS ?** et cf-dam affiche les étapes correspondantes, avec un fichier de configuration tout prêt (un « fichier compose ») à copier :

| NAS | Où va le fichier de configuration |
| --- | --- |
| Synology | Container Manager → Project → Create |
| QNAP | Container Station → Applications → Create |
| UGREEN | L’app Docker : créez un projet |
| TerraMaster | Docker Manager : créez un projet |
| Asustor | Portainer (depuis App Central) → Stacks → Add stack |
| TrueNAS (24.10 ou plus récent) | Apps → Discover Apps → ⋮ → Install via YAML |
| Unraid | Docker → Add Container (cf-dam liste chaque champ), ou le plugin Compose Manager |
| OpenMediaVault | Services → Compose → Files → Add (avec omv-extras) |
| Un autre ordinateur Linux | Enregistrez le fichier et lancez `docker compose up -d` |

**Collez le fichier de configuration tel quel : il n’y a rien à y modifier.** Il permet à l’assistant de *lire* le disque principal de votre NAS (`:ro` signifie lecture seule : il ne peut jamais rien y modifier ni supprimer), et vous choisissez ensuite, dans une liste dans cf-dam, les dossiers photo qu’il catalogue. L’assistant a besoin d’environ 1 Go de mémoire et fonctionne sur les NAS Intel, AMD et ARM.

Des photos aussi sur un second disque ? Le fichier de configuration contient un commentaire qui montre la ligne à ajouter pour lui.

Les NAS **WD My Cloud et Buffalo** ne peuvent pas faire tourner Docker. Faites plutôt tourner l’assistant sur un Mac ou un PC qui voit les dossiers partagés du NAS.

### Sur un Mac ou un PC Windows

1. Installez **Node.js 24** (l’installateur LTS) depuis [nodejs.org](https://nodejs.org), s’il n’est pas déjà là.
2. Décompressez l’assistant et ouvrez un terminal (Mac : **Terminal** ; Windows : **PowerShell**) dans son dossier.
3. Lancez la commande affichée par la page. Elle contient déjà l’adresse de vos archives.
4. Sur un Mac, quand macOS demande si `node` peut lire votre dossier Images, vos disques ou vos volumes réseau, **autorisez-le**.

L’assistant démarre tout seul à chaque ouverture de session sur l’ordinateur, sous votre nom, et voit donc vos disques et vos partages.

## L’appairage

Chaque nouvel assistant affiche un **code de huit lettres** : sur sa propre page (`http://your-nas:8790` ou `http://localhost:8790`) et dans son journal.

1. Tapez le code dans **Saisissez le code** sur la page Ordinateurs et NAS.
2. Donnez un nom à l’assistant, comme « NAS du studio », et appuyez sur **Connecter**.

L’assistant reçoit une clé qui ne peut qu’envoyer des photos à ces archives : il ne peut rien lire d’autre ni modifier les photos de qui que ce soit. Si vous réinstallez un assistant (par exemple après avoir réinstallé le NAS), choisissez **À nouveau comme « … »** pour qu’il retrouve son entrée, ses dossiers et ses photos au lieu de tout renvoyer une deuxième fois.

## Choisir les dossiers

Sous l’assistant, dans **Dossiers**, choisissez un dossier dans la liste (elle affiche les dossiers partagés de votre NAS et les dossiers qu’ils contiennent, tels que le NAS les nomme, comme `/volume1/photo/2024`) et appuyez sur **Indexer ce dossier**. Le premier passage démarre aussitôt. Chaque dossier indique quand il a été analysé pour la dernière fois. Les dossiers sur des disques amovibles le signalent, et apparaissent hors ligne tant que le disque est débranché.

**Retirer** arrête l’indexation d’un dossier. Ses photos restent dans cf-dam, marquées manquantes.

## Garder un œil dessus

La carte de chaque assistant indique s’il est **En ligne**, en **Analyse en cours** ou quand il a été **Vu pour la dernière fois** ; combien de photos il a ; combien sont manquantes ; et ce qu’il fait en ce moment. **Analyser maintenant** lance un passage, et **Mettre en pause** l’arrête jusqu’à ce que vous appuyiez sur **Reprendre**.

Si un assistant ne s’est pas manifesté depuis un moment, une alerte apparaît pour les administrateurs (voir [Alertes et activité](/help/alerts-and-activity)). Les causes habituelles : le NAS ou l’ordinateur est éteint, en veille, ou il y a eu un changement de réseau. Redémarrer l’assistant (ou son conteneur) règle la plupart des cas.

**Déconnecter** retire la clé d’un assistant. Ses photos restent dans cf-dam.
