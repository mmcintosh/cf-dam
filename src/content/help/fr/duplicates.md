---
title: "Doublons"
summary: "Trouver les fichiers identiques et les copies similaires, et garder la meilleure."
section: Your photos
order: 6
review: machine
source: 7fde0a7267ff
---

Les archives accumulent des copies : la même photo importée deux fois, un export à côté de son original, un JPEG réenregistré, le même dossier sur deux disques. **Doublons** les trouve et suggère laquelle garder.

## Deux types

- **Les fichiers identiques** sont le même fichier, octet pour octet, d’où qu’ils viennent : par exemple une importation et la copie d’un assistant sur le NAS.
- **Les photos similaires** sont des fichiers différents de la même image : redimensionnée, réenregistrée, exportée dans une autre qualité, légèrement retouchée. cf-dam les trouve grâce à une « empreinte » des zones claires et sombres de chaque image : il repère ainsi des copies qu’une comparaison de fichiers ne voit pas. Deux photos prises à un instant d’intervalle peuvent aussi se ressembler : c’est pourquoi les photos similaires sont à examiner par vous.

Les photos de scènes unies (un ciel vide, du brouillard, une image noire) ont très peu de chose dans leur empreinte : elles ne sont donc associées que si leurs empreintes et leurs dimensions en pixels sont **exactement** les mêmes.

Les fichiers identiques ne peuvent de toute façon pas être importés deux fois : l’importation indique **Déjà dans les archives** (voir [Importer des photos](/help/uploading)).

## Laquelle garder

Chaque groupe montre toutes les copies avec leur taille en pixels, leur poids, leur type de fichier, leur date et leur appareil, et en marque une comme **Suggérée**, avec la raison. cf-dam préfère, dans cet ordre :

1. **Plus de pixels** : l’image la plus grande.
2. **L’original RAW**, puis un fichier sans perte (TIFF, PNG), plutôt qu’un JPEG.
3. À taille égale, le fichier **moins compressé** : « Même taille, mais moins compressée (707 Ko contre 664 Ko) ».
4. **Votre sélection**, puis celle qui est **mieux notée**.
5. Sinon, celle arrivée en premier.

La raison est affichée : vous pouvez donc ne pas être d’accord et choisir une autre copie avant d’appuyer sur le bouton.

## En garder une

Choisissez la copie à garder et appuyez sur **Garder la sélection, retirer …**. Les mots-clés, albums, note et sélection des autres passent à celle que vous gardez, et les autres sont retirées du catalogue.

> **Retirer un doublon ne supprime jamais de fichier.** Cela retire seulement cette copie du catalogue de cf-dam. Les fichiers originaux restent où ils sont, sur votre NAS, votre ordinateur ou dans le stockage, et vous pouvez les ranger vous-même si vous le souhaitez.

## Pas des doublons

Pour les photos similaires qui ne sont pas vraiment des copies (deux images d’une rafale, par exemple) :

- **Pas des doublons** écarte tout le groupe ;
- **Pas un doublon** sous une photo retire seulement celle-ci du groupe.

Les paires écartées ne sont plus suggérées.
