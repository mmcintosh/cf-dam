-- 0013: width and height are the photo as seen, upright. Until now they were the sensor's size even for
-- photos whose EXIF Orientation (5–8) turns them a quarter, so portrait shots showed as landscape tiles
-- and fell under the wrong orientation filter. Swap them for those photos.
UPDATE assets SET width = height, height = width WHERE orientation BETWEEN 5 AND 8 AND width IS NOT NULL AND height IS NOT NULL;
