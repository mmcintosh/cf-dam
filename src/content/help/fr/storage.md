---
title: "Où sont gardés les originaux"
summary: "La différence entre le catalogue et les originaux, et les endroits où cf-dam peut garder les originaux."
section: Where photos are kept
order: 1
review: machine
source: b58b424e45f6
---

cf-dam garde deux choses différentes à deux endroits différents.

- **Le catalogue :** tout ce que cf-dam sait de chaque photo (ses détails, mots-clés, légendes, notes), plus une petite **vignette** et un **aperçu** plus grand. Ils restent toujours dans votre compte Cloudflare : la photothèque reste donc rapide, quoi qu’il arrive aux originaux.
- **Les originaux :** les fichiers complets sortis de votre appareil photo. Ils peuvent se trouver à n’importe lequel des endroits ci-dessous, et des photos différentes peuvent être à des endroits différents.

## Les endroits où peuvent se trouver les originaux

| Où | Idéal pour | Remarques |
| --- | --- | --- |
| **Cloudflare R2** (intégré) | Démarrer ; les photos que vous ouvrez souvent | Déjà configuré. Aucun frais de téléchargement. |
| **Amazon S3** | Les grandes archives ; un stockage à long terme très bon marché | Nécessite un compte Amazon Web Services. Voir [Connecter Amazon S3](/help/amazon-s3). |
| **Backblaze B2, Wasabi, R2 (second bucket)** | Des alternatives moins chères qu’Amazon | Connexion avec des clés d’accès, comme S3. |
| **Votre NAS ou votre ordinateur** | Les photos que vous gardez déjà chez vous ou au studio | Rien ne bouge : un assistant les catalogue là où elles sont. Voir [Ordinateurs et NAS](/help/computers-and-nas). |

La page **Stockage** liste tous les endroits que vous avez connectés. L’un d’eux est celui **Par défaut**, où vont les importations sauf si vous en choisissez un autre dans la fenêtre d’importation.

## Connecter un bucket

Sur **Stockage**, appuyez sur **Ajouter une connexion S3** et choisissez le fournisseur. cf-dam remplit ce qu’il peut. Vous lui indiquez ensuite :

- **Nom :** ce qui vous aide à le reconnaître, comme « Archives du studio ».
- **Bucket :** le nom du bucket, exactement comme le fournisseur l’affiche.
- **Région :** où se trouve le bucket, comme `us-east-1`.
- **Dossier dans le bucket** (facultatif) : garde les fichiers de cf-dam dans un seul dossier, comme `cf-dam`.
- **Mode de connexion :** des clés d’accès ou, pour Amazon, l’option sans clé (voir [Connecter Amazon S3](/help/amazon-s3)).
- **Classes de stockage proposées par ce bucket**, et la **classe par défaut des importations**.

Appuyez sur **Ajouter et tester**. cf-dam écrit un petit fichier de test, le relit et le supprime. « Connecté » signifie que tout a fonctionné ; sinon, la raison est indiquée.

> **Importer depuis le navigateur vers un bucket** demande un réglage de plus sur le bucket lui-même, appelé règle CORS. Le formulaire affiche la règle exacte à copier sous « Les importations du navigateur vont directement au bucket ». Sans elle, les importations vers ce bucket échouent avec une erreur réseau.

## Les photos déjà dans un bucket

Si le bucket contient déjà des photos, ouvrez **Cataloguer les fichiers déjà dans ce bucket** sous la connexion et appuyez sur **Importer**. Chaque fichier devient consultable là où il est : rien n’est copié ni déplacé. Vous pouvez partir d’un seul dossier, comme `photos/2019/`. Les aperçus sont créés en arrière-plan. Les fichiers en archive profonde sont listés avec leur nom, leur taille et leur classe jusqu’à ce que vous les restauriez.

## Les classes de stockage, en bref

Amazon propose des « classes » moins chères pour les fichiers que vous ouvrez rarement. Plus le stockage est bon marché, plus il est long et coûteux de récupérer un fichier :

| Classe | Environ par téraoctet et par mois | Récupérer un fichier |
| --- | --- | --- |
| Standard | 23 $ | Immédiatement |
| Standard-IA (accès peu fréquent) | 12,50 $ | Immédiatement, petits frais par Go |
| Glacier Flexible Retrieval | 3,60 $ | 3 à 12 heures |
| Glacier Deep Archive | 1 $ | Sous 12 à 48 heures |

Les prix sont les tarifs américains publiés par Amazon au moment de la rédaction ; consultez [la page de tarifs S3 d’Amazon](https://aws.amazon.com/s3/pricing/) pour les vôtres. Amazon facture aussi une **durée minimale** : 30 jours pour les classes IA, 90 pour Glacier et 180 pour Deep Archive, même si vous supprimez ou déplacez le fichier plus tôt.

Vous pouvez déplacer une photo d’une classe à une autre depuis sa page (**Déplacer**), et récupérer une photo de Glacier avec **Demander la restauration**. Voir [Archiver et restaurer](/help/archiving).

## Les autres parties de la page Stockage

- **Vérifications :** cf-dam s’assure régulièrement que les originaux qu’il connaît sont toujours là où il le pense. Les problèmes s’affichent ici et sous forme d’alerte.
- **Archiver les travaux livrés :** une copie à froid dans S3 des originaux de chaque travail livré, quelques jours après la livraison. Voir [Travaux](/help/jobs).
- **Cloudflare Images ce mois-ci :** combien d’images Cloudflare a créées ce mois-ci pour les aperçus, les vignettes, l’IA et les filigranes, que Cloudflare facture au-delà de ce que comprend votre offre, avec une alerte quand ce nombre dépasse celui que vous avez fixé.
- **Aperçus :** vérifie que chaque vignette et chaque aperçu existe bien, et recrée ceux qui manquent. Voir [Sauvegarder et restaurer le catalogue](/help/backups).
- **Sauvegardes du catalogue :** des copies quotidiennes du catalogue lui-même. Voir [Sauvegarder et restaurer le catalogue](/help/backups).
