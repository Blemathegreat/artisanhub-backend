-- ============================================================
-- 001_foundation.sql
-- Run ONCE on local first, then on Aiven.
-- ============================================================

-- BEFORE running this file, check nobody has two artisan profiles.
-- This must return ZERO rows:
--
--   SELECT user_id, COUNT(*) AS profiles
--   FROM artisans GROUP BY user_id HAVING profiles > 1;
--
-- If it returns rows, tell me before continuing (we merge them first).

-- 1) One artisan profile per user, enforced by the database itself.
ALTER TABLE artisans
  ADD UNIQUE KEY uniq_artisan_user (user_id);

-- 2) Remember HOW precise each artisan's pin is:
--    'exact'       = we found the street address
--    'approximate' = we only found the town/city
ALTER TABLE artisans
  ADD COLUMN location_precision ENUM('exact','approximate') NULL AFTER longitude;

-- 3) Speeds up the search page (it always filters on these two).
CREATE INDEX idx_artisans_live ON artisans (is_onboarded, category_id);
