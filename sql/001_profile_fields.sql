-- Profile fields for the existing app_users table.
-- Run this once against the incident_tracker database:
--   psql -U postgres -d incident_tracker -f backend/sql/001_profile_fields.sql

BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL
  DEFAULT CURRENT_TIMESTAMP;

-- Backfill updated_at for accounts that existed before this migration.
UPDATE app_users
SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP)
WHERE updated_at IS NULL;

ALTER TABLE app_users
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE app_users
  ALTER COLUMN updated_at SET NOT NULL;

-- Emails are normalised to lowercase by the API. This index also protects
-- against duplicate addresses that differ only by letter case.
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_key
  ON app_users (LOWER(email));

COMMIT;
