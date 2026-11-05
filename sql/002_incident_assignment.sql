-- Incident assignment support.
-- Run this once against the incident_tracker database:
--   psql -U postgres -d incident_tracker -f backend/sql/002_incident_assignment.sql

BEGIN;

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS assigned_to INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'incidents_assigned_to_fkey'
  ) THEN
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_assigned_to_fkey
      FOREIGN KEY (assigned_to)
      REFERENCES app_users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS incidents_assigned_to_idx
  ON incidents (assigned_to);

COMMIT;
