---
title: "Importer des photos"
summary: "Ajouter des photos et des vidéos depuis votre ordinateur, où elles vont et ce qu’il leur arrive ensuite."
section: Your photos
order: 3
review: machine
source: 6589f6acdb5e
---

L’importation convient pour quelques centaines de photos à la fois, ou pour des photos d’un ordinateur qui ne les gardera pas. Pour tout un NAS ou une grande collection sur un ordinateur, mieux vaut un assistant : il catalogue les photos là où elles sont, sans importer les originaux (voir [Ordinateurs et NAS](/help/computers-and-nas)).

## Comment importer

1. Dans la **Photothèque**, appuyez sur **Importer**.
2. Choisissez où vont les originaux : **Stocker les originaux dans** (la valeur par défaut est choisie pour vous) et la **Classe de stockage**. Voir [Où sont gardés les originaux](/help/storage).
3. Faites glisser photos, fichiers RAW et vidéos sur la zone, ou cliquez dessus pour les choisir. Vous pouvez faire glisser **un dossier entier** : cf-dam l’ouvre, ainsi que les dossiers qu’il contient, et importe tout ce qui s’y trouve (les fichiers cachés sont ignorés).

Chaque fichier affiche sa progression : **Recherche de doublons…**, puis un pourcentage, puis **Importé**. Les gros fichiers sont envoyés par morceaux, jusqu’à 5 To chacun, et vous pouvez continuer à travailler pendant ce temps. **Annuler** en arrête un. Une fois terminé, appuyez sur **Actualiser la photothèque** pour les voir.

## Les doublons sont ignorés

Avant d’importer, cf-dam vérifie si les archives contiennent déjà exactement ce fichier, qu’il ait été importé auparavant ou catalogué par un assistant. Si c’est le cas, le fichier indique **Déjà dans les archives**, avec un lien vers la photo, et n’est pas importé à nouveau. (Les fichiers de plus de 512 Mo échappent à cette vérification, car elle oblige à lire tout le fichier.)

Les copies qui ne sont pas identiques, comme un export plus petit ou un JPEG réenregistré, sont importées, puis apparaissent dans [Doublons](/help/duplicates) comme photos similaires.

## Ce qui se passe ensuite

Quelques secondes après chaque importation, cf-dam :

1. lit ses détails : appareil, objectif, exposition, date, GPS, et les mots-clés, titre, légende, crédit et copyright déjà présents dans le fichier ;
2. crée une vignette et un aperçu ;
3. retrouve la ville et le pays à partir de sa position GPS ;
4. la rend consultable par recherche ;
5. la met en file pour l’[analyse par IA](/help/ai-review), si celle-ci est activée pour les nouvelles photos.

## Types de fichiers

| Type | Remarques |
| --- | --- |
| JPEG, PNG, WebP, AVIF, GIF, HEIC (iPhone) | Aperçus créés par cf-dam. |
| Fichiers de plus de 20 Mo environ | Votre navigateur crée l’aperçu avant l’importation, car le service d’images de Cloudflare ne lit que les fichiers jusqu’à 20 Mo. |
| RAW (fichiers d’appareil photo), TIFF | Les aperçus viennent du petit JPEG que la plupart des appareils placent dans le fichier. S’il n’y en a pas, la photo reste sans aperçu jusqu’à ce qu’un assistant en crée un. |
| Vidéo | Votre navigateur crée une image d’affiche, s’il peut lire la vidéo. |

## Directement en archive profonde

Si vous importez directement dans **Glacier** ou **Deep Archive**, votre navigateur crée d’abord l’aperçu, car rien ne pourra relire l’original pendant des heures ensuite. Récupérer l’original plus tard nécessite une restauration : voir [Archiver et restaurer les originaux](/help/archiving).
