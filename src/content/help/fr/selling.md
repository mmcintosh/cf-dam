---
title: "Vendre des photos"
summary: "Permettre aux clients d’acheter des fichiers numériques depuis leur galerie : connecter Stripe, listes de prix, commandes, remboursements et ce dont vous êtes responsable."
section: Sharing
order: 5
review: machine
source: 43b5d0e7ac24
---

Les clients peuvent acheter des fichiers numériques depuis leur galerie et payer avec Stripe, sur votre propre compte Stripe. L’argent vous revient ; cf-dam ne prend aucune commission. Les tirages viendront plus tard.

## Ce qu’il vous faut

- Un compte **Stripe** (stripe.com). Essayez d’abord tout avec le **mode test** de Stripe : aucun argent réel ne circule, et cf-dam affiche **Mode test** tant que vous y êtes.
- Être prêt à agir en tant que vendeur : la taxe sur les ventes ou la TVA, les remboursements et les reçus sont à votre charge. Stripe peut calculer et collecter la taxe pour vous, mais c’est vous qui vous enregistrez et faites les déclarations.

## Connecter Stripe

Dans **Travail client → Commandes**, la section **Vente** vous guide (administrateurs uniquement) :

1. Dans Stripe, **Developers → API keys**, créez une **clé restreinte** qui peut écrire des Checkout Sessions et lire les Charges et les Payment Intents. Collez-la dans **Clé restreinte Stripe**.
2. Dans Stripe, **Developers → Webhooks**, ajoutez un endpoint à l’adresse affichée, avec les événements indiqués à côté.
3. Copiez le **signing secret** de cet endpoint (il commence par `whsec_`) dans **Signing secret du webhook**, cliquez sur **Enregistrer**, puis sur **Vérifier**.

La clé et le secret sont stockés chiffrés, ne sont plus jamais affichés et sont exclus des sauvegardes du catalogue (saisissez-les à nouveau après une restauration dans une nouvelle installation). Sous **Vous, le vendeur**, choisissez la **Devise** (elle ne peut plus changer dès que des prix ou des commandes l’utilisent), le **Nom de l’entreprise** et les **Conditions et remboursements** affichés sur la page de paiement de Stripe.

## Listes de prix

Une liste de prix indique ce que coûtent **Petite**, **Grande** et **Taille réelle**, et ce que coûtent **Toutes les photos** d’une galerie d’un seul coup. Laissez un prix vide pour ne pas vendre cette taille. Créez autant de listes que vous voulez (pour les mariages, pour les portraits…), puis choisissez-en une pour une galerie, sous son lien, dans **Vend avec**.

- Une taille que la galerie donne déjà gratuitement n’y est pas vendue.
- **Petite** et **Grande** sont produites à partir de la photo telle que les clients la voient (avec votre rotation et votre recadrage), sans le filigrane.
- **Taille réelle** est le fichier original : elle n’est donc proposée que pour les originaux JPEG et PNG que vous n’avez ni tournés ni recadrés dans cf-dam, et seulement tant que l’original peut être lu à ce moment-là (pas sur un NAS, pas dans un stockage d’archivage profond).

## Ce que voient les clients

Dans la galerie, la grande vue d’une photo propose **Acheter…** avec chaque taille et son prix, et le haut de la galerie propose **Acheter toutes les photos** quand cela a un prix. Ils paient sur la page de Stripe elle-même (carte, Apple Pay, Google Pay, Link) et reviennent sur leur **page de commande** : son adresse est leur lien vers les fichiers, sur n’importe quel appareil. La galerie montre aussi ce qu’ils ont acheté, dans le navigateur avec lequel ils l’ont acheté.

## Commandes

**Travail client → Commandes** liste ce qui a été acheté : quand, par qui, depuis quelle galerie, le total et son état.

- **Payée** : les téléchargements fonctionnent.
- **À vérifier** : Stripe indique que c’est payé, mais le montant ne correspond pas à la commande. Rien n’est téléchargeable tant que vous n’avez pas regardé ; réglez-le dans Stripe (remboursement, ou prise de contact avec le client).
- **Remboursée** et **Contestée** : les téléchargements s’arrêtent. Faites les remboursements dans votre tableau de bord Stripe ; la commande ici suit d’elle-même.
- **En paiement** et **Non payée** : un client a quitté la page de paiement ; rien n’a été débité.

Si le message de Stripe concernant un paiement se perd, cf-dam interroge lui-même Stripe quelques minutes plus tard, pour qu’une commande payée ne reste jamais bloquée.
