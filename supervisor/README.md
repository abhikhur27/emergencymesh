# RescueMesh regional supervisor

Standalone Node application for the regional coordination workspace. The real ECSW laptop hub submits structured cases over HTTPS. Plano, Garland and Addison provide **simulated** intake, resource inventories and service acknowledgments. This application does not contact emergency services.

The normal workflow runs automatically: persist a case, validate source fields and location, query the catalog, ask local Nemotron to propose an eligible allocation, reserve stock atomically, acknowledge the simulated service adapter, and publish a revision-aware update to the source hub. Operators handle exceptions and may pause coordination. The model cannot change category, source priority, people, inventory, or dispatch policy.

## Run

Requires Node24 or newer. Install the pinned MongoDB driver with `npm ci --ignore-scripts --no-fund --no-audit`.

```powershell
node src/cli.mjs provision --data C:/Users/abhim/Documents/rescuemesh-runtime/supervisor-data
node src/cli.mjs model-check --data C:/Users/abhim/Documents/rescuemesh-runtime/supervisor-data
node src/cli.mjs start --data C:/Users/abhim/Documents/rescuemesh-runtime/supervisor-data --until 2026-11-10T05:00:00Z --simulate-towns
```

The service binds to `127.0.0.1:4782`. `--port` changes the port; `--no-model` explicitly selects the deterministic policy. The deployment owner manages the bounded desktop runner and Cloudflare tunnel. This package does not install a scheduled task or start background services by itself.

Copy `.env.example` to ignored `.env`, or inject environment variables into the process:

