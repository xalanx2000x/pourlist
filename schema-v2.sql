-- Add photo_hash and menu_text fields
alter table photos add column if not exists photo_hash text;
alter table venues add column if not exists menu_text text;
alter table venues add column if not exists menu_text_updated_at timestamptz;

-- Index for hash lookups
create index if not exists photos_venue_id_hash_idx on photos(venue_id, photo_hash);

-- Add latest_menu_image_url to store one reference image per venue
alter table venues add column if not exists latest_menu_image_url text;
