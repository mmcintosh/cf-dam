---
title: "Votre compte et la connexion"
summary: "Clés d’accès, connexion en deux étapes, votre mot de passe, les endroits où vous êtes connecté et les clés d’API."
section: People and security
order: 2
review: machine
source: 1f368c995355
---

Votre page **Compte** (le dernier élément du menu) regroupe tout ce qui concerne votre connexion. C’est aussi là que se trouve [Apparence et accessibilité](/help/appearance).

Vos archives contiennent des années de travail et des moments privés, alors cela vaut cinq minutes pour sécuriser la connexion.

## Les clés d’accès : le moyen le plus simple et le plus sûr

Une **clé d’accès** vous permet de vous connecter avec votre empreinte, votre visage ou le code PIN de votre appareil, ou avec un gestionnaire de mots de passe comme 1Password, au lieu d’un mot de passe. Il n’y a rien à taper et rien qu’un faux site web puisse voler.

1. Sous **Clés d’accès**, appuyez sur **Ajouter une clé d’accès**.
2. Votre navigateur ou votre gestionnaire de mots de passe vous demande où la garder ; suivez ses étapes.

Ajoutez-en une sur chaque appareil que vous utilisez (ou une dans un gestionnaire de mots de passe qui les synchronise ; la liste indique alors **synchronisée**). Par sécurité, l’ajout d’une clé d’accès exige une connexion de moins de 15 minutes : si on vous le demande, déconnectez-vous, reconnectez-vous, puis ajoutez-la.

## La connexion en deux étapes avec une application d’authentification

Si vous vous connectez avec un mot de passe, ajoutez une deuxième étape : un code à six chiffres venant d’une application sur votre téléphone (Google Authenticator, Microsoft Authenticator, 1Password, Authy et d’autres).

1. Sous **Connexion en deux étapes**, appuyez sur **Configurer la connexion en deux étapes** et confirmez votre mot de passe.
2. Scannez le code avec votre application d’authentification (ou tapez la clé affichée sous **Impossible de scanner ?**).
3. Tapez le code affiché par l’application et appuyez sur **Vérifier et activer**.
4. **Conservez les codes de secours** en lieu sûr, par exemple dans votre gestionnaire de mots de passe ou sur papier. Chacun fonctionne une fois si vous perdez votre téléphone. Ils ne seront plus affichés.

Vous n’avez pas besoin de codes quand vous vous connectez avec une clé d’accès. Votre administrateur peut exiger l’un ou l’autre pour tout le monde (voir [Personnes et rôles](/help/people-and-roles)).

**Vous avez perdu votre téléphone et vos codes de secours ?** Demandez à un administrateur : sur **Personnes**, **Téléphone ou clé d’accès perdu** désactive vos codes pour que vous puissiez les reconfigurer.

## Votre mot de passe

Au moins 12 caractères. Une courte phrase dont vous vous souviendrez vaut mieux qu’un fouillis que vous oublierez. Changez-le sous **Mot de passe** : tapez l’actuel, puis le nouveau. Après trop de tentatives incorrectes, le compte est bloqué pendant un moment, et un administrateur peut le débloquer.

Oublié ? Quand cette archive peut envoyer des e-mails (voir [E-mail](/help/email)), la page de connexion propose **Mot de passe oublié ?** : saisissez votre adresse et un lien pour choisir un nouveau mot de passe arrive, valable une fois, pendant une heure. Il ferme aussi toutes les autres connexions, lève un blocage, et vous recevez un e-mail indiquant que le mot de passe a changé. La connexion en deux étapes demande toujours son code. Sans e-mail, demandez à un administrateur un mot de passe temporaire.

## Où vous êtes connecté

Chaque navigateur reste connecté jusqu’à une semaine d’inactivité. **Où vous êtes connecté** les liste, en signalant **Ce navigateur**. **Déconnectez** ceux que vous ne reconnaissez pas, puis changez votre mot de passe.

## Clés d’API

Pour les scripts et autres programmes qui travaillent avec vos archives, comme un script d’export. Une clé ne peut faire que ce que vous pouvez faire, limitée aux **portées** que vous choisissez, et peut expirer. La clé n’est affichée **qu’une fois**, à sa création : copiez-la à ce moment-là. Ne partagez jamais de clés et ne les mettez jamais dans un e-mail.

La plupart des gens n’en ont jamais besoin. Les assistants sur votre NAS et vos ordinateurs reçoivent leurs propres clés lors de l’appairage ; vous ne les créez pas ici.
