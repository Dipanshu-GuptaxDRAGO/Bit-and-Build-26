-- ============================================================
-- Web-Shooter Dispatch — Database Schema
-- Run: node src/scripts/setup-db.js
-- ============================================================

-- Enable uuid generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
