-- Where a photo's place came from, field by field (review B12). One location_source for the whole
-- location meant a file that gave only the country, or a person who typed only a sublocation, kept
-- GPS from filling the city. place_gps marks the fields the GPS lookup filled (city 1, state 2,
-- country 4, country code 8): those, and empty fields, are the lookup's to fill and replace; any
-- other field was written by the file or a person and stays. location_source is no longer used.
ALTER TABLE assets ADD COLUMN place_gps INTEGER NOT NULL DEFAULT 0;
UPDATE assets SET place_gps = (COALESCE(city, '') <> '') + (COALESCE(state, '') <> '') * 2 + (COALESCE(country, '') <> '') * 4 + (COALESCE(country_code, '') <> '') * 8
WHERE location_source = 'gps';
-- Photos whose lookup was skipped because part of the place was owned get another one.
UPDATE assets SET place_checked_at = NULL
WHERE gps_lat IS NOT NULL AND deleted_at IS NULL AND location_source IS NOT 'gps'
  AND (COALESCE(city, '') = '' OR COALESCE(state, '') = '' OR COALESCE(country, '') = '' OR COALESCE(country_code, '') = '');
