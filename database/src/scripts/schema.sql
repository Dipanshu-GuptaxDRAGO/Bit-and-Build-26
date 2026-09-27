-- ============================================================
-- Web-Shooter Dispatch - Database Schema
-- Run: node src/scripts/setup-db.js
-- ============================================================

-- gen_random_uuid() is built into PostgreSQL 13 and later.

-- -------------------------------------------------------
-- 1. Incidents
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  TEXT NOT NULL
                          CHECK (type IN ('fire', 'medical', 'security', 'other')),
  severity              INTEGER NOT NULL
                          CHECK (severity >= 1 AND severity <= 5),
  lat                   DOUBLE PRECISION NOT NULL,
  lon                   DOUBLE PRECISION NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'assigned', 'resolved')),
  reported_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_responder_id UUID
);

-- -------------------------------------------------------
-- 2. Responders
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS responders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  type                TEXT NOT NULL
                        CHECK (type IN ('fire', 'medical', 'security', 'other')),
  lat                 DOUBLE PRECISION NOT NULL,
  lon                 DOUBLE PRECISION NOT NULL,
  status              TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('available', 'claimed', 'en_route', 'busy')),
  last_updated_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  current_incident_id UUID
);

-- -------------------------------------------------------
-- 3. Dispatch Logs
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatch_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   UUID NOT NULL,
  responder_id  UUID NOT NULL,
  action        TEXT NOT NULL
                  CHECK (action IN ('assigned', 'timeout', 'reassigned', 'resolved')),
  timestamp     TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Additive, rerunnable migration for durable dispatch recovery.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assignment_id UUID;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_retry_at TIMESTAMPTZ;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS excluded_responder_id UUID;
CREATE INDEX IF NOT EXISTS incidents_confirmation_due_idx ON incidents (confirmation_deadline)
  WHERE status = 'assigned' AND confirmation_deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS incidents_dispatch_retry_idx ON incidents (dispatch_retry_at)
  WHERE status = 'pending' AND dispatch_retry_at IS NOT NULL;

-- Upgrade existing unconfirmed assignments without resetting deadlines on reruns.
UPDATE incidents i SET assignment_id = gen_random_uuid(),
  confirmation_deadline = CASE WHEN r.status = 'claimed' THEN clock_timestamp() + INTERVAL '15 seconds' ELSE NULL END
FROM responders r WHERE i.status = 'assigned' AND i.assigned_responder_id = r.id
  AND i.assignment_id IS NULL;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch_request_id UUID;
CREATE TABLE IF NOT EXISTS dispatch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  completed_at TIMESTAMPTZ,
  result JSONB,
  error TEXT
);
CREATE INDEX IF NOT EXISTS dispatch_requests_waiting_idx ON dispatch_requests (requested_at) WHERE completed_at IS NULL;
