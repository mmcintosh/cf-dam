---
title: "Email"
summary: "Sending invitations, password resets and gallery emails from your own domain: setting it up, turning it on, and what to do when it stops."
section: Settings
order: 2
---

cf-dam can send email from your own domain: invitations, password resets, and messages about client galleries. Until it can, those are links you copy and pass on yourself, and everything else works as usual.

Email is set up under **Setup → Email**. Only administrators see it.

## What you need

- Your domain on **Cloudflare DNS** (the same Cloudflare account cf-dam runs in).
- The **Workers Paid** plan. Sending is included up to 3,000 emails a month; Cloudflare charges a small amount beyond that.
- An address to send from. A **subdomain** is best, for example `cf-dam@dam.yourstudio.com`: mail to and from your main address stays exactly as it is, and client emails build their own reputation.

## Setting it up

1. In the Cloudflare dashboard, open **Email Service → Email Sending** and add the domain you'll send from (for example `dam.yourstudio.com`).
2. When it shows the DNS records it wants to add, accept the three **cf-bounce** records.
   - **Don't** let it add or replace a `_dmarc` record if you already have one. Two DMARC records break DMARC for all your mail.
   - **Don't** turn on **Email Routing** for a domain whose mail is handled somewhere else (Google, Microsoft, Purelymail…): it would take over that domain's incoming mail.
3. Beside cf-dam's code, in a file called `.env.deploy`, put the sending address: `MAIL_FROM=cf-dam@dam.yourstudio.com`.
4. Deploy again. The deploy checks that the domain can send and adds email only when it can; otherwise it says why and carries on without it.
5. Open **Setup → Email**, fill in your **Studio name** and the address **Replies go to** (your real inbox), and press **Turn email on**.

Turning email on fixes the web address that links in emails point to: the one you're using at that moment, shown on the page. If you move cf-dam to a new address later, open Setup → Email from the new address and press **Use this address**.

## Checking it works

**Send me a test email** sends one to you at once and says straight away if it couldn't. Look in your spam folder too the first time.

The page also shows when the last email went, how many went in the last 24 hours, what's waiting, and the last problem.

## What's sent

- **Forgot your password?** on the sign-in page: a link to choose a new password, and then a note that it changed. See [Your account and sign-in](/help/account-security).
- **Invitations**: to clients you invite to a gallery or add to a client's page, and to new team members choosing their own password, when **Email the invitation to them** (or the team box) is ticked. See [Client galleries](/help/client-galleries) and [People and roles](/help/people-and-roles).
- **About galleries**: **Email the members**, a reminder three days before a gallery closes, and a note to you when a client finishes choosing. Clients can turn these off for each gallery.
- **Problems**: to the people who see alerts, when something new needs attention. See [Alerts and activity](/help/alerts-and-activity).

Every email comes from your studio's name, and replies go to the address you set.

## When something goes wrong

- If the sending service refuses the account or the sending address, email **stops** (nothing more is sent, so nothing piles up as failures), and an alert says so under **Team → Alerts**. Fix it in Cloudflare, then send a test email: when it gets through, sending starts again and whatever was waiting goes.
- A message that fails for a passing reason is tried again a few minutes later, three times in all.
- If the day's sending limit is reached, what's left waits until the next day, with an alert.
- An address that bounced before is left out by the sending service; the message is marked as not delivered.

## What's kept

Each email waits in an outbox until it's sent. Links that sign someone in or set a password are removed from it as soon as the email has gone, and a message whose link has expired is never sent. The outbox isn't part of catalogue backups, and entries go after 90 days.

## The staging copy

A staging copy of cf-dam may hold copies of real clients, so it only ever emails the addresses on its allow list (`STAGING_MAIL_ALLOW_TO` in `.env.deploy`). Everything else is dropped, never sent.
