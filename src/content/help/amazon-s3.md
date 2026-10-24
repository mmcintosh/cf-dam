---
title: "Connecting Amazon S3"
summary: "A step-by-step guide, from opening an Amazon Web Services account to cf-dam keeping originals in it."
section: Where photos are kept
order: 2
---

Amazon is best known as a shop, but it also rents out storage through a separate business, **Amazon Web Services (AWS)**. Its storage service is called **S3**. Many photographers use it because one part of it, **Glacier Deep Archive**, keeps a terabyte for about a dollar a month.

This guide takes you from nothing to cf-dam storing originals in S3. Allow about 30 minutes the first time. You'll need an email address, a phone, and a credit or debit card.

> You don't need Amazon to use cf-dam. Originals can stay in Cloudflare's own storage, or on your NAS. Come back to this when you want cheap long-term storage.

## 1. Open an AWS account

Your AWS account is separate from any Amazon shopping account, even if it uses the same email.

1. Go to [aws.amazon.com](https://aws.amazon.com) and choose **Create an AWS account**.
2. Give an email address and an account name (your studio's name is fine). AWS emails you a code to confirm the address.
3. Choose a strong password. This first sign-in is the **root user**: the all-powerful owner of the account. Keep its password in your password manager.
4. Fill in your contact details and a payment card. AWS may place a small temporary charge to check the card.
5. Confirm your phone number with the code AWS sends.
6. Choose a plan. New accounts start with some free credit either way.

> **About the Free plan:** at the time of writing, the Free plan ends after six months (or when the credit runs out), and an account that isn't upgraded by then is closed, with its files. An archive is meant to last, so either choose the **Paid** plan from the start or set a reminder to upgrade. You only pay for what you use.

## 2. Protect the account

Before storing anything:

1. Sign in, open the menu under your account name (top right) and choose **Security credentials**.
2. Under **Multi-factor authentication (MFA)**, choose **Assign MFA device** and add a passkey, an authenticator app or a security key. From now on, signing in as the root user needs it.
3. Set a spending alert: search the console for **Budgets**, choose **Create budget**, pick the monthly cost template and give a small amount, such as $10, and your email. AWS emails you if the month's costs pass it.

## 3. Make a bucket

A **bucket** is a named storage space. One is enough for cf-dam.

1. In the search box at the top of the AWS console, type **S3** and open it.
2. Choose **Create bucket**.
3. **Bucket name:** lowercase letters, numbers and hyphens, such as `smith-studio-archive`. It must be unique across all of AWS, so add something of your own.
4. **Region:** pick the one nearest you (for example **US East (N. Virginia)** is `us-east-1`; **Europe (London)** is `eu-west-2`). Note the code: cf-dam asks for it.
5. Leave **Block all public access** turned on. Your photos stay private; cf-dam doesn't need them public.
6. Leave the other settings as they are and choose **Create bucket**.

## 4. Connect it to cf-dam

There are two ways for cf-dam to sign in to your bucket. **Keyless** is safer: no password-like secret is ever stored. Use **access keys** if keyless doesn't work for you, for example if your cf-dam isn't on `https`.

### Keyless (recommended)

You'll need your **AWS account ID**: the 12-digit number in the menu under your account name, top right of the AWS console.

1. In cf-dam, open **Storage** and press **Add a connection**.
2. Choose **Amazon S3**, then **Keyless: an IAM role (recommended)**.
3. Fill in a **Name**, the **Bucket** name, the **Region** code and, if you like, a **Folder in the bucket** such as `cf-dam`.
4. **Role ARN:** type `arn:aws:iam::` then your 12-digit account ID, then `:role/cf-dam`. For example: `arn:aws:iam::123456789012:role/cf-dam`. (You'll create this role in a moment.)
5. Press **Add and test**. cf-dam opens the new connection's page.
6. On that page, **AWS setup for this keyless connection** is open. It shows three things to copy: an **identity provider URL and audience**, a **trust policy** and a **permissions policy**.

Now in the AWS console:

7. Search for **IAM** and open it. Choose **Identity providers**, then **Add provider**.
8. Choose **OpenID Connect**. Paste the **provider URL** and the **audience** from cf-dam. Choose **Add provider**.
9. In IAM, choose **Roles**, then **Create role**.
10. Choose **Custom trust policy**, delete what's in the box and paste the **trust policy** from cf-dam (the **Copy** button copies it). Choose **Next**.
11. Skip the permissions list (choose **Next**). Name the role exactly `cf-dam`, then **Create role**.
12. Open the new role. Under **Permissions**, choose **Add permissions**, then **Create inline policy**.
13. Choose **JSON**, delete what's there and paste the **permissions policy** from cf-dam. Choose **Next**, name it `cf-dam-bucket`, and **Create policy**.

Back in cf-dam, press **Test** on the connection. "Connected: wrote, read back and deleted a test object" means you're done.

The permissions policy only lets cf-dam into **that one bucket** (and folder): it can add, read, delete and restore files there, and list them. It can't touch anything else in your AWS account.

### With access keys

1. In the AWS console, open **IAM**, choose **Users**, then **Create user**. Name it `cf-dam`. Don't give it console access. Choose **Next**.
2. Choose **Attach policies directly**, then **Next** and **Create user** (you'll add a policy in a moment).
3. Open the new user. Choose **Add permissions**, then **Create inline policy**, then **JSON**, and paste this, putting your bucket name where it says `YOUR-BUCKET` (twice):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:RestoreObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    },
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::YOUR-BUCKET" }
  ]
}
```

4. Name the policy `cf-dam-bucket` and create it.
5. On the user's **Security credentials** tab, choose **Create access key**, pick **Application running outside AWS**, and create it.
6. AWS shows an **Access key ID** and a **Secret access key**. The secret is shown **only once**: keep this page open.
7. In cf-dam, **Storage → Add a connection → Amazon S3 → Access keys**. Fill in the name, bucket, region and folder, paste both keys and press **Add and test**.

cf-dam encrypts the secret before storing it and never shows it again. Never email keys or paste them anywhere else.

## 5. If you'll upload straight into this bucket

When you upload in the browser to an S3 connection, the files go directly from your computer to Amazon. The bucket has to allow that:

1. On the connection's page in cf-dam, under **Uploading from the browser**, press **Copy** beside the rule.
2. In the AWS console, open the bucket, then **Permissions**, scroll to **Cross-origin resource sharing (CORS)** and choose **Edit**.
3. Paste the rule and **Save changes**.
4. Back in cf-dam, press **Test uploading from this browser**.

You don't need this if your photos only reach S3 by being imported or moved there.

## 6. Make it the default (optional)

On the connection's page, press **Make default** to send new uploads there. You can still pick another place in the upload box.

## What it costs

| | Roughly (US prices) |
| --- | --- |
| Storing in S3 Standard | $23 per terabyte a month |
| Storing in Glacier Deep Archive | $1 per terabyte a month (180-day minimum stay) |
| Getting a file back from Deep Archive | about $20 per terabyte (cheaper "Bulk" option: about $2.50), plus a wait of up to 12 or 48 hours |
| Downloading out of AWS | about $90 per terabyte after the first 100 GB a month |
| cf-dam's thumbnails and previews | nothing at Amazon: they're in Cloudflare |

Check [Amazon's S3 pricing page](https://aws.amazon.com/s3/pricing/) for your region. See [Archiving and restoring](/help/archiving) for moving photos into Glacier and getting them back.

## If the test fails

| What cf-dam says | Usually means |
| --- | --- |
| Access Denied | The permissions policy has a different bucket name, or a folder that doesn't match the connection's folder. |
| A message about the region, or a "redirect" | The region code in cf-dam doesn't match the bucket's region. |
| Not authorized to perform `sts:AssumeRoleWithWebIdentity` | Keyless: the identity provider's URL or audience, or the role's trust policy, doesn't match what cf-dam showed. Copy them again. |
| The role can't be found | The Role ARN has a typo, or the role isn't named `cf-dam`. |
| Uploads fail with a network error | The bucket's CORS rule is missing (step 5): **Test uploading from this browser** says so. |

Still stuck? The [glossary](/help/glossary) explains the AWS words. A typo in the role or keys can be fixed with **Edit** on the connection's page. You can also **Remove** a connection that never worked and start again (cf-dam won't remove one that still holds originals or that something uses: the page says what).
