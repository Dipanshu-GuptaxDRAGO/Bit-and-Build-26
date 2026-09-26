# Web-Shooter Dispatch

Node.js, Express, and PostgreSQL backend. Layers 1 through 5 are implemented:
server connectivity, database schema, REST endpoints, and demo simulation.

## Run locally

1. Install Node.js 20 or later and PostgreSQL 13 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env` if you do not already have one (`Copy-Item .env.example .env` in PowerShell).
4. Set DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME in `.env`.
   The configured database must already exist and be accessible to that user.
5. Run `npm run db:check` to verify the connection.
6. Run `npm run db:setup`, then `npm run dev` for automatic restarts, or `npm start`.
7. Request `http://localhost:3000/health` (adjust for your configured PORT).
   Expected response: HTTP 200 with `{"status":"ok"}`.

The server verifies PostgreSQL with `SELECT 1` before listening. Startup fails
if configuration is invalid, the database is unreachable, or the port is in use.
`/health` is an HTTP liveness check; it does not query the database on each request.
Ctrl+C closes the HTTP server and database pool.

## Structure

```text
server.js                  HTTP entry point
src/config/env.js          Environment loading and validation
src/config/db.js           PostgreSQL connection pool
src/controllers/           Health and incident/responder/log handlers
src/routes/                Health and REST routes
src/models/                Incident, Responder, and DispatchLog data access
src/scripts/check-db.js    Read-only database connection check
src/scripts/schema.sql     Three tables with defaults and CHECK constraints
src/scripts/setup-db.js    Transactional schema setup
src/scripts/test-db.js     Database tests; all test writes are rolled back
```

Earlier drafts are preserved in `archive/previous-data-layer/` as reference only.
Active models and setup scripts are under `src/`. No schema creation or matching
logic runs at server startup. Seeding and simulation are separate commands.

## Layer 4: demo data

After `npm run db:setup`, run:

```powershell
npm run seed
npm start
# In a second terminal:
npm run simulate
```

`scripts/seed-responders.js` inserts 20 fictional, available responders with random
types and Bangalore positions (latitude 12.83-13.05, longitude 77.45-77.75).
If any responders already exist, the entire seed is skipped. Repeated or concurrent
seed runs do not duplicate data, and existing responders are never cleared.

`scripts/simulate.js` runs immediately, then waits five seconds after each tick.
Each tick has a 20% chance of inserting a pending incident and moves 2-3 randomly
selected available responders (or fewer if fewer are available). Coordinates move
by up to 0.002 degrees per axis and stay inside the Bangalore bounds; location
timestamps update too. Claimed, en_route, and busy responders are excluded.
Row locks prevent the location update from competing with a concurrent claim.
No statuses, assignment links, or dispatch logs are changed by the simulator.

The script logs each action, retries on the next tick after database errors,
and closes its connections on Ctrl+C. Run only one simulator for the intended
event rate. Incident creation is random: 20% does not guarantee an incident every
five ticks (the average is roughly one every 25 seconds).

Watch the data through `GET /incidents` and `GET /responders`, or:

```powershell
curl.exe http://localhost:3000/incidents
curl.exe http://localhost:3000/responders
```

## Layer 3: REST API

All responses are JSON. Errors use `{ "error": "message" }` without client-facing
stack traces. POST input requires JSON numbers (numeric strings are rejected).
Latitude is -90 through 90; longitude is -180 through 180. Severity is an integer
1 through 5. Extra POST fields are ignored; status always starts as `pending`.

| Method | Path | Success response |
| --- | --- | --- |
| GET | /health | 200: `{"status":"ok"}` |
| POST | /incidents | 201: created incident including UUID and defaults |
| GET | /incidents?status=pending | 200: incident array, newest reported_at first |
| GET | /incidents/:id | 200: incident object |
| GET | /responders?status=available | 200: responder array, newest last_updated_at first |
| GET | /responders/:id | 200: responder object |
| GET | /dispatch/logs | 200: log array, newest timestamp first |

Status filters are optional and accept the values documented below. Invalid or
repeated filters and malformed UUIDs return 400; valid UUIDs with no record and
undefined routes return 404. Malformed JSON returns 400, bodies over 100 KB return
413, and unexpected errors return 500 with `Internal server error`.

Run `npm run api:test` after database setup. It starts an isolated HTTP listener,
tests all endpoints against PostgreSQL, injects one database failure to check
error handling, and deletes only the fixtures it created. The expected
`Simulated database failure` console message demonstrates the 500 test.

Manual checks from PowerShell (use a real responder UUID from the database):

