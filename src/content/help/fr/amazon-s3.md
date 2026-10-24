---
title: "Connecter Amazon S3"
summary: "Un guide pas à pas, de l’ouverture d’un compte Amazon Web Services jusqu’à cf-dam qui y garde vos originaux."
section: Where photos are kept
order: 2
review: machine
source: 63cdd90c1d97
---

Amazon est surtout connu comme boutique, mais il loue aussi du stockage par une activité distincte, **Amazon Web Services (AWS)**. Son service de stockage s’appelle **S3**. Beaucoup de photographes l’utilisent parce qu’une de ses offres, **Glacier Deep Archive**, garde un téraoctet pour environ un dollar par mois.

Ce guide vous mène de zéro jusqu’à cf-dam qui stocke vos originaux dans S3. Comptez environ 30 minutes la première fois. Il vous faut une adresse e-mail, un téléphone et une carte de crédit ou de débit.

> Vous n’avez pas besoin d’Amazon pour utiliser cf-dam. Les originaux peuvent rester dans le stockage de Cloudflare, ou sur votre NAS. Revenez ici quand vous voudrez un stockage à long terme bon marché.

## 1. Ouvrir un compte AWS

Votre compte AWS est distinct de tout compte d’achat Amazon, même s’il utilise le même e-mail.

