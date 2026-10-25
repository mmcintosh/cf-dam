---
title: "Alertes et activité"
summary: "Les problèmes qui demandent quelqu’un, et l’historique de qui a fait quoi."
section: People and security
order: 3
review: machine
source: bf3a2942f6b3
---

Ces deux pages sont réservées aux administrateurs.

## Alertes

cf-dam se vérifie lui-même toutes les cinq minutes et lève une **alerte** quand quelque chose demande l’intervention d’une personne. Le menu indique combien sont ouvertes à côté d’**Alertes**.

| Alerte | Ce que cela signifie en général | Que faire |
| --- | --- | --- |
| Un assistant est hors ligne | Un NAS ou un ordinateur est éteint, en veille, ou a perdu sa connexion réseau. | Vérifiez qu’il est allumé. Après un changement de réseau, redémarrez l’assistant (ou son conteneur). |
| Un assistant n’a pas le droit de lire un dossier | L’ordinateur ou le NAS ne le laisse pas entrer : sur un Mac, l’accès au dossier Images, à un disque ou à un volume réseau lui a été refusé. | Sur un Mac : **Réglages Système → Confidentialité et sécurité → Fichiers et dossiers** (ou **Accès complet au disque**), autorisez `node`. Sur un NAS : les permissions du dossier. |
| Problèmes d’archivage | Un assistant n’a pas pu copier des originaux vers le bucket d’archivage. | L’alerte dit pourquoi : souvent les permissions du bucket. |
| Problèmes de stockage | Des originaux attendus par cf-dam n’étaient pas là où il le pensait, ou un bucket ne peut pas être lu. | Ouvrez **Stockage → Vérifications**. |
| Sauvegardes en échec ou en retard | La sauvegarde quotidienne du catalogue ne s’est pas terminée. | Voir [Sauvegardes](/help/backups) ; vérifiez le bucket de sauvegarde. |
| Aperçus bloqués | Certaines vignettes ou certains aperçus n’ont pas pu être créés. | **Stockage → Aperçus → Réessayer les bloqués**. |
| Tâches de fond en échec ou arrêtées | Le travail que cf-dam fait chaque minute (traitement, IA, vérifications, sauvegardes) rencontre une erreur ou ne s’est pas exécuté. | L’alerte dit quelle partie. Si tout est arrêté, cherchez des erreurs dans les journaux du Worker dans le tableau de bord Cloudflare, ou redéployez. |

Chaque alerte indique depuis quand, et propose **Aller à** la page qui permet de régler le problème. Quand le problème est résolu, l’alerte se ferme toute seule et passe dans **Résolues ces deux dernières semaines**.

**Ignorer** retire une alerte du décompte pendant que vous vous en occupez (ou si vous avez décidé qu’elle n’a pas d’importance). Elle compte à nouveau si elle revient après avoir été résolue ; **La recompter** annule le fait de l’ignorer.

### Par e-mail

Quand cette archive peut envoyer des e-mails (voir [E-mail](/help/email)), les personnes qui voient les alertes reçoivent aussi un e-mail quand une nouvelle alerte s’ouvre : au plus un par jour pour chaque type de problème, avec la liste de ce qui est ouvert et un lien vers cette page. Un assistant de bureau qui se tait (un portable en veille) ne donne pas lieu à un e-mail, pas plus que les problèmes liés à l’e-mail lui-même. Désactivez ces e-mails, ou réactivez-les, dans **Compte → E-mails en cas de problème**.

## Activité

**Activité** est l’historique de qui s’est connecté, et de qui a modifié quoi, du plus récent au plus ancien : connexions (y compris celles qui ont échoué), personnes ajoutées ou modifiées, rôles, changements de connexion en deux étapes, connexions de stockage, importations, suppressions, galeries partagées, analyses par IA mises en file, réglages modifiés, et tâches de fond comme les sauvegardes et les vérifications.

Affinez-la par **Type** d’événement, ou par **Personne**. C’est le premier endroit où regarder quand quelque chose a changé sans que vous sachiez comment.