```powershell
curl.exe -i http://localhost:3000/health
'{"type":"fire","severity":4,"lat":12.94,"lon":77.61}' | curl.exe -i -X POST http://localhost:3000/incidents -H "Content-Type: application/json" --data-binary '@-'
curl.exe -i 'http://localhost:3000/incidents?status=pending'
curl.exe -i http://localhost:3000/incidents/REPLACE_WITH_INCIDENT_UUID
curl.exe -i 'http://localhost:3000/responders?status=available'
curl.exe -i http://localhost:3000/responders/REPLACE_WITH_RESPONDER_UUID
curl.exe -i http://localhost:3000/dispatch/logs
# Expected 400, 400, 404, and 404 respectively:
'{"type":"fire","severity":9,"lat":12.94,"lon":77.61}' | curl.exe -i -X POST http://localhost:3000/incidents -H "Content-Type: application/json" --data-binary '@-'
'{"type":' | curl.exe -i -X POST http://localhost:3000/incidents -H "Content-Type: application/json" --data-binary '@-'
curl.exe -i http://localhost:3000/incidents/00000000-0000-0000-0000-000000000000
curl.exe -i http://localhost:3000/unknown
```

In Postman, use the same URLs and select Body -> raw -> JSON for POST requests.

## Layer 2: database setup and verification

```powershell
npm run db:setup
npm run db:test
```

Setup creates `incidents`, `responders`, and `dispatch_logs` in one transaction.
It is safe to rerun: existing tables and rows are preserved. This initial setup
does not upgrade an existing table with a different schema; future schema changes
will need explicit migrations.

All fields are required except `assigned_responder_id` and `current_incident_id`,
which default to NULL. IDs default to `gen_random_uuid()`. Coordinates use
`DOUBLE PRECISION`; time fields use `TIMESTAMP` as specified.

| Table | Exact columns |
| --- | --- |
| incidents | id, type, severity, lat, lon, status, reported_at, assigned_responder_id |
| responders | id, name, type, lat, lon, status, last_updated_at, current_incident_id |
| dispatch_logs | id, incident_id, responder_id, action, timestamp |

Types are `fire`, `medical`, `security`, or `other`. Incident severity is an integer
from 1 through 5. Incident statuses are `pending` (default), `assigned`, `resolved`.
Responder statuses are `available` (default), `claimed`, `en_route`, `busy`.
Log actions are `assigned`, `timeout`, `reassigned`, `resolved`.
Time fields default to `now()`. UUID reference fields are stored as specified;
this layer does not add foreign-key constraints or assignment behavior.

Models return promises. `create` returns the inserted row, `findAll` returns an
array newest first, and `findById` returns a row or `null` for a missing UUID.
Database errors propagate to the caller. Examples from a Node script at the
project root:

```js
const Incident = require('./src/models/incident');
const Responder = require('./src/models/responder');
const DispatchLog = require('./src/models/dispatchLog');

await Incident.create({ type: 'fire', severity: 4, lat: 12.94, lon: 77.61 });
await Incident.findAll({ status: 'pending' });
await Responder.create({ name: 'Asha Rao', type: 'fire', lat: 12.95, lon: 77.62 });
await Responder.findAll({ status: 'available' });
await Incident.findById(incidentId);
await DispatchLog.create({ incident_id: incidentId, responder_id: responderId, action: 'assigned' });
await DispatchLog.findAll({ action: 'assigned' });
```

Use these awaited calls inside an async function with error handling. Standalone
scripts should close the shared pool in `finally`. Every model method also accepts
an optional final database client argument for use within a caller's transaction.
Creating a dispatch log only records an action; it does not assign a responder.

For a manual SQL check, connect to the database named in `.env` using psql or
pgAdmin and run:

```sql
BEGIN;
INSERT INTO incidents (type, severity, lat, lon)
VALUES ('fire', 4, 12.94, 77.61)
RETURNING *;

SELECT * FROM incidents WHERE status = 'pending' ORDER BY reported_at DESC;
ROLLBACK;
```

The returned row includes a generated UUID, status `pending`, a timestamp, and
NULL `assigned_responder_id`. ROLLBACK removes this test insert only.

## Project-local PostgreSQL

A local PostgreSQL 16.15 runtime and application database were prepared
for this checkout under `.local/` (ignored by Git). The database listens only
on localhost:5432 and uses the existing `.env` credentials.

To restart the database from PowerShell after a reboot:

```powershell
& .\.local\pgsql\bin\pg_ctl.exe -D "$PWD\.local\pgdata" -l "$PWD\.local\postgres.log" -o "-h localhost -p 5432" -w start
npm start
```

To stop the database:

```powershell
& .\.local\pgsql\bin\pg_ctl.exe -D "$PWD\.local\pgdata" -m fast -w stop
```

