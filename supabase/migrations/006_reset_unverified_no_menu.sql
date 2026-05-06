-- Migration 006: Reset all non-closed venues without a menu image to 'unverified'
-- A venue needs a menu photo to be considered verified; photos prove the HH exists at that location

BEGIN;

  UPDATE venues
  SET status = 'unverified'
  WHERE latest_menu_image_url IS NULL
    AND status != 'closed';

COMMIT;