---
title: "E-mail"
summary: "Envoyer les invitations, les réinitialisations de mot de passe et les e-mails des galeries depuis votre propre domaine : la configuration, l’activation, et que faire quand ça s’arrête."
section: Settings
order: 2
review: machine
source: 8e0e5ced3038
---

cf-dam peut envoyer des e-mails depuis votre propre domaine : invitations, réinitialisations de mot de passe et messages concernant les galeries clients. Tant qu’il ne le peut pas, ce sont des liens que vous copiez et transmettez vous-même, et tout le reste fonctionne comme d’habitude.

L’e-mail se configure dans **Configuration → E-mail**. Seuls les administrateurs le voient.

## Ce qu’il vous faut

- Votre domaine sur **Cloudflare DNS** (le même compte Cloudflare que celui où tourne cf-dam).
- L’offre **Workers Paid**. L’envoi est inclus jusqu’à 3 000 e-mails par mois ; au-delà, Cloudflare facture un petit montant.
- Une adresse d’envoi. Un **sous-domaine** est préférable, par exemple `cf-dam@dam.yourstudio.com` : le courrier vers et depuis votre adresse principale reste exactement tel quel, et les e-mails aux clients se construisent leur propre réputation.

## La configuration

1. Dans le tableau de bord Cloudflare, ouvrez **Email Service → Email Sending** et ajoutez le domaine depuis lequel vous enverrez (par exemple `dam.yourstudio.com`).
2. Quand il affiche les enregistrements DNS qu’il veut ajouter, acceptez les trois enregistrements **cf-bounce**.
   - **Ne le laissez pas** ajouter ou remplacer un enregistrement `_dmarc` si vous en avez déjà un. Deux enregistrements DMARC cassent DMARC pour tout votre courrier.
   - **N’activez pas** **Email Routing** pour un domaine dont le courrier est géré ailleurs (Google, Microsoft, Purelymail…) : il prendrait le contrôle du courrier entrant de ce domaine.
3. À côté du code de cf-dam, dans un fichier nommé `.env.deploy`, indiquez l’adresse d’envoi : `MAIL_FROM=cf-dam@dam.yourstudio.com`.
4. Déployez à nouveau. Le déploiement vérifie que le domaine peut envoyer et n’ajoute l’e-mail que s’il le peut ; sinon, il dit pourquoi et continue sans.
5. Ouvrez **Configuration → E-mail**, remplissez le **Nom du studio** et l’adresse **Les réponses vont à** (votre vraie boîte de réception), puis appuyez sur **Activer l’e-mail**.

Activer l’e-mail fixe l’adresse web vers laquelle pointent les liens des e-mails : celle que vous utilisez à ce moment-là, affichée sur la page. Si vous déplacez plus tard cf-dam vers une nouvelle adresse, ouvrez Configuration → E-mail depuis la nouvelle adresse et appuyez sur **Utiliser cette adresse**.

## Vérifier que ça marche

**M’envoyer un e-mail de test** vous en envoie un tout de suite et vous dit immédiatement s’il n’a pas pu. La première fois, regardez aussi dans votre dossier de spam.

La page indique aussi quand le dernier e-mail est parti, combien sont partis ces dernières 24 heures, ce qui attend, et le dernier problème.

## Quand quelque chose ne va pas

- Si le service d’envoi refuse le compte ou l’adresse d’envoi, l’e-mail **s’arrête** (plus rien n’est envoyé, donc rien ne s’accumule en échecs), et une alerte le signale dans **Équipe → Alertes**. Corrigez le problème dans Cloudflare, puis envoyez un e-mail de test : dès qu’il passe, l’envoi reprend et tout ce qui attendait part.
- Un message qui échoue pour une raison passagère est réessayé quelques minutes plus tard, trois fois en tout.
- Si la limite d’envoi du jour est atteinte, le reste attend le lendemain, avec une alerte.
- Une adresse qui a déjà rejeté un message (bounce) est écartée par le service d’envoi ; le message est marqué comme non distribué.

## Ce qui est conservé

Chaque e-mail attend dans une boîte d’envoi jusqu’à ce qu’il soit envoyé. Les liens qui connectent quelqu’un ou permettent de définir un mot de passe en sont retirés dès que l’e-mail est parti, et un message dont le lien a expiré n’est jamais envoyé. La boîte d’envoi ne fait pas partie des sauvegardes du catalogue, et les entrées disparaissent après 90 jours.

## La copie de staging

Une copie de staging de cf-dam peut contenir des copies de vrais clients ; elle n’envoie donc jamais d’e-mails qu’aux adresses de sa liste autorisée (`STAGING_MAIL_ALLOW_TO` dans `.env.deploy`). Tout le reste est écarté, jamais envoyé.
