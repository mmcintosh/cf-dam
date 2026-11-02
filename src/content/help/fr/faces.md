---
title: "Trouver les visages"
summary: "Laisser cf-dam trouver les visages sur vos photos pour nommer les personnes d’un clic, et ce qui est conservé."
section: Your photos
order: 11
review: machine
source: 73ecb5d3191d
---

**Trouver les visages** affiche sur la page d’une photo, sous **Personnes**, une petite image de chaque visage trouvé. Cliquez sur l’une d’elles et saisissez de qui il s’agit : la photo est identifiée avec cette personne, comme si vous aviez ajouté le nom à la main. Cela évite de taper sur les photos de plusieurs personnes, et c’est ainsi que la page d’une personne obtient une image de son visage.

Il s’agit de **trouver, pas de reconnaître**. cf-dam ne détermine jamais qui est quelqu’un et ne compare jamais un visage à un autre. Vous nommez vous-même chaque visage.

## Ce qui est conservé

Pour chaque visage : un cadre (l’endroit où se trouve le visage sur la photo) et le degré de certitude du détecteur. Rien d’autre : aucun trait du visage, aucune « empreinte faciale », rien qui puisse à lui seul identifier quelqu’un. Le détecteur (BlazeFace de Google) repère aussi les yeux, le nez et la bouche ; cf-dam l’écarte avant que quoi que ce soit soit enregistré.

Les visages sont trouvés sur vos propres machines, par votre assistant (le programme de votre NAS ou de votre ordinateur qui catalogue vos photos). Les photos et les visages ne sont jamais envoyés à qui que ce soit pour cela. **Les clients ne voient jamais les visages** : ni dans les galeries, ni dans les téléchargements, ni dans les fichiers.

## L’activer

Dans **Configuration → Analyse par IA → Trouver les visages**, lisez ce que cela implique (voir [Les visages et la loi](/help/faces-and-the-law)), cochez **J’ai lu ceci** et appuyez sur **Activer « Trouver les visages »**. Il faut l’autorisation de modifier les réglages (les administrateurs par défaut). Ensuite :

- votre assistant examine chaque nouvelle photo en créant son aperçu, et traite les photos plus anciennes en arrière-plan, quelques centaines par minute ;
- les photos importées par le site web sont examinées depuis leur album : sur la page d’un album (ou d’un travail), **Trouver les visages de cet album** traite les photos pas encore examinées, dans cet onglet. Laissez l’onglet ouvert (et au premier plan sur un téléphone) jusqu’à la fin ; le fermer arrête, et le reste attend la prochaine fois. Un onglet traite quelques milliers de photos par heure. Juste après un import, la zone d’import propose la même chose pour les photos qui viennent d’être envoyées.

Votre assistant doit être à jour : une version plus ancienne continue comme avant, sans visages.

## Nommer les visages

Sur la page d’une photo, cliquez sur un visage :

- saisissez un nom (les personnes déjà nommées sont proposées) et appuyez sur **Nommer** ;
- **Personne à nommer** pour un passant, un visage sur une affiche ou une statue : il est mis de côté et n’est plus proposé (**Afficher** fait revenir les visages mis de côté) ;
- **Retirer le nom** enlève le nom de ce visage ; si aucun autre visage de la photo ne porte ce nom, la personne est aussi retirée de la photo.

Retirer quelqu’un d’une photo sous **Personnes** retire aussi son nom de son visage sur cette photo. Fusionner deux personnes déplace leurs visages ; supprimer une personne met ses visages de côté, pour qu’ils ne soient plus proposés.

Nommer un visage change aussitôt ce que le couple peut trouver dans une galerie, si la galerie liste cette personne (voir [Personnes dans une galerie client](/help/people-in-galleries)).

## En nommer plusieurs à la fois

Sur la page d’un album (ou d’un travail), **Visages à nommer** affiche les visages trouvés là que personne n’a nommés ni mis de côté, les plus grands d’abord. Cochez plusieurs visages de la même personne, saisissez ou choisissez son nom une fois et appuyez sur **Nommer** : chaque visage coché est nommé et chaque photo identifiée. **Personne à nommer** met les visages cochés de côté. **Photo** sous un visage ouvre sa photo.

## Sa fiabilité

Il trouve la plupart des visages jusqu’à environ 3 % de la largeur d’une photo : les derniers rangs d’un groupe d’une vingtaine de personnes. Il manque souvent les visages en partie cachés (derrière une autre tête, une main ou un téléphone) ou nettement tournés de côté, et encadre parfois quelque chose qui n’est pas un visage, comme une robe à motifs. Toute personne manquée peut être nommée à la main sur la photo, comme toujours.

Trouver les visages ne change jamais le nombre de **Personnes** d’une photo ; la page affiche les deux.

## Mettre en pause et supprimer

**Mettre en pause** arrête immédiatement toute recherche ; tout ce qui a été trouvé reste, et vous pouvez toujours nommer les visages. Une fois réactivé, il reprend là où il s’était arrêté.

**Supprimer tous les cadres de visage…**, en pause, efface chaque visage trouvé par le détecteur, nommé ou non. Les noms restent sur les photos comme identifications ordinaires. Cela se fait en arrière-plan, quelques milliers par minute.

## S’il n’apparaît pas

Une installation peut être configurée sans recherche de visages. **Trouver les visages** indique alors qu’elle ne fait pas partie de cette installation, et rien ne concerne les visages nulle part.
