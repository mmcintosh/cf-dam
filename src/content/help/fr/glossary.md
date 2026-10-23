---
title: "Glossaire"
summary: "Les mots qu’utilisent cf-dam et les services de stockage, expliqués simplement."
section: Getting started
order: 9
review: machine
source: 1f33cb2730fb
---

**Analyse par IA.** Un modèle d’IA qui examine chaque photo et rédige des suggestions : texte alternatif, légende, description, mots-clés. C’est vous qui décidez de ce que vous gardez. Voir [Analyse par IA](/help/ai-review).

**Texte alternatif.** Une courte description d’une photo pour les personnes qui ne peuvent pas la voir. Les lecteurs d’écran la lisent à voix haute ; les galeries et les sites web l’utilisent.

**Archive.** Une copie sûre et bon marché de vos originaux, en général dans Glacier Deep Archive, pour le jour où quelque chose tourne mal. Voir [Archiver](/help/archiving).

**AWS (Amazon Web Services).** L’activité d’Amazon qui loue des ordinateurs et du stockage, distincte de sa boutique. S3 en fait partie. Voir [Connecter Amazon S3](/help/amazon-s3).

**Bucket.** Un espace de stockage nommé dans S3, R2 ou des services similaires : comme un disque dans le cloud. cf-dam peut garder les originaux dans un ou plusieurs buckets.

**Catalogue.** Tout ce que cf-dam sait de vos photos : détails, mots-clés, légendes, notes, albums, vignettes et aperçus. Pas les originaux eux-mêmes.

**Galerie client.** Un album partagé avec un client par un lien privé, avec son propre mot de passe, sa date d’expiration et ses téléchargements, ou avec un client qui se connecte à un compte qui ne montre que ses galeries. Voir [Galeries clients](/help/client-galleries).

**Docker.** Une façon standard de faire tourner de petits programmes, comme l’assistant de cf-dam, sur un NAS. Chaque programme tourne dans son propre « conteneur » isolé.

**EXIF.** Les détails que votre appareil écrit dans chaque photo : appareil, objectif, exposition, date et heure, et position GPS s’il en a une.

**Glacier et Deep Archive.** Les classes de stockage les moins chères d’Amazon, pour les fichiers que vous ouvrez rarement. Un téraoctet dans Deep Archive coûte environ un dollar par mois, mais récupérer un fichier prend jusqu’à 12 ou 48 heures. Voir [Archiver](/help/archiving).

**HEIC.** Le format photo des iPhone. cf-dam sait le lire.

**Assistant (agent).** Un petit programme sur votre NAS ou votre ordinateur qui catalogue les photos là où elles sont, sans les déplacer. Voir [Ordinateurs et NAS](/help/computers-and-nas).

**IPTC.** L’ensemble standard de champs pour décrire les photos, utilisé par les agences, les journaux, Lightroom et Photo Mechanic : titre, créateur, mention de crédit, copyright, conditions d’utilisation, coordonnées, lieu, commande.

**Mot-clé.** Un mot ou une expression qui dit ce que montre une photo ou de quoi elle parle. cf-dam les range en arborescence, comme *Places › Norway › Bergen*. Voir [Mots-clés](/help/keywords).

**Photo similaire.** Une copie d’une photo qui n’est pas le même fichier : redimensionnée, réenregistrée, exportée à nouveau. Voir [Doublons](/help/duplicates).

**Métadonnées.** Les informations sur une photo, plutôt que l’image elle-même : EXIF, IPTC, mots-clés, légendes, notes.

**NAS (stockage en réseau).** Un boîtier de disques sur votre réseau, comme un Synology ou un QNAP, qui garde les fichiers de tous les ordinateurs de la maison ou du studio.

**Neurones.** L’unité avec laquelle Cloudflare mesure (et facture) Workers AI. 10 000 par jour sont gratuits ; ensuite, 0,011 $ les 1 000. Analyser 1 000 photos en utilise environ 46 000.

**Original.** Le fichier complet sorti de votre appareil photo ou de votre logiciel de retouche. cf-dam ne le modifie jamais.

**Code d’appairage.** Les huit lettres qu’affiche un nouvel assistant. Les taper dans cf-dam connecte l’assistant à vos archives.

**Clé d’accès.** Un moyen de se connecter avec son empreinte, son visage, le code PIN de son appareil ou un gestionnaire de mots de passe au lieu d’un mot de passe. Plus sûr, et rien à retenir. Voir [Votre compte et la connexion](/help/account-security).

**Aperçu.** Une grande copie d’une photo (jusqu’à 2 048 pixels de large) que cf-dam crée pour l’affichage, le partage et l’analyse par IA, gardée dans votre compte Cloudflare.

**R2.** Le stockage de Cloudflare. Les vignettes et aperçus de cf-dam y sont toujours, et les originaux peuvent y être aussi.

**RAW.** Le fichier non traité que certains appareils enregistrent (comme `.CR3`, `.NEF`, `.ARW`). Il contient le plus de détails ; vous le développez dans Lightroom ou un logiciel similaire.

**Restauration.** Rapporter depuis Glacier une copie d’un original archivé pour pouvoir la télécharger. Aussi : récupérer le catalogue depuis une sauvegarde. Voir [Sauvegardes](/help/backups).

**S3.** Le service de stockage d’Amazon, et la « langue » que parlent aussi beaucoup d’autres services de stockage (R2, Backblaze B2, Wasabi).

**Classe de stockage.** La façon dont un fichier est gardé dans S3 : Standard (immédiat, le plus cher), Infrequent Access, Glacier, Deep Archive (le plus lent, le moins cher).

**Vignette.** Une petite copie d’une photo (480 pixels de large) pour la grille de la photothèque.

**Connexion en deux étapes (double authentification).** Une deuxième étape après votre mot de passe : un code venant d’une application sur votre téléphone. Voir [Votre compte et la connexion](/help/account-security).

**Filigrane.** Votre nom ou votre logo posé sur les photos affichées dans les galeries clients et sur les copies téléchargées. Les originaux ne sont jamais filigranés.

**XMP.** Une façon standard d’enregistrer les métadonnées (mots-clés, légendes, notes, libellés) dans une photo ou dans un petit fichier à côté d’elle (un fichier « sidecar »), que lisent Lightroom, Capture One et Bridge.
