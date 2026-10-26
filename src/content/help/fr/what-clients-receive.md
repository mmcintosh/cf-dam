---
title: "Ce que reçoivent les clients"
summary: "Ce que contiennent les fichiers que les clients téléchargent ou achètent depuis une galerie, ce qu’ils peuvent lire sur la page, et ce qu’il faut vérifier avant d’envoyer un lien."
section: Sharing
order: 6
review: machine
source: f6588c6151b7
---

Une galerie montre vos photos, mais un fichier téléchargé peut contenir plus que l’image. Cette page liste ce que reçoivent les clients, pour que rien de ce que vous vouliez garder privé ne parte avec.

## Sur la page de la galerie

- **Les titres, légendes et textes alternatifs** sont visibles par toute personne qui ouvre le lien. Une légende comme « Lily, 4 ans, avec Mamie » nomme des personnes : vérifiez les légendes avant de partager un album.
- **Les noms de fichier** ne sont visibles qu’avec **Afficher les noms de fichier** activé.
- **Les personnes que vous avez nommées** dans cf-dam ne sont jamais montrées, pas plus que les mots-clés, les notes, les lieux sur la carte ou vos remarques.

## Noms de fichier

Avec **Afficher les noms de fichier** désactivé, rien de ce que reçoit un client ne porte le vrai nom du fichier. Les téléchargements portent le nom de la galerie et la place de la photo, par exemple `mariage-dupont-042.jpg`. Les commandes et les reçus Stripe l’appellent **Photo 42**. Activé, les fichiers gardent leur vrai nom.

## Téléchargements Petit et Grand

Les téléchargements Petit et Grand sont des JPEG que cf-dam crée à partir de la photo, avec vos retouches (recadrages et rotations) et le filigrane si la galerie en a un.

## Originaux

Un original téléchargé est **le fichier exactement tel qu’il a été envoyé**. Cela comprend :

- **Tout ce que votre logiciel de retouche y a écrit :** par exemple, Lightroom peut y écrire les noms des personnes, des mots-clés, des légendes, des notes et vos coordonnées.
- **Les informations de l’appareil :** certains appareils et téléphones ajoutent la position GPS, le nom du propriétaire de l’appareil et leurs propres noms de reconnaissance faciale.
- **Aucune retouche faite dans cf-dam.** Si vous avez recadré quelqu’un ici, il est toujours dans l’original.

Les téléchargements payants **Taille réelle** sont aussi des originaux, vendus seulement pour les photos JPEG et PNG sans retouche dans cf-dam.

Avant de proposer les originaux, vérifiez ce que contient votre export. Dans Lightroom, le réglage **Métadonnées** de l’export peut n’inclure que le copyright et les coordonnées, et retirer les informations sur les personnes et le lieu.

Les originaux viennent toujours de cf-dam lui-même. Même s’ils sont stockés sur Amazon S3, le client ne reçoit jamais de lien vers votre bucket.

> **Prochainement :** cf-dam retirera les noms des personnes, les mots-clés, les légendes et la position des originaux JPEG et PNG au moment où les clients les téléchargent, en gardant les informations de l’appareil et votre copyright. Chaque galerie aura un réglage pour envoyer les originaux exactement tels qu’ils sont stockés.

## Autres types de fichier

Les photos RAW, TIFF, HEIC, WebP, AVIF et GIF et les vidéos sont toujours envoyées telles qu’elles sont stockées. Les photos de téléphone (HEIC) et les vidéos contiennent souvent la position GPS.

## Voir aussi

- [Galeries clients](/help/client-galleries)
- [Vendre des photos](/help/selling)
- [Personnes sur les photos](/help/people-in-photos)
