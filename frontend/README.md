# Web-Shooter Dispatch

A React + Leaflet operations screen centered on Bengaluru. Includes live polling, incident dispatch and resolution, a chronological activity feed, responder roster, animated status markers, and manual incident reporting by clicking the map.

## Run

Use Node 22.12+ (the existing Node 20.18 runtime can build, but Vite warns it is below its supported version).

```sh
npm install
npm run dev
```

Open http://localhost:5173. Mock mode is the default and is explicitly labeled in the header. The in-memory demo seeds 4 incidents and 12 responders, moves units on each poll, and introduces an incident about every 22 seconds until 10 are pending. Reloading resets demo data. Mock responses are fixtures; there is no distance-based matching algorithm in the frontend.

## Connect the real backend

Copy `.env.example` to `.env.local`, change `VITE_API_MODE=live`, and restart Vite. The development `/api` proxy forwards to `http://localhost:3000` and removes the `/api` prefix. All GET and POST requests are isolated in `src/services/api.js`, including the optional confirm endpoint. Production hosting must proxy `/api` too, or set `VITE_API_BASE_URL` to the backend URL before building and enable CORS there.

Lists accept plain arrays or objects keyed `incidents`, `responders`, `logs` (also `data` arrays). Mutation results are followed by an authoritative refresh. Errors accept `message` or string `error`; no-capacity responses should use an error status (such as 409), `success: false`, or `status: "no_responder_available"`. Confirm is exported but not automatically invoked: the provided match contract does not specify a separate operator confirmation flow.

Polling runs every 2.5 seconds without overlapping requests. Failed polls retain the last snapshot and display a stale-data banner. No fallback to fake data occurs in live mode. Report events in the feed are derived from incident `reported_at` because DispatchLog has no reported action. Response time is the mean interval from report to assignment across available assignment logs. Resolved markers fade for five seconds after first observed resolution; records stay in the activity feed.

Map tiles come from OpenStreetMap with attribution. Internet access is required for tiles and Google Fonts; system fonts remain as fallbacks. Follow the tile provider usage policy for public production deployment.

## Verify

```sh
npm run build
npm run lint
node --test tests/api.test.js
```

Demo: choose a pending diamond, dispatch a unit, resolve it, then click Report Incident and select a map location. The right-side navigation can switch between the activity feed, incident action queue, and responder roster without leaving the map.
