---
title: "Finding faces"
summary: "Letting cf-dam find the faces on your photos, so you name people by clicking them, and what it keeps."
section: Your photos
order: 11
---

**Find faces** puts a small picture of each face it finds on a photo's page, under **People**. Click one and type who it is: the photo is tagged with them, as if you'd added the name by hand. It saves typing on photos with several people, and it's how a person's page gets a picture of their face.

It is **finding, not recognising**. cf-dam never works out who someone is, and never compares one face with another. You name every face yourself.

## What is kept

For each face: a box (where the face is on the photo) and how sure the detector was. Nothing else: no facial features, no "face print", nothing that could identify anyone on its own. The detector (Google's BlazeFace) also works out where the eyes, nose and mouth are; cf-dam throws that away before anything is stored.

Faces are found on your own machines, by your helper (the program on your NAS or computer that catalogues your photos). Photos and faces are never sent to anyone else for this. **Clients never see faces**: not in galleries, not in downloads, not in files.

## Turning it on

In **Setup → AI review → Find faces**, read what it means (see [Faces and the law](/help/faces-and-the-law)), tick **I've read this**, and press **Turn on Find faces**. It needs permission to change settings (administrators by default). Then:

- your helper looks at each new photo as it makes its preview, and works through older photos in the background, a few hundred a minute;
- photos uploaded through the website are looked at from their album: on an album's page (or a job's), **Find faces in this album** works through the photos not looked at yet, in that browser tab. Keep the tab open (and in front, on a phone) until it's done; closing it stops, and the rest wait for next time. A tab does a few thousand photos an hour. Right after an upload, the uploader offers the same for the photos just sent.

Your helper needs to be up to date: an older one carries on as before, without faces.

## Naming faces

On a photo's page, click a face:

- type a name (people you've named before are offered) and press **Name**;
- **Not someone to name** for a passer-by, a face on a poster or a statue: it's put aside and not offered again (**Show** brings set-aside faces back);
- **Clear the name** takes the name off that face; if no other face on the photo has that name, the person comes off the photo too.

Taking someone off a photo under **People** takes their name off their face there as well. Merging two people moves their faces; deleting a person sets their faces aside, so they aren't offered for naming again.

Naming a face changes what a gallery's couple can find straight away, if the gallery lists that person (see [People in a client gallery](/help/people-in-galleries)).

## Naming many at once

On an album's page (or a job's), **Faces to name** shows the faces found there that nobody has named or set aside, largest first. Tick several faces of the same person, type or pick their name once and press **Name**: every ticked face is named and each photo tagged. **Not someone to name** sets the ticked faces aside. **Photo** under a face opens its photo.

## How good it is

It finds most faces down to about 3% of a photo's width: the back rows of a group of twenty or so. It often misses faces that are partly hidden (behind another head, a hand or a phone) or turned well to the side, and now and then boxes something that isn't a face, like a patterned dress. Anyone it misses can be named on the photo by hand, as always.

Finding faces never changes a photo's **People** count; the page shows both.

## Pausing and removing

**Pause** stops all finding at once; everything found so far stays, and you can still name faces. Turning it on again carries on where it left off.

**Remove all face boxes…**, while paused, deletes every face the detector found, named or not. The names stay on the photos as ordinary tags. It runs in the background, a few thousand a minute.

## If it isn't there

An installation can be set up without face finding at all. Then **Find faces** says it isn't part of this installation, and nothing about faces appears anywhere.
