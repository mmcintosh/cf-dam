---
title: "Analyse par IA"
summary: "Laisser un modèle d’IA décrire vos photos, ce que cela coûte, et comment vous gardez la main sur ce qu’il écrit."
section: Your photos
order: 5
review: machine
source: 48fdc91af68c
---

L’analyse par IA examine chaque photo et rédige des suggestions : un **texte alternatif**, une **légende**, une description plus longue de **ce qu’elle a vu**, tout **texte dans l’image** (panneaux, documents), des **mots-clés** suggérés et une note sur la qualité. Elle rend de grandes archives consultables d’une façon que personne n’a le temps de faire à la main, et c’est ce que lit la [recherche par le sens](/help/search).

Elle fonctionne avec **Workers AI dans votre propre compte Cloudflare**. Vos photos ne sont envoyées à aucune autre entreprise, et le modèle n’apprend pas à partir d’elles.

## Vous gardez la main

Rien de ce que l’IA écrit ne remplace vos propres mots sans votre accord. Sur la [page d’une photo](/help/photo-page), sous **Suggestions de l’IA** :

- **Utiliser celui-ci** copie une suggestion dans un champ vide ; **Remplacer le mien** écrase ce qui s’y trouve.
- Les mots-clés suggérés sont consultables tout de suite, marqués comme venant de l’IA. **✓** en garde un comme le vôtre, **×** le retire, **Tout garder** les garde tous.
- **Analyser** relance l’analyse (après avoir modifié le contexte ci-dessous, par exemple).

Pour accepter les suggestions de nombreuses photos à la fois, sélectionnez-les dans la photothèque et utilisez **IA…** : **Utiliser les légendes de l’IA là où elles sont vides**, **Utiliser le texte alternatif de l’IA là où il est vide**, **Garder les tags de l’IA** ou **Analyser à nouveau**.

## La page Analyse par IA

**Analyse par IA** dans le menu indique combien de photos sont **analysées**, **en file d’attente**, **jamais analysées** et **en échec**, et ce que cela coûte pour 1 000 photos de vos archives.

### Réglages (administrateurs)

- **Analyse par IA :** activée ou désactivée. Désactivée, toute analyse s’arrête ; les suggestions déjà faites sont conservées.
- **Analyser les nouvelles importations :** chaque nouvelle photo est mise en file dès qu’elle a un aperçu. Les photos venues d’un assistant sont mises en file après le premier passage sur un dossier.
- **Modèle :** le modèle d’IA à utiliser. La page indique les points forts de chacun.
- **À propos de votre travail :** une phrase sur vous, transmise au modèle avec chaque photo pour que ses mots-clés correspondent à vos archives, par exemple *« Photographe de mariage et de paysage dans l’ouest de la Norvège »* ou *« Photographie d’oiseaux, surtout dans les zones humides de Floride »*.

### Tout analyser d’un coup

Si certaines photos n’ont jamais été analysées, **Analyser le fonds existant** indique combien, et à peu près ce que cela coûtera. Appuyez sur **Mettre en file** pour commencer. Les photos sont traitées en arrière-plan, plusieurs à la fois ; vous pouvez continuer à travailler. Une photo en échec est réessayée deux ou trois fois, puis marquée **en échec** avec la raison.

## Personnes sur les photos

À côté de l’analyse par IA, **Jev**, de TypeSafe, cherche les personnes sur chaque nouvelle photo, et combien il y en a, pour le filtre **Personnes** de la photothèque. Il est plus rapide et moins cher que l’analyse par IA (environ 9 cents pour 1 000 photos) et, lors d’un test sur 805 photos, il a trouvé des personnes sur 87 là où l’analyse par IA en trouvait 47, surtout de petites silhouettes à l’arrière-plan. Il n’écrit aucun texte.

- **Ce qui est envoyé :** une copie de 1 024 px de chaque photo, sans nom de fichier, données de l’appareil ni lieu, part chez TypeSafe (api.typesafe.ai). TypeSafe dit ne pas s’en servir pour l’entraînement.
- **Photos plus anciennes :** le panneau **Personnes sur les photos** de cette page compte ce qui a été trouvé (chaque nombre ouvre ces photos dans la photothèque) et **Regarder N photos pas encore regardées** s’occupe du reste.
- **Interrupteurs :** **Chercher les personnes** désactivé, plus rien n’est envoyé à TypeSafe (les réponses déjà obtenues restent et le filtre continue de fonctionner) ; **Sur les nouvelles photos dès leur arrivée** désactivé, les nouvelles photos attendent le bouton.
- **Mauvaises réponses :** corrigez-en une sur la page de la photo, ou plusieurs à la fois dans la photothèque (sélectionnez-les, puis **Personnes…**). Jev ne modifie jamais une réponse donnée à la main, et **Revenir à la réponse de Jev** l’annule.
- **Les photos qui n’ont pas pu être regardées** sont listées avec la raison : trop petites, refusées par TypeSafe ou en échec trois fois (avec **Réessayer**).
- Les vidéos ne sont pas examinées, ni les photos de moins de 280 pixels de côté.

## Ce que ça coûte

Workers AI est facturé en **neurones**. Cloudflare offre 10 000 neurones gratuits par jour, puis facture 0,011 $ les 1 000.

Un exemple réel : analyser 662 photos d’oiseaux a utilisé environ 30 000 neurones, soit environ **33 cents**, ou environ 22 cents après la part gratuite quotidienne. Cela fait à peu près 50 cents pour 1 000 photos. La page Analyse par IA affiche le chiffre pour vos propres archives.

## Est-ce que c’est bien fait ?

Elle est douée pour ce que montre une image (*un héron cendré debout en eau peu profonde parmi les roseaux*) et pour lire du texte. Elle ne sait pas qui sont les gens, le nom des lieux qu’elle ne peut pas lire, ni l’histoire derrière une photo. C’est à vous de les ajouter. Considérez ses mots-clés comme une première passe, et son texte alternatif comme un brouillon.