1. Allez sur [aws.amazon.com](https://aws.amazon.com) et choisissez **Create an AWS account**.
2. Indiquez une adresse e-mail et un nom de compte (le nom de votre studio convient). AWS vous envoie un code par e-mail pour confirmer l’adresse.
3. Choisissez un mot de passe solide. Cette première identité est l’**utilisateur root** : le propriétaire tout-puissant du compte. Gardez son mot de passe dans votre gestionnaire de mots de passe.
4. Renseignez vos coordonnées et une carte de paiement. AWS peut prélever un petit montant temporaire pour vérifier la carte.
5. Confirmez votre numéro de téléphone avec le code qu’AWS envoie.
6. Choisissez une offre. Les nouveaux comptes démarrent avec un peu de crédit gratuit dans les deux cas.

> **À propos de l’offre gratuite (Free) :** au moment de la rédaction, l’offre Free se termine au bout de six mois (ou quand le crédit est épuisé), et un compte qui n’est pas passé à l’offre payante d’ici là est fermé, avec ses fichiers. Des archives sont faites pour durer : choisissez donc l’offre **Paid** dès le départ, ou programmez un rappel pour changer d’offre. Vous ne payez que ce que vous utilisez.

## 2. Protéger le compte

Avant de stocker quoi que ce soit :

1. Connectez-vous, ouvrez le menu sous le nom de votre compte (en haut à droite) et choisissez **Security credentials**.
2. Sous **Multi-factor authentication (MFA)**, choisissez **Assign MFA device** et ajoutez une clé d’accès, une application d’authentification ou une clé de sécurité. Désormais, la connexion en tant qu’utilisateur root l’exige.
3. Définissez une alerte de dépenses : cherchez **Budgets** dans la console, choisissez **Create budget**, prenez le modèle de coût mensuel et indiquez un petit montant, comme 10 $, et votre e-mail. AWS vous prévient par e-mail si les coûts du mois le dépassent.

## 3. Créer un bucket

Un **bucket** est un espace de stockage nommé. Un seul suffit pour cf-dam.

1. Dans le champ de recherche en haut de la console AWS, tapez **S3** et ouvrez-le.
2. Choisissez **Create bucket**.
3. **Bucket name :** lettres minuscules, chiffres et tirets, comme `smith-studio-archive`. Il doit être unique dans tout AWS : ajoutez donc quelque chose qui vous est propre.
4. **Region :** choisissez la plus proche de vous (par exemple **US East (N. Virginia)** correspond à `us-east-1` ; **Europe (London)** à `eu-west-2`). Notez le code : cf-dam vous le demandera.
5. Laissez **Block all public access** activé. Vos photos restent privées ; cf-dam n’a pas besoin qu’elles soient publiques.
6. Laissez les autres réglages tels quels et choisissez **Create bucket**.

## 4. Le connecter à cf-dam

cf-dam peut se connecter à votre bucket de deux façons. **Sans clé** est plus sûr : aucun secret qui fasse office de mot de passe n’est jamais stocké. Utilisez des **clés d’accès** si l’option sans clé ne vous convient pas, par exemple si votre cf-dam n’est pas en `https`.

### Sans clé (recommandé)

Il vous faut l’**ID de votre compte AWS** : le nombre à 12 chiffres dans le menu sous le nom de votre compte, en haut à droite de la console AWS.

1. Dans cf-dam, ouvrez **Stockage** et appuyez sur **Ajouter une connexion**.
2. Choisissez **Amazon S3**, puis **Sans clé : un rôle IAM (recommandé)**.
3. Renseignez un **Nom**, le nom du **Bucket**, le code de **Région** et, si vous le souhaitez, un **Dossier dans le bucket** comme `cf-dam`.
4. **ARN du rôle :** tapez `arn:aws:iam::`, puis l’ID à 12 chiffres de votre compte, puis `:role/cf-dam`. Par exemple : `arn:aws:iam::123456789012:role/cf-dam`. (Vous allez créer ce rôle dans un instant.)
5. Appuyez sur **Ajouter et tester**. cf-dam ouvre la page de la nouvelle connexion.
6. Sur cette page, **Configuration AWS de cette connexion sans clé** est ouverte. Elle affiche trois choses à copier : une **URL et une audience de fournisseur d’identité**, une **politique d’approbation** et une **politique d’autorisations**.

Ensuite, dans la console AWS :

7. Cherchez **IAM** et ouvrez-le. Choisissez **Identity providers**, puis **Add provider**.
8. Choisissez **OpenID Connect**. Collez l’**URL du fournisseur** et l’**audience** venant de cf-dam. Choisissez **Add provider**.
9. Dans IAM, choisissez **Roles**, puis **Create role**.
10. Choisissez **Custom trust policy**, effacez le contenu de la zone et collez la **politique d’approbation** venant de cf-dam (le bouton **Copier** la copie). Choisissez **Next**.
11. Passez la liste des autorisations (choisissez **Next**). Nommez le rôle exactement `cf-dam`, puis **Create role**.
12. Ouvrez le nouveau rôle. Sous **Permissions**, choisissez **Add permissions**, puis **Create inline policy**.
13. Choisissez **JSON**, effacez ce qui s’y trouve et collez la **politique d’autorisations** venant de cf-dam. Choisissez **Next**, nommez-la `cf-dam-bucket`, puis **Create policy**.

De retour dans cf-dam, appuyez sur **Tester** sur la connexion. « Connecté : un objet de test a été écrit, relu et supprimé » signifie que c’est terminé.

La politique d’autorisations ne donne à cf-dam accès qu’à **ce seul bucket** (et à ce dossier) : il peut y ajouter, lire, supprimer et restaurer des fichiers, et les lister. Il ne peut toucher à rien d’autre dans votre compte AWS.

### Avec des clés d’accès

1. Dans la console AWS, ouvrez **IAM**, choisissez **Users**, puis **Create user**. Nommez-le `cf-dam`. Ne lui donnez pas accès à la console. Choisissez **Next**.
2. Choisissez **Attach policies directly**, puis **Next** et **Create user** (vous ajouterez une politique dans un instant).
3. Ouvrez le nouvel utilisateur. Choisissez **Add permissions**, puis **Create inline policy**, puis **JSON**, et collez ceci, en mettant le nom de votre bucket à la place de `YOUR-BUCKET` (deux fois) :

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:RestoreObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::YOUR-BUCKET" }
  ]
}
```

4. Nommez la politique `cf-dam-bucket` et créez-la.
5. Dans l’onglet **Security credentials** de l’utilisateur, choisissez **Create access key**, prenez **Application running outside AWS**, et créez-la.
6. AWS affiche un **Access key ID** et une **Secret access key**. La clé secrète n’est affichée **qu’une seule fois** : gardez cette page ouverte.
7. Dans cf-dam, **Stockage → Ajouter une connexion → Amazon S3 → Clés d’accès**. Renseignez le nom, le bucket, la région et le dossier, collez les deux clés et appuyez sur **Ajouter et tester**.

cf-dam chiffre le secret avant de le stocker et ne l’affiche plus jamais. N’envoyez jamais de clés par e-mail et ne les collez nulle part ailleurs.

## 5. Si vous importez directement dans ce bucket

Quand vous importez dans le navigateur vers une connexion S3, les fichiers vont directement de votre ordinateur à Amazon. Le bucket doit l’autoriser :

1. Sur la page de la connexion dans cf-dam, sous **Envoyer depuis le navigateur**, appuyez sur **Copier** à côté de la règle.
2. Dans la console AWS, ouvrez le bucket, puis **Permissions**, descendez jusqu’à **Cross-origin resource sharing (CORS)** et choisissez **Edit**.
3. Collez la règle et choisissez **Save changes**.
4. De retour dans cf-dam, appuyez sur **Tester l’envoi depuis ce navigateur**.

Vous n’en avez pas besoin si vos photos n’arrivent dans S3 qu’en y étant importées ou déplacées.

## 6. En faire le stockage par défaut (facultatif)

Sur la page de la connexion, appuyez sur **Définir par défaut** pour y envoyer les nouvelles importations. Vous pouvez toujours choisir un autre endroit dans la fenêtre d’importation.

## Ce que ça coûte

| | Environ (tarifs américains) |
| --- | --- |
| Stockage dans S3 Standard | 23 $ par téraoctet et par mois |
| Stockage dans Glacier Deep Archive | 1 $ par téraoctet et par mois (durée minimale de 180 jours) |
| Récupérer un fichier depuis Deep Archive | environ 20 $ par téraoctet (option « Bulk » moins chère : environ 2,50 $), plus une attente pouvant aller jusqu’à 12 ou 48 heures |
| Télécharger hors d’AWS | environ 90 $ par téraoctet après les 100 premiers Go du mois |
| Les vignettes et aperçus de cf-dam | rien chez Amazon : ils sont chez Cloudflare |

Consultez [la page de tarifs S3 d’Amazon](https://aws.amazon.com/s3/pricing/) pour votre région. Voir [Archiver et restaurer](/help/archiving) pour déplacer des photos vers Glacier et les récupérer.

## Si le test échoue

| Ce que dit cf-dam | Ce que cela signifie en général |
| --- | --- |
| Access Denied | La politique d’autorisations contient un autre nom de bucket, ou un dossier qui ne correspond pas à celui de la connexion. |
| Un message sur la région, ou une « redirection » | Le code de région dans cf-dam ne correspond pas à la région du bucket. |
| Not authorized to perform `sts:AssumeRoleWithWebIdentity` | Sans clé : l’URL ou l’audience du fournisseur d’identité, ou la politique d’approbation du rôle, ne correspond pas à ce que cf-dam a affiché. Copiez-les à nouveau. |
| Le rôle est introuvable | L’ARN du rôle contient une faute de frappe, ou le rôle ne s’appelle pas `cf-dam`. |
| Les importations échouent avec une erreur réseau | La règle CORS du bucket manque (étape 5) : **Tester l’envoi depuis ce navigateur** le signale. |

Toujours bloqué ? Le [glossaire](/help/glossary) explique les termes d’AWS. Une faute de frappe dans le rôle ou les clés se corrige avec **Modifier** sur la page de la connexion. Vous pouvez aussi **Retirer** une connexion qui n’a jamais fonctionné et recommencer (cf-dam ne retire pas une connexion qui contient encore des originaux ou que quelque chose utilise : la page indique quoi).
