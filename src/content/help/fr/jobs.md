---
title: "Travaux"
summary: "Suivre chaque travail pour un client, de la réservation à la livraison : dates de la séance, étapes, albums, galeries et ce qui est à traiter."
section: Sharing
order: 4
review: machine
source: 3c44ab054383
---

Un **travail** est une prestation pour un client : un mariage, une séance portrait, une séance produit. Il garde les dates de la séance, le lieu, l’avancement du travail et ses albums. Ses galeries sont celles de ses albums. **Travaux** se trouve dans le menu, sous **Clients** ; comme les clients, seuls les **administrateurs** le voient.

## Créer un travail

- **Depuis la Photothèque**, la méthode habituelle, après la séance : filtrez la Photothèque sur les photos de la séance (un album, un mois, un dossier, un mot-clé), puis appuyez sur **Nouveau travail avec ces photos**. Le formulaire reprend les dates de la séance à partir des photos et propose de les mettre dans le premier album du travail.
- **Depuis la page d’un client** : là, **Nouveau travail** choisit le client pour vous.
- **Depuis Travaux** : **Nouveau travail**. Vous pouvez créer un nouveau client dans le même formulaire : choisissez **+ Nouveau client** et tapez son nom.

Donnez-lui un titre pour votre équipe (*Mariage Martin*) et, si vous le souhaitez, un **Nom vu par le client** (*Votre mariage*), le type de travail, la date de la séance (et le dernier jour, pour une séance sur plusieurs jours), le lieu et la date de livraison prévue.

## Étapes

Un travail passe par **Réservé**, **Photographié**, **Retouche**, **Sélection client**, **Retouches finales**, **Livré** et **Terminé**, ou il est **Annulé**. Appuyez sur une étape dans la page du travail pour l’y amener, en avant ou en arrière. **Sélection client** et **Retouches finales** (en pointillés) peuvent être sautées : une séance portrait ou une séance produit n’a souvent pas de sélection client.

Deux changements se font tout seuls, et l’historique l’indique :

- **Réservé → Photographié** quand des photos prises aux dates de la séance arrivent dans l’archive.
- **→ Livré** quand vous créez une galerie à partir d’un des albums du travail en cochant **Livraison finale** (voir [Galeries clients](/help/client-galleries)).

Tout le reste dépend de vous. **Terminé** sert quand le travail est fini et payé.

## Albums et galeries

Sur la page du travail, **Albums** liste ses albums avec leurs photos et leurs galeries :

- **Ajouter un album** met dans le travail un album que vous avez déjà. Un album appartient au plus à un travail ; une photo peut être dans plusieurs.
- **Nouvel album avec les photos des dates de la séance** en crée un avec toutes les photos prises ces jours-là.
- **Créer une galerie** ouvre l’album avec le formulaire de galerie prêt.
- **Retirer du travail** laisse l’album et ses galeries tels quels.

Un album qui fait partie d’un travail affiche un lien vers ce travail en haut de sa page.

## Originaux

**Originaux**, sur la page du travail, indique où se trouvent les fichiers originaux de ses photos :

- combien **sont lisibles maintenant** (depuis le stockage propre de l’archive, un ordinateur ou un NAS, ou une copie restaurée) ;
- combien **doivent être restaurés** : ils ne sont que dans une archive à froid (Glacier ou Deep Archive), donc personne ne peut les télécharger avant qu’ils soient récupérés ;
- combien ne sont **que sur un ordinateur ou un NAS** : vous pouvez les ouvrir, mais une galerie client ne peut pas les proposer en original ;
- combien ont une **sauvegarde à froid**, une copie dans Glacier ou Deep Archive. Tant que la copie propre de l’archive est conservée, une sauvegarde à froid ne rend pas une photo illisible.

La liste **Travaux** montre la même chose en bref : *Lisibles* ou *n à restaurer*, et *sauvegarde à froid* quand chaque photo en a une.

### Restaurer un travail

Avant une commande de retirages, par exemple, appuyez sur **Restaurer n originaux…**. Choisissez la **Vitesse** (*Bulk* : le moins cher, jusqu’à 48 heures ; *Standard* : plus rapide, jusqu’à 12 heures) et combien de jours garder les copies, puis **Voir le coût** : les sortir de l’archive, garder les copies, et ce que cela coûte si les clients les téléchargent tous une fois (souvent la plus grosse part). Puis confirmez. La page montre où en est la restauration, et jusqu’à quand les copies sont prêtes. Les originaux restent dans l’archive ; les copies restaurées disparaissent après les jours choisis.

Restaurer demande le droit de gérer les niveaux de stockage (les administrateurs l’ont).

Quand une galerie propose les originaux et que certains originaux de l’album sont archivés ou seulement sur un NAS, le formulaire de la galerie le signale avant que vous créiez le lien.

## Archiver après la livraison

Quand **Archiver les travaux livrés** est activé (sur la page **Stockage** : choisissez la connexion S3, **Deep Archive** ou **Glacier Flexible**, et combien de jours après la livraison), chaque original des albums d’un travail livré reçoit une copie dans cette classe à froid une fois ces jours passés. La copie gardée dans le stockage propre de cf-dam reste, donc rien ne devient plus lent à ouvrir : la copie à froid est une sauvegarde qui coûte très peu à garder.

- Avant de l’activer, **Qu’archiverait-il maintenant ?** montre combien de travaux, d’originaux et de Go il copierait d’un coup (chaque travail déjà livré depuis assez longtemps compte), ce que cela coûte par mois à garder et une fois à envoyer.
- Chaque partie d’une copie est vérifiée à son arrivée, et la taille de la copie est comparée à la fin. Une copie interrompue reprend là où elle s’est arrêtée.
- Livrer à nouveau un travail, après l’avoir ramené en **Retouche** par exemple, fait repartir ses jours de zéro.
- **Garder à chaud** sur la page d’un travail fait qu’il n’est jamais archivé automatiquement (retirages, albums en cours).
- **Archiver maintenant** copie un travail tout de suite, dans la classe que vous choisissez (demande le droit de gérer les connexions de stockage).
- Les originaux qui ne sont que sur un ordinateur ou un NAS sont archivés par son assistant quand ce dossier s’archive vers S3 (**Ordinateurs et NAS**) ; sinon, le travail indique combien sont laissés de côté.
- Les originaux qui n’ont pas pu être copiés après trois essais s’affichent sous forme d’alerte.

Sous **Originaux**, sur la page du travail, **Sauvegarde à froid** indique où il en est : quand il sera archivé, où en est une copie, quand il a été archivé, ou ce qui bloque.

## Ce qui est à traiter

En haut de **Travaux**, **À traiter** liste :

- une livraison prévue dans les 7 jours, ou en retard ;
- une séance d’il y a plus de 3 jours sans encore aucune photo ;
- une galerie d’un travail qui ferme dans les 7 jours ;
- une galerie de sélection sans favoris après 14 jours.

**En cours** montre les travaux ouverts par étape, la séance la plus proche d’abord ; **Livrés et terminés** et **Tous** montrent le reste. Recherchez par titre, lieu ou client ; les accents ne comptent pas.

## Supprimer un travail

**Supprimer le travail**, en bas de sa page (appuyez deux fois), supprime seulement le travail : ses albums et ses galeries restent. Effacer un client (voir [Clients](/help/clients)) supprime aussi ses travaux.
