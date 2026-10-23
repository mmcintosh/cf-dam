---
title: "Rechercher"
summary: "Trouver des photos grâce aux mots écrits à leur sujet, ou grâce à ce qu’elles montrent."
section: Your photos
order: 2
review: machine
source: 86eb66d230d4
---

Le champ de recherche se trouve en haut de chaque page (appuyez sur **⌘K** sur Mac ou **Ctrl+K** sur Windows pour y aller directement). Il existe deux types de recherche.

## Rechercher des mots

Tapez un ou plusieurs mots et appuyez sur Entrée. cf-dam trouve les photos où **chaque** mot apparaît dans l’un de ces éléments :

- le nom du fichier (`IMG_2041-final` est trouvé par `2041` ou `final`) ;
- le titre et la légende ;
- les mots-clés, **y compris ceux au-dessus et leurs synonymes** : une photo avec le mot-clé *Bergen* (sous *Places › Norway*) est trouvée par `norway` ;
- l’appareil et l’objectif ;
- le lieu : ville, État, pays, sous-lieu ;
- ce que l’[analyse par IA](/help/ai-review) a vu, et tout texte qu’elle a lu dans l’image (un panneau, un document) ;
- le crédit, le créateur, la source et les détails de la commande.

Les mots correspondent à partir de leur début : `heron` trouve *herons*, `port` trouve *portrait*. La recherche se combine avec les filtres que vous avez choisis : vous pouvez donc chercher dans une seule année ou un seul mot-clé.

## La recherche par le sens

Parfois, personne n’a noté le mot auquel vous pensez. **Rechercher par le sens** cherche les photos dont les descriptions *veulent dire* la même chose, avec d’autres mots :

- `bird flying over water` trouve la légende d’un goéland qui dit *in mid-flight above the sea* ;
- `small bird perched on a branch` trouve des colibris et des pinsons ;
- cela fonctionne aussi dans d’autres langues : `pájaro en el agua` trouve les oiseaux aquatiques.

Après une recherche de mots, appuyez sur **Rechercher par le sens** sous le titre pour l’essayer. Les résultats arrivent du plus proche au plus éloigné, et **Rechercher plutôt les mots** vous ramène en arrière.

La page de chaque photo propose aussi **Plus de photos similaires**, qui trouve des photos aux descriptions semblables.

### Ce dont elle a besoin

La recherche par le sens lit les **mots écrits sur une photo** (titre, légende, mots-clés, lieu et description de l’IA), pas les pixels. Une photo sur laquelle rien n’est écrit ne peut pas être trouvée ainsi : elle fonctionne donc mieux une fois que l’[analyse par IA](/help/ai-review) a décrit vos photos. Les photos nouvelles ou modifiées y sont ajoutées en une minute ou deux.

C’est votre administrateur qui l’active : si vous ne voyez pas **Rechercher par le sens**, elle n’est pas configurée sur vos archives. (La configuration tient en une commande, décrite dans le README de cf-dam.)

## Enregistrer une recherche

Appuyez sur **Enregistrer cette recherche** dans les filtres de la photothèque pour garder les mots de recherche et les filtres actuels sous un nom. Les recherches enregistrées apparaissent en haut des filtres, avec le nombre de photos qui correspondent.
