# RescueMesh runtime receipt

Verified on November 8, 2026. The laptop ECSW hub and desktop supervisor are separate applications. Only the laptop receives physical LoRa requests. Plano, Garland and Addison generate clearly labeled simulated intake; all service acknowledgments are simulated.

## Local model

Both hosts have the official Ollama `nemotron-3-nano:4b` model, digest `d94b6dfae26d340fd16599d8cd5301945bb42b6bd7a7c70f2078559562f60cbe`, 2,837,597,147 model bytes. This is a downloaded local 4B model, not the cloud 30B tag. Requests use 4,096 context tokens, disable thinking and bound generated output. The applications validate native tool names, arguments, inventory and source fields before acting.

| Host | Provider | Measured result |
|---|---|---|
| ECSW laptop | Existing Ollama 0.40.6, CPU | Schema extraction 7.936 s; native tool generation 14.795 s; 3.114 GB loaded, 0 VRAM |
| Desktop supervisor | Isolated Ollama 0.40.15, RTX 2070 SUPER 8 GB | Schema extraction 42.855 s including 15.096 s load; subsequent native tool generation 0.795 s; 2.824 GB loaded entirely in VRAM |
| Desktop application | Actual supervisor planner | `lookup_resources` followed by policy-validated `propose_allocation`, 1.398 s warm |

The first desktop cold attempt exceeded its 120 s bound. Warm inference succeeded; allow startup warmup. The supervisor uses a 5-minute keep-alive and a bounded 150 s planning deadline. The isolated desktop server allows one loaded model, one parallel inference and at most eight queued requests. It binds only to loopback, disables Ollama cloud features, and does not replace global model settings. Freeform JSON mode alone produced incorrect field types during testing; schema validation and native tools remain necessary.

Reproduce the synthetic provider check with `node deploy/benchmark-nemotron.mjs <receipt.json>`. Reproduce the application check from `supervisor` with `node src/cli.mjs model-check --data <private-data-directory>`. These checks prove extraction and validated simulated allocation, not external dispatch.

## MongoDB

Official MongoDB Community 8.0.34 runs on desktop `127.0.0.1:27018` with authentication. The `rescuemesh` and `rescuemesh_supervisor` databases have separate application users restricted to read/write access to their own database. Actual authenticated writes and reads passed; anonymous reads were denied. This is Community, not MongoDB Atlas. No Atlas connection was available when this receipt was recorded.

Private desktop credentials reside outside the repository under the runtime's `.private` directory. The bootstrap creates them once and preserves them. Application credentials are transported through ignored private configuration files; connection strings, passwords, operator keys and bearer tokens do not belong in public receipts or source control. The laptop reaches MongoDB over the parent runner's SSH forward; the database port is not exposed publicly.

## Desktop processes and updates

The isolated runtime directory is `C:/Users/abhim/Documents/rescuemesh-runtime`. Source is deployed to its `supervisor` directory; durable state and stable operator/machine credentials are in the separate `supervisor-data` directory. Portable Node 24.22.2 is used without replacing system Node. Windows ACLs restrict private directories to the owner, SYSTEM and administrators.

Two independently owned startup tasks are enabled:

| Task | Responsibility |
|---|---|
| `RescueMesh-Providers-20261108` | Loopback MongoDB and isolated Ollama; restart owned child processes |
| `RescueMesh-Supervisor-20261108` | Supervisor, revision-triggered application restart and isolated HTTPS tunnel |

Both use runtime working directories, reject duplicate ownership, and expire at **2026-11-10T05:00:00Z**, Monday November 9 at 11 PM Central. Startup triggers have no calendar next-run timestamp. Task and PID JSON files are point-in-time observations, not guarantees of future availability. The wrappers stop their own processes at the deadline; existing Scrabble, Life Organizer, Cloudflare 8080 and other owners' services were preserved.

Run `deploy/deploy-supervisor.ps1` from the laptop to copy public supervisor source and update its revision marker. The desktop runner observes that marker, restarts only its supervisor application, and preserves private data and tunnel ownership. Dependency changes require the pinned `npm ci --ignore-scripts --no-audit --no-fund` step; the source-copy helper does not mutate running dependencies.

The generated town exercise renews after 12 active SIM requests, or earlier under simulated inventory pressure. It retains 24 archived SIM cases, releases only generated SIM reservations, and records an explicit SIM cycle. It preserves physical ECSW cases and reservations. If those reservations leave insufficient stock, simulated intake skips that request rather than inventing inventory or flooding the exception queue. Local spool and Mongo retention remove only generated SIM history beyond the retention window.

## HTTPS and sign-in

An isolated Cloudflare Quick Tunnel forwards to desktop `127.0.0.1:4782`. Its exact public origin is automatically applied on application restart. The existing configured domain and8080 ingress are unchanged. The tunnel controller verifies an anonymous401 response from the protected application before exposure. Public health is minimal; cases require an operator session and machine calls require the separately scoped ECSW bearer.

Actual local and public checks passed: health200, anonymous operator state401, anonymous hub updates401, authorized ECSW updates200, another hub scope403, operator sign-in/state200. The public session cookie is Secure, HttpOnly, SameSiteStrict and persists for a year. Stable private credential files and sessions survive application restarts.

Quick Tunnel hostnames can change after a connector restart and have no uptime guarantee. The runner updates its configured origin when that happens. The active URL and connector PID are recorded in `supervisor-public.json`; the task's remaining processes are in `supervisor-state.json`. The dashboard polls and does not depend on SSE.

## Evidence and remaining external setup

Safe receipts are in `deploy/receipts/`: model benchmarks, provider checksums, Mongo verification, application model tools, HTTP/authentication and current task/process state. Source tests pass on both hosts, including continuous simulation, preservation of physical cases and reservations, scoped authentication, durable replay, and Mongo SIM retention.

The existing Chrome Brev account is signed in, but a Terms of Service acceptance screen blocks access and the credit balance is unverified. The parent task has requested the owner's approval for those terms. No Brev machine was provisioned and no paid OpenAI API was used. The currently verified supervisor model runs on the desktop GPU. An Atlas URI and access to the Brev workspace with confirmed credits are still required to demonstrate those respective cloud tracks.

Official references: [Ollama model](https://ollama.com/library/nemotron-3-nano:4b), [NVIDIA GGUF model](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF), [native tool calling](https://docs.ollama.com/capabilities/tool-calling), [MongoDB Windows installation](https://www.mongodb.com/docs/manual/administration/install-community-windows/), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [official Node24 archive](https://nodejs.org/dist/v24.22.2/).
