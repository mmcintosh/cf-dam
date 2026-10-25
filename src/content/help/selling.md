---
title: "Selling photos"
summary: "Letting clients buy digital files from their gallery: connecting Stripe, price lists, orders, refunds and what you're responsible for."
section: Sharing
order: 5
---

Clients can buy digital files from their gallery and pay with Stripe, on your own Stripe account. The money goes to you; cf-dam takes no commission. Prints come later.

## What you need

- A **Stripe** account (stripe.com). Try everything first with Stripe's **test mode**: no real money moves, and cf-dam shows **Test mode** while you're in it.
- To be ready to act as the seller: sales tax or VAT, refunds and receipts are yours to handle. Stripe can calculate and collect tax for you, but you register and file.

## Connecting Stripe

Under **Client work → Orders**, the **Selling** section walks you through it (administrators only):

1. In Stripe, **Developers → API keys**, create a **restricted key** that can write Checkout Sessions and read Charges and Payment Intents. Paste it into **Stripe restricted key**.
2. In Stripe, **Developers → Webhooks**, add an endpoint at the address shown, with the events listed beside it.
3. Copy that endpoint's **signing secret** (it starts with `whsec_`) into **Webhook signing secret**, **Save**, then press **Check**.

The key and secret are stored encrypted, never shown again, and left out of catalogue backups (enter them again after restoring into a new install). Under **You, the seller**, choose the **Currency** (it can't change once prices or orders use it), your **Business name**, and the **Terms and refunds** shown on Stripe's payment page.

## Price lists

A price list says what **Small**, **Large** and **Full size** cost, and what **Every photo** in a gallery costs at once. Leave a price empty to not sell that size. Make as many lists as you like (for weddings, for portraits…), then choose one for a gallery under its link, in **Sells with**.

- A size the gallery already gives away free isn't sold there.
- **Small** and **Large** are made from the photo as clients see it (your rotation and crop included), without the watermark.
- **Full size** is the original file, so it's offered only for JPEG and PNG originals you haven't rotated or cropped in cf-dam, and only while the original can be read now (not on a NAS, not in deep archive storage).

## What clients see

In the gallery, the large view of a photo has **Buy…** with each size and its price, and the top of the gallery has **Buy every photo** when that has a price. They pay on Stripe's own page (card, Apple Pay, Google Pay, Link) and come back to their **order page**: its address is their link to the files, on any device. The gallery also shows what they bought, in the browser they bought it with.

## Orders

**Client work → Orders** lists what's been bought: when, by whom, from which gallery, the total and its state.

- **Paid**: downloads work.
- **To check**: Stripe says it's paid, but the amount didn't match what was ordered. Nothing is downloadable until you've looked; settle it in Stripe (refund, or contact the client).
- **Refunded** and **Disputed**: downloads stop. Make refunds in your Stripe dashboard; the order here follows by itself.
- **Being paid** and **Not paid**: a client left the payment page; nothing was charged.

If Stripe's message about a payment goes astray, cf-dam asks Stripe itself a few minutes later, so a paid order never gets stuck.
