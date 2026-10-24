---
title: "Où sont gardés les originaux"
summary: "La différence entre le catalogue et les originaux, et les endroits où cf-dam peut garder les originaux."
section: Where photos are kept
order: 1
review: machine
source: 95bfc3f3803f
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

La page **Stockage** liste tous les endroits que vous avez connectés, un par ligne : de quel type il s’agit, combien d’originaux y sont gardés et quelle place ils occupent, et ce qui l’utilise (**Nouveaux envois**, **Archives des commandes**, **Sauvegardes du catalogue**, l’archive d’un assistant). L’un d’eux est celui **Par défaut**, où vont les importations sauf si vous en choisissez un autre dans la fenêtre d’importation. Appuyez sur une ligne pour ouvrir la page de cette connexion.

## Connecter un bucket

Sur **Stockage**, appuyez sur **Ajouter une connexion** et choisissez le fournisseur. cf-dam remplit ce qu’il peut. Vous lui indiquez ensuite :

- **Nom :** ce qui vous aide à le reconnaître, comme « Archives du studio ».
- **Bucket :** le nom du bucket, exactement comme le fournisseur l’affiche.
- **Région :** où se trouve le bucket, comme `us-east-1`.
- **Dossier dans le bucket** (facultatif) : garde les fichiers de cf-dam dans un seul dossier, comme `cf-dam`.
- **Mode de connexion :** des clés d’accès ou, pour Amazon, l’option sans clé (voir [Connecter Amazon S3](/help/amazon-s3)).
- **Classes de stockage proposées par ce bucket**, et la **classe par défaut des importations**.

Appuyez sur **Ajouter et tester**. cf-dam ouvre la page de la nouvelle connexion et la teste : il écrit un petit fichier de test (dans le dossier, si vous en avez indiqué un), le relit et le supprime, puis indique si cela a fonctionné ou pourquoi. Pour une connexion Amazon sans clé, il ouvre plutôt les étapes AWS, car rien ne fonctionne tant qu’elles ne sont pas faites.

## La page d’une connexion

- **Ce qui est gardé ici :** combien d’originaux ont une copie ici et quelle place ils occupent, par type de stockage (chaud, tiède, froid, archive profonde), avec des liens qui affichent ces photos dans la photothèque. Aussi les copies d’archivage des travaux encore à faire et les sauvegardes du catalogue gardées ici. Tout est compté à partir du catalogue, pas en regardant dans le bucket.
- **Ce qui l’utilise :** les nouvelles importations (si c’est la connexion par défaut), l’archivage des travaux livrés, la sauvegarde quotidienne du catalogue, l’archive d’un assistant NAS ou Mac, chacun avec l’endroit où le modifier.
- **Envoyer depuis le navigateur :** voir ci-dessous.
- **Cataloguer les fichiers déjà dans ce bucket :** voir « Les photos déjà dans un bucket » ci-dessous.
- **Configuration AWS de cette connexion sans clé** (Amazon uniquement) : les étapes et les politiques à créer dans AWS. Voir [Connecter Amazon S3](/help/amazon-s3).
- **Détails :** appuyez sur **Modifier** pour la renommer, changer les classes de stockage qu’elle propose et la classe par défaut, ou changer son rôle (sans clé) ou ses clés d’accès. Une nouvelle clé secrète remplace l’ancienne ; laissez le champ vide pour la garder. Enregistrer de nouveaux identifiants les teste aussitôt. Le **bucket, la région, le point de terminaison et le dossier** ne peuvent changer que tant que rien n’est gardé ici et que rien n’utilise la connexion, car les originaux sont enregistrés sous ces noms : pour passer à un autre bucket, ajoutez une nouvelle connexion.
- **Retirer :** oublie la connexion (le bucket et ses fichiers restent tels quels). Elle ne peut pas être retirée tant que quelque chose est gardé ici ou l’utilise ; la page indique quoi.

## Envoyer depuis le navigateur, et la règle CORS

Quand vous importez vers une connexion S3 (c’est la connexion par défaut, ou vous l’avez choisie dans la fenêtre d’importation), votre navigateur envoie les photos **directement au bucket**, sans passer par cf-dam. Un bucket le refuse sauf s’il autorise ce site, grâce à un réglage sur le bucket appelé **règle CORS**.

1. Sur la page de la connexion, sous **Envoyer depuis le navigateur**, appuyez sur **Copier** à côté de la règle.
2. Dans la console AWS : **S3**, le bucket, **Permissions**, **Cross-origin resource sharing (CORS)**, **Edit**. Collez-la et enregistrez. (Les autres services ont le même réglage sur le bucket.)
3. De retour dans cf-dam, appuyez sur **Tester l’envoi depuis ce navigateur**. Cela envoie un octet comme le fait une importation et indique si le bucket l’a accepté et, sinon, pourquoi.

La règle ne sert qu’aux importations depuis le navigateur. Les copies faites par cf-dam lui-même (archivage des travaux, sauvegardes, déplacements entre classes, restaurations) et l’assistant NAS ou Mac atteignent le bucket sans elle.

## Les photos déjà dans un bucket

Si le bucket contient déjà des photos, ouvrez la page de la connexion et, sous **Cataloguer les fichiers déjà dans ce bucket**, appuyez sur **Importer**. Chaque fichier devient consultable là où il est : rien n’est copié ni déplacé. Vous pouvez partir d’un seul dossier, comme `photos/2019/`. Les aperçus sont créés en arrière-plan. Les fichiers en archive profonde sont listés avec leur nom, leur taille et leur classe jusqu’à ce que vous les restauriez.

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