| Variable | Purpose |
|---|---|
| `RESCUEMESH_SUPERVISOR_DATA` | Private durable data directory; defaults to `.supervisor` |
| `RESCUEMESH_SUPERVISOR_PORT` | Loopback port; defaults to4782 |
| `RESCUEMESH_SUPERVISOR_PUBLIC_ORIGIN` | Exact public HTTPS origin, such as a Cloudflare tunnel origin |
| `MONGODB_URI` | Private authenticated MongoDB connection URI |
| `MONGODB_DATABASE` | Database name; defaults to `rescuemesh_supervisor` |
| `OLLAMA_HOST` | Local Ollama origin; defaults to `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Local model tag; defaults to `nemotron-3-nano:4b` |
| `RESCUEMESH_MODEL_TIMEOUT_MS` | Per-case bounded inference budget; default20s, maximum60s |
| `RESCUEMESH_MODEL_CHECK_TIMEOUT_MS` | Synthetic cold-start check budget; default150s, maximum180s |

Provisioning creates stable `operator-token.txt`, `ecsw-hub-token.txt` and `config.json` files with restrictive file modes in the private data directory. Do not put these files in Git. The operator username is `operator` by default. Sign in once with the operator access key and leave “Keep me signed in” selected. An HttpOnly same-site cookie persists for up to a year and survives process restarts. Sign out revokes that session. Replacing the operator token revokes all sessions on next start. The machine bearer is independent of operator access.

Set the exact public origin and restart after creating or replacing a quick-tunnel URL. Host and Origin checks deliberately reject an unconfigured public origin. The process accepts socket connections only from loopback, including the local Cloudflare tunnel connector. Browser mutations require the authenticated CSRF token as well as the exact Origin. Machine calls use a hub-scoped bearer and never obtain an operator session.

## Source hub API

`GET /api/health` is a minimal unauthenticated health response. `GET /api/state` requires an operator cookie. No secrets or case contents are returned by health.

`POST /api/hub/cases`, with `Authorization: Bearer <ecsw machine key>` and `Content-Type: application/json`:

```json
{
  "schema": "rescuemesh.case.v1",
  "eventId": "ecsw:7:10:2:r1",
  "hubId": "ecsw",
  "caseId": "ecsw:7:10:2",
  "revision": 1,
  "source": { "kind": "radio", "requestId": "7:10:2", "receivedAt": 1794170000000 },
  "request": { "category": 5, "severity": 2, "people": 2, "note": "Drinking water requested." },
  "summary": { "text": "Two people request drinking water.", "resource": "water", "quantity": 2 },
  "location": { "kind": "landmark", "label": "UT Dallas ECSW entrance", "verified": false }
}
```

This example is synthetic. The timestamp must be current in actual intake. Numeric categories1–5 are medical, fire, rescue, safety and supplies. Severity1–3 is the sender’s critical, urgent and standard priority. People is1–255. Notes are limited to120 UTF-8 bytes, summaries400 characters, proposed quantities1–20 and no greater than the people count. Supported resources are `water`, `supplies`, `medical`, `fire`, `rescue`, `safety`. Supply requests use the original note to distinguish water from kits. GPS requires finite latitude/longitude and optional accuracy; landmark requires a label. Neither is labeled independently verified by this application.

A successful202 response contains `accepted`, `eventId`, `caseId`, `revision`, `status`. Exact event retries return `duplicate:true`. Conflicting replays or changed immutable request/source fields return409. Older revisions return `stale:true`. Higher revisions may update a location or summary; an existing allocation is retained without reserving or dispatching again. Source timestamps older than one hour, over five minutes in the future, missing locations, resource mismatches and inventory shortages remain operator exceptions.

`GET /api/hub/updates?after=0&hubId=ecsw`, with the same machine bearer, returns:

```json
{
  "updates": [{ "seq": 12, "caseId": "ecsw:7:10:2", "hubId": "ecsw", "revision": 1, "status": "simulated-dispatched", "allocation": {}, "events": [], "updatedAt": 1794170001000, "simulation": true }],
  "cursor": 12,
  "more": false
}
```

Persist the cursor after consuming updates. Canonical statuses are `received`, `planning`, `allocated`, `simulated-dispatched`, `needs-review`, `paused`. Allocation has `id`, `caseId`, `townId`, `resource`, `quantity`, `service`, `dispatchId`, `reservedAt`, `simulation:true` and an acknowledgment after the simulated adapter completes. The source hub should ignore updates with an older case revision. The bounded update journal keeps the latest10,000 updates; this hackathon prototype is not a long-term disconnected synchronization service.

## Model, persistence and simulation

Nemotron uses the Ollama native tool-calling API. Its only tools are `lookup_resources` and `propose_allocation`. The planner accepts one tool call per round, at most three rounds, and requires the actual catalog result before a proposal. Software validates the exact required resource, quantity, town eligibility and current stock again inside the serialized reservation transaction. Model failure activates an explicitly labeled deterministic catalog policy. Model text is never a dispatch command. `model-check` performs a synthetic two-step inference, writes private `model-check.json` and exits2 unless actual native tool calls succeed.

The local atomic JSON spool is authoritative for acknowledgment, revision identity, reservations and sessions. MongoDB stores salted operator password hashes, hashed session identifiers, cases, event records and runtime state. Writes are mirrored after the local durable transaction; an unavailable database leaves the saved local queue intact and is visible in System details. Browser session IDs and plain access keys are never stored in MongoDB. The local spool contains protected source information and should remain private. Application errors do not log raw notes, model prompts or connection strings.

Town intake is paused by default unless `--simulate-towns` is specified. Start/Pause/Step/Reset controls are in the separate Simulation view. Seeded intake continues every25 seconds by default (allowed interval10–120s). A SIM cycle renews after12 generated requests, or earlier when generated reservations would exhaust eligible inventory. It archives and releases only internally generated cases and reservations, retains24 archived SIM cases, and records an explicit SIM cycle event. ECSW records and reservations remain intact. If those preserved reservations leave insufficient stock, the generator skips that intake rather than creating repeated exceptions or inventing inventory. Starting a previously completed legacy run renews its SIM cycle safely. Inventories are finite and are not presented as real vehicle availability.

## Verification

`npm test` covers scoped machine authentication, operator session persistence and revocation, CSRF/Origin rejection, durable acknowledgments, event/revision replay, immutable originals, concurrent inventory bounds, paused/resumed work, adapter retries after restart, continuous SIM retention and inventory cycles, protected real records, Mongo SIM retention, and local disk failure. `npm run check` checks JavaScript syntax. Actual model, MongoDB, desktop runner, public HTTPS and physical radio receipts must be verified in the deployed runtime; mocked tests do not establish those integrations.
