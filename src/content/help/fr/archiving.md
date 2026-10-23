---
title: "Archiver et restaurer les originaux"
summary: "Garder une copie sûre et bon marché de chaque original dans Amazon Glacier, et récupérer une photo quand vous en avez besoin."
section: Where photos are kept
order: 3
review: machine
source: f92f0190ae52
---

Une **archive** est une copie de vos originaux placée en lieu sûr et à bas prix, pour le jour où un disque lâche ou un NAS est volé. **Glacier Deep Archive** d’Amazon garde un téraoctet pour environ un dollar par mois. Le revers : récupérer un fichier prend des heures. C’est donc fait pour conserver, pas pour l’usage quotidien.

cf-dam peut archiver de deux façons, selon l’endroit où se trouvent vos originaux.

## Originaux sur un NAS ou un ordinateur

L’assistant de votre NAS ou de votre ordinateur peut copier lui-même chaque original vers un bucket S3.

1. Connectez d’abord un bucket sur la page **Stockage** (voir [Connecter Amazon S3](/help/amazon-s3)).
2. Sur **Ordinateurs et NAS**, trouvez l’assistant et, sous **Archiver les originaux**, appuyez sur **Configurer l’archivage**.
3. Choisissez le **Bucket** et la **Classe de stockage** : **Deep Archive** pour la conservation la moins chère.
4. Choisissez les heures où il peut travailler (**De** et **À**, selon l’horloge de l’assistant), par exemple la nuit, et une limite de débit en Mbit/s pour qu’il ne sature pas votre connexion internet. La même heure dans les deux signifie à tout moment ; 0 Mbit/s signifie sans limite.
5. Enregistrez.

L’assistant copie chaque original une fois qu’il est resté inchangé une journée (pour ne pas archiver un fichier que vous êtes encore en train de retoucher), et vérifie chaque morceau à son arrivée. Il ne fait que **lire** vos fichiers : il ne les modifie ni ne les supprime jamais. Le panneau montre ce qui a été envoyé, ce qui reste et à peu près le temps que cela prendra.

Vous pouvez **Modifier** les réglages ou **Arrêter l’archivage** à tout moment. Ce qui est déjà dans le bucket y reste.

## Originaux déjà dans un bucket

Pour une photo dont l’original est dans S3, sa page indique où il se trouve et permet de le **Déplacer** vers une autre classe de stockage, par exemple de Standard vers Deep Archive.

> Amazon facture une **durée minimale** : 30 jours pour les classes IA, 90 jours pour Glacier et 180 jours pour Deep Archive. Sortir une photo plus tôt coûte quand même toute la période : ne déplacez donc que les photos que vous êtes sûr de ne plus toucher.

## Récupérer une photo depuis Glacier

Un fichier dans Glacier ou Deep Archive ne peut pas être ouvert immédiatement. Amazon doit d’abord en rapporter une copie :

1. Ouvrez la page de la photo. Sous le stockage de l’original, choisissez la vitesse :

   | Vitesse | Glacier Flexible Retrieval | Deep Archive | Coût |
   | --- | --- | --- | --- |
   | **Accélérée** | quelques minutes | non proposée | le plus élevé |
   | **Standard** | 3 à 5 heures | sous 12 heures | environ 20 $ par To depuis Deep Archive |
   | **Groupée** | 5 à 12 heures | sous 48 heures | le plus bas : environ 2,50 $ par To depuis Deep Archive |

2. Choisissez la durée dans **Garder restauré pendant** (la copie disparaît ensuite, et l’original reste archivé).
3. Appuyez sur **Demander la restauration**.

cf-dam suit la restauration tout seul et indique quand elle est prête ; **Vérifier l’état** interroge Amazon immédiatement. Une fois restaurée, la photo peut être téléchargée normalement jusqu’à l’expiration de la copie.

Vos vignettes et aperçus ne sont jamais dans Glacier : vous pouvez toujours voir, rechercher, taguer et partager chaque photo, même quand son original est dans l’archive la plus profonde.