The runtime comes from [EDB's PostgreSQL binaries](https://www.enterprisedb.com/download-postgresql-binaries).

## Teammate handoff and pre-demo checks

When sharing a ZIP, include source files, package.json, package-lock.json,
.env.example, .gitignore, .gitattributes, and this README. Exclude `.env`,
all other private environment files, `.local/`, `node_modules/`, and logs.
Git ignore rules do not automatically exclude files from a ZIP archive.
Each teammate installs dependencies and provides their own database credentials.
If live credentials have been shared, rotate them in PostgreSQL and update each
authorized local `.env` together before restarting the server and simulator.

`.gitattributes` standardizes text files on LF line endings across platforms.

From a fresh checkout: install Node.js and PostgreSQL, run `npm install`, copy
`.env.example` to `.env`, configure all five DB settings, and create the named
empty database using psql or pgAdmin. Then run these commands in order:

```powershell
npm run db:check
npm run db:setup
npm run seed
npm start
# Separate terminal:
npm run simulate
# Pre-demo check in another terminal:
npm run sanity
```

The sanity check completes in a few seconds locally, prints PASS/FAIL for each
endpoint, and exits nonzero on failure. It validates POST with an intentionally
invalid body to avoid inserting demo noise. Use `npm run api:test` for successful
POST creation plus full invalid-input and failure coverage. Run `npm run db:test`
for database constraints and `npm run simulation:test` for injected connection
failure/retry coverage. The expected simulated-error messages are test output.

Frontend: use `http://localhost:3000` as the base URL (or the configured PORT).
CORS allows cross-origin JSON requests including localhost:5173, with automatic
OPTIONS preflight handling. Requests do not use cookie credentials. Lists are
plain arrays, not wrapped objects. Poll read endpoints for updates; no WebSocket
service is implemented. There is no authentication in this hackathon backend.

Matching teammate: connect to the same PostgreSQL database using your local
credentials. On separate machines, localhost refers to each machine, so agree
on a shared DB host; the bundled local database currently accepts localhost only.
Use the exact field names below. You own assignment transactions, claims,
timeouts, status/link updates, and dispatch-log writes. Model methods accept an
optional final pg client so multiple operations can share your transaction.
The simulator updates only available responders' positions/timestamps and inserts
pending incidents; it never assigns responders. No foreign keys enforce UUID
links, so your transaction must keep those links consistent.

Database timestamps are PostgreSQL TIMESTAMP WITHOUT TIME ZONE as requested.
Coordinate the PostgreSQL session and Node process timezones across teammates
(prefer UTC everywhere); the API serializes pg Date values as ISO strings.
The local Windows setup currently uses Asia/Calcutta. Do not interpret stored
wall-clock timestamps using a different timezone on another machine.

Database errors propagate from models into the route promise wrapper and central
error middleware. Setup/seed scripts roll back on failure, the simulator catches
each failed tick and retries after five seconds, and idle pool errors are logged.
No extra catch-and-rethrow blocks are needed inside each model method.

## JSON examples

POST /incidents request:

```json
{"type":"fire","severity":4,"lat":12.94,"lon":77.61}
```

201 response (generated values vary); GET /incidents/:id returns the same shape,
and GET /incidents returns an array of these objects:

```json
{"id":"c217ee28-11dd-4046-85ec-581759e4ffb9","type":"fire","severity":4,"lat":12.94,"lon":77.61,"status":"pending","reported_at":"2026-09-26T11:27:46.018Z","assigned_responder_id":null}
```

GET /responders/:id response; GET /responders returns an array of these objects:

```json
{"id":"68b8ce0d-51cd-485d-9a86-902ff45bcc60","name":"Asha Rao","type":"fire","lat":12.95,"lon":77.62,"status":"available","last_updated_at":"2026-09-26T11:27:46.018Z","current_incident_id":null}
```

GET /dispatch/logs response example (empty until dispatch actions are recorded):

```json
[{"id":"9d23b62e-f1e4-4618-89bd-f68970b8c123","incident_id":"c217ee28-11dd-4046-85ec-581759e4ffb9","responder_id":"68b8ce0d-51cd-485d-9a86-902ff45bcc60","action":"assigned","timestamp":"2026-09-26T11:27:46.018Z"}]
```

Invalid severity returns 400 with
`{"error":"severity must be an integer from 1 to 5"}`.
Missing incidents return 404 with `{"error":"Incident not found"}`.
Unexpected failures return 500 with `{"error":"Internal server error"}`.
Unsupported request encoding/charset returns 415 with a generic message.

## Exact database schema

The following matches `src/scripts/schema.sql`. No additional entity fields
are introduced by the API or simulation.

```sql
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

```
