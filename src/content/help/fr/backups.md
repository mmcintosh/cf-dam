---
title: "Sauvegarder et restaurer le catalogue"
summary: "Les copies quotidiennes du catalogue, comment le restaurer dans une nouvelle installation, et la vérification des aperçus."
section: Where photos are kept
order: 4
review: machine
source: 144f5352577b
---

Les **originaux** de vos photos sont protégés par l’endroit où vous les gardez (voir [Archiver et restaurer les originaux](/help/archiving)). Le **catalogue** (les détails, mots-clés, légendes et notes de chaque photo, les albums, galeries et personnes) est protégé par les **sauvegardes du catalogue**.

## Activer les sauvegardes

Sur **Stockage**, sous **Sauvegardes du catalogue** :

1. **Sauvegarder vers :** choisissez un bucket. N’importe quel bucket connecté convient ; le bucket intégré est déjà là.
2. **Chaque jour à :** l’heure (en UTC ; cf-dam affiche votre heure locale à côté).
3. **Conserver :** combien de jours de sauvegardes garder. Les plus anciennes sont supprimées, mais jamais la plus récente.
4. Appuyez sur **Enregistrer**. La première sauvegarde démarre dans la minute ; **Sauvegarder maintenant** en lance une à tout moment.

> **Utilisez si possible un bucket hors de Cloudflare.** Le bucket intégré est dans le même compte Cloudflare que le catalogue : il protège des erreurs, mais pas de la perte du compte. Un bucket dans Amazon S3 (ou Backblaze B2, Wasabi…) protège des deux.

### Ce qui est dans une sauvegarde, et ce qui n’y est pas

| Dedans | Pas dedans |
| --- | --- |
| Les détails, mots-clés, légendes, notes et libellés de chaque photo | Les fichiers originaux (ils sont là où vous les gardez) |
| Les albums, les galeries clients, leurs visiteurs et leurs sélections | Les mots de passe, clés d’accès, codes de connexion en deux étapes, connexions |
| Les personnes et leurs rôles | Les clés d’API |
| Les mots-clés, préréglages, réglages, connexions des assistants | Les vignettes et aperçus (ils sont recréés) |

Comme les mots de passe ne sont pas dans une sauvegarde, après une restauration chacun reçoit un nouveau mot de passe.

## Restaurer le catalogue

Une restauration se fait dans un cf-dam **neuf et vide** (par exemple après être reparti de zéro dans un nouveau compte Cloudflare) :

1. Installez cf-dam comme d’habitude. Sur la première page, choisissez **Restaurer depuis une sauvegarde** au lieu de **Commencer de nouvelles archives**.
2. Indiquez **où sont les sauvegardes** : le stockage intégré de cette installation s’il les a encore, ou un bucket S3. Des clés en lecture seule suffisent ; elles ne sont conservées que jusqu’à la fin de la restauration.
3. **Choisissez une sauvegarde** dans la liste, et créez le premier administrateur.

La restauration se déroule en arrière-plan et peut être suivie sur la page. Si elle s’arrête (un problème réseau, par exemple), **réessayez** : elle reprend là où elle s’était arrêtée.

Après une restauration :

- **Les assistants** sur votre NAS et vos ordinateurs se réappairent et retrouvent leurs propres entrées, pour ne pas tout renvoyer une deuxième fois. Voir [Ordinateurs et NAS](/help/computers-and-nas).
- **Les vignettes et aperçus** sont recréés : à partir des originaux là où cf-dam peut les lire, et par les assistants pour les originaux sur un NAS.

### Ce qu'une restauration ne peut pas ramener

Une sauvegarde copie une table après l'autre, pendant des heures pour un grand catalogue, alors que le travail continue. Ce n'est donc pas un instant unique : elle peut contenir quelques lignes sans ce à quoi elles appartiennent, comme un mot-clé proposé par l'analyse par IA après la copie des mots-clés, ou une photo trouvée par un assistant pendant ce temps. Une restauration laisse ces lignes de côté, ou vide un lien vers quelque chose de plus récent que la sauvegarde, et indique combien à la fin :

- **Lignes laissées de côté**, table par table.
- **Liens vidés** : par exemple, un album dont le travail est plus récent que la sauvegarde revient sans son travail.
- **Photos sans original** : leurs emplacements étaient plus récents que la sauvegarde. Un assistant installé pendant la sauvegarde ajoute de nouveau ses fichiers comme nouvelles photos ; vous retrouvez ensuite les anciennes copies avec le filtre **Original introuvable partout** de la photothèque, et vous pouvez les supprimer.
- **Une sauvegarde incomplète** : une sauvegarde qui contient moins de lignes qu'elle n'en annonce est peut-être abîmée. S'il manque quelque chose, restaurez-en une plus ancienne.

## La vérification des aperçus

Sur **Stockage**, sous **Aperçus**, **Vérifier chaque aperçu** interroge le stockage intégré pour chaque vignette et chaque aperçu, et recrée ceux qui manquent. Pour un million de photos, cela prend quelques heures et coûte bien moins d’un dollar. **Réessayer les bloqués** relance ceux qui n’ont pas pu être créés.

Vous n’en aurez normalement pas besoin : cf-dam remarque un aperçu manquant la première fois que quelqu’un l’ouvre. C’est là pour après une restauration, ou pour avoir l’esprit tranquille.

**Refaire chaque aperçu** refait la miniature et l’aperçu de chaque photo, tels que cf-dam les fait aujourd’hui : depuis novembre 2026, ils sont un peu plus nets. Les photos dont cf-dam peut lire l’original sont refaites ici, quelques-unes à la fois ; chacune coûte deux transformations Cloudflare Images. Les photos sur un NAS ou un ordinateur sont refaites par leur assistant, sans frais. Les photos qui ne peuvent pas être bien refaites pour l’instant (un original seulement en archive, un fichier RAW envoyé par le site) gardent les leurs. Tant qu’un nouvel aperçu n’est pas arrivé, l’ancien est affiché. Les visages des photos sont ensuite recherchés à nouveau, et les noms que vous avez donnés sont conservés.
