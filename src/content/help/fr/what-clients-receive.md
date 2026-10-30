---
title: "Ce que reçoivent les clients"
summary: "Ce que contiennent les fichiers que les clients téléchargent ou achètent depuis une galerie, ce qu’ils peuvent lire sur la page, et ce qu’il faut vérifier avant d’envoyer un lien."
section: Sharing
order: 6
review: machine
source: b8678ddf83a1
---

Une galerie montre vos photos, mais un fichier téléchargé peut contenir plus que l’image. Cette page liste ce que reçoivent les clients, pour que rien de ce que vous vouliez garder privé ne parte avec.

## Sur la page de la galerie

- **Les titres, légendes et textes alternatifs** sont visibles par toute personne qui ouvre le lien. Une légende comme « Lily, 4 ans, avec Mamie » nomme des personnes : vérifiez les légendes avant de partager un album.
- **Les noms de fichier** ne sont visibles qu’avec **Afficher les noms de fichier** activé.
- **Les personnes que vous avez nommées** dans cf-dam ne sont montrées qu’au couple de la galerie, sous les noms que vous choisissez, quand vous réglez la galerie pour cela (voir [Personnes dans une galerie client](/help/people-in-galleries)). Les mots-clés, les notes, les lieux sur la carte et vos remarques ne sont jamais montrés.

## Noms de fichier

Avec **Afficher les noms de fichier** désactivé, rien de ce que reçoit un client ne porte le vrai nom du fichier. Les téléchargements portent le nom de la galerie et la place de la photo, par exemple `mariage-dupont-042.jpg`. Les commandes et les reçus Stripe l’appellent **Photo 42**. Activé, les fichiers gardent leur vrai nom.

## Téléchargements Petit et Grand

Les téléchargements Petit et Grand sont des JPEG que cf-dam crée à partir de la photo, avec vos retouches (recadrages et rotations) et le filigrane si la galerie en a un. Ils ne contiennent rien du fichier d’origine, sauf votre **créateur** et votre **mention de copyright**, tirés des champs Droits de la photo dans cf-dam. Si vous les modifiez, le téléchargement suivant porte les nouveaux.

## Originaux

Un original téléchargé est le fichier tel qu’il a été envoyé, **nettoyé** au passage quand c’est un JPEG ou un PNG :

- **Retiré :** les noms des personnes (y compris les zones de visage de Lightroom), les légendes et descriptions, les mots-clés, les notes, les commentaires, la position GPS, le nom du propriétaire de l’appareil, les notes privées du fabricant (certaines contiennent des noms de reconnaissance faciale) et les identifiants de contenu (C2PA).
- **Conservé :** l’image elle-même, intacte ; les réglages de l’appareil et la date ; et votre **créateur** et votre **mention de copyright**, tirés des champs Droits de la photo dans cf-dam.
- **Les photos HDR de téléphone**, qui cachent une seconde image dans le fichier, arrivent en image standard.
- **Aucune retouche faite dans cf-dam.** Si vous avez recadré quelqu’un ici, il est toujours dans l’original.

Si un fichier ne peut pas être nettoyé avec certitude, il n’est pas envoyé du tout : le client est invité à vous contacter, et l’**Activité** indique quelle galerie.

**Envoyer les originaux exactement tels qu’ils sont stockés** (dans les réglages de la galerie, sous Téléchargements) envoie les originaux intacts, avec tout ce que votre logiciel et votre appareil y ont écrit. Ne l’utilisez qu’après avoir vérifié ce que contient votre export. Dans Lightroom, le réglage **Métadonnées** de l’export peut n’inclure que le copyright et les coordonnées.

Les téléchargements payants **Taille réelle** sont aussi des originaux, nettoyés de la même façon, et vendus seulement pour les photos JPEG et PNG sans retouche dans cf-dam.

Les originaux viennent toujours de cf-dam lui-même. Même s’ils sont stockés sur Amazon S3, le client ne reçoit jamais de lien vers votre bucket.

## Autres types de fichier

Les photos RAW, TIFF, HEIC, WebP, AVIF et GIF et les vidéos sont toujours envoyées telles qu’elles sont stockées, sans nettoyage, quel que soit le réglage de la galerie. Les photos de téléphone (HEIC) et les vidéos contiennent souvent la position GPS.

## Voir aussi

- [Galeries clients](/help/client-galleries)
- [Vendre des photos](/help/selling)
- [Personnes sur les photos](/help/people-in-photos)
- [Personnes dans une galerie client](/help/people-in-galleries)
