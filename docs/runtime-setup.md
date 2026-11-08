# RescueMesh runtime receipt

## Current deployment verified November 8, 11:29 UTC

| Component | Actual host and provider |
| --- | --- |
| Physical ECSW hub and native tools | ABHIKHUR laptop, local downloaded Nemotron 4B |
| Supervisor application, data and HTTPS connector | ABHIONEMILLION desktop |
| Supervisor inference | Brev MassedCompute A6000, downloaded Nemotron 30B over private SSH |
| User/session/device metadata | Authenticated MongoDB Community on desktop loopback, reached privately |

The plain-VM retry is RUNNING. Actual SSH and Windows loopback forwarding passed. The remote A6000 reports 49,140 MiB VRAM; 24,217,544,293 model bytes were loaded in VRAM. Official Ollama is pinned to 0.40.15. The 30B model digest is `7487f38ecf2402d4080a074b98e9db8258f9701660625822b7b77747db64f0c9`.

The actual 30B model called `lookup_resources` followed by `propose_allocation` and produced a policy-valid plan. The cold check took 117.858 seconds, the warm check 0.832 seconds, and a subsequent live application plan 1.225 seconds. These are individual observations, not latency guarantees. The live authenticated supervisor and browser identify Brev, Nemotron 30B and private SSH. Mongo is connected. Anonymous state is denied (401), authenticated state succeeds (200), and real dispatch is disabled. An invalid subsequent model response used the explicit catalog-policy fallback; not every request is claimed to use a model proposal.

At 11:35 UTC a validated planner update constrained supplier choices to other known towns with enough stock and clarified that the source hub is requesting help. This fixes the observed Addison self-supply proposal while retaining strict software checks. Two regressions failed before the change and passed after it; the supervisor suite now has 27 tests. A post-deployment actual Brev check with Addison as requester and an intentionally contaminated self-entry queried the filtered catalog and selected eligible Plano in 1.131 seconds. Live state at 11:36:58 UTC retained Brev 30B, eight successful tool calls, no model error, a 1.408-second latest plan and connected MongoDB. See the [sanitized provider receipt](brev-verification-20261108.json).

Both failed environments were deleted and their absence verified. The approved retry omits unnecessary Jupyter and exposes no public inference HTTP service. The exact-instance desktop guard is running with its owned SSH child. Independent cleanup is enabled and Ready for **2026-11-10T05:00:00Z**, Monday November 9 at 11 PM Central, with its correct working directory and required files. The $0.68/hour total rate, conservative $1 prior spend and $0.20 reserve keep the estimated project spend through the deadline at $29.4032 within the $30 cap. No payment method or auto recharge was added. The temporary organization-only key expires at the end of November 10; issuer revocation is distinct from local logout.

Both confirmed physical boards now run rescuemesh-oled-v3, with all four write hashes verified for each board. The companion's role-specific BLE advertisement was observed; the hub has BLE disabled. After reconnecting the hub, fresh requests authenticated using the newly enrolled independent phone profile and reached both local Nemotron and the supervisor. Requests without GPS or a recognized landmark correctly await location review. Original reports, credentials and region identity were retained. Physical display appearance and phone-side receipt observation remain separate acceptance evidence.

The following dated preparation and earlier desktop-model measurements are retained for history; this current section supersedes their pending-provider observations.

## Update at 10:47 UTC, November 8

The owner-approved temporary RescueMesh-only Read & Write API key is now installed privately on ABHIONEMILLION and authenticated by the pinned CLI. It expires at the end of November 10; no credential value is included here. The failed Hyperstack environment was deleted and authenticated inventory confirmed its absence at 10:36 UTC. This supersedes the pending-login observations below.

The approved MassedCompute A6000 replacement was created at 10:40:23 UTC with 48 GB VRAM, 64 GB RAM and 256 GB storage, at $0.68/hour total. At 10:47 UTC it was still provisioning, so it was not yet a verified inference provider. The existing desktop model remains active until native tools and GPU execution are verified on Brev.

The desktop's exact-instance guard is enabled and actually reached its guarding state under the scheduled-task identity. Its separate cleanup task is enabled, with next run November 10 at 05:00 UTC (November 9, 11 PM Central), correct runtime working directory and required files present. The plan includes a conservative $0.60 for the failed attempt, a $0.20 cleanup reserve and a $30 project cap; estimated maximum project usage through the deadline is $29.3823. This is a conservative rate estimate, not a provider billing receipt. No payment method or auto recharge was added.

Both new interfaces are deployed. The campus map uses 24 original official UTD building footprints and 160 context paths, with distinct ECSW and ECSS geometry. Regional lines represent only the selected saved allocation, from supplier to requesting hub. Browser checks confirmed zoom, reset, hub filtering and expanded activity; a selected-building campus label issue is being corrected before final acceptance. See the dated interface receipt for source tests and map limitations.

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

## Brev provider transition

The owner now requires supervisor inference on a Brev GPU while the supervisor application remains on the desktop behind Cloudflare. The prepared connection is a private SSH forward from desktop `127.0.0.1:11435` to the GPU's loopback Ollama11434, using downloaded `nemotron-3-nano:30b` weights. ECSW inference remains on the laptop's local 4B model. Brev configuration explicitly identifies its hosting and transport; a failed link uses the visible deterministic catalog policy and never selects another LLM.

Pinned official Brev CLI 0.6.337 was installed and checksum-verified in the desktop's existing Ubuntu24.04WSL2. No new distribution, Brev account or API key was created by the runtime agent. Normal NVIDIA device login is awaiting owner completion. A pasted ID JWT alone does not supply the refresh credential required for unattended cleanup. The CLI and authentication remain on the desktop.

The isolated 30B installer, model controller, exact-instance lifecycle guard and Windows task installer are staged under `deploy/`. They require an approved exact instance identity and current authenticated inventory. The budget guard limits the resource to the earlier of its deadline or its approved credit budget, reserves $0.20 for cleanup delay, and deletes the disposable VM rather than attempting unsupported stop/start. A separate deadline task provides cleanup independently of the model connection. Neither a failed inventory request nor an authentication error is accepted as proof of deletion. The official pinned NVIDIA device-auth source describes a 24-hour session-key lifetime, shorter than the remaining demo period. Task installation therefore also requires verified cleanup authority lasting through the deletion time; a current login alone is insufficient. These Brev tasks are not claimed active until those conditions and the actual cloud instance are verified.

Activation requires a recent successful synthetic two-tool application check, observed remote GPU memory, matching model digest, private SSH verification and enabled cleanup tasks. It updates persistent provider configuration and requests an application restart through the existing revision owner, preserving private data and the Cloudflare connector. A configured Brev provider takes precedence over the old local-model environment, preventing an implicit fallback to the desktop GPU.

## Evidence and remaining external setup

Safe receipts are in `deploy/receipts/`: model benchmarks, provider checksums, Mongo verification, application model tools, HTTP/authentication and current task/process state. Source tests pass on both hosts, including continuous simulation, preservation of physical cases and reservations, scoped authentication, durable replay, and Mongo SIM retention.

The parent verified the signed-in Brev account, approved terms and $60 HackUTD credits with no payment method or auto recharge. The first approved Hyperstack A6000 attempt failed provisioning; it has no verified SSH/model provider. A MassedCompute A6000 replacement at the owner-approved$0.68/hour total and $30 cap is held pending refreshable CLI authentication. Its exact instance and automatic deletion must be verified before activation. The current verified supervisor model remains the desktop GPU until that handoff succeeds. No paid OpenAI API was used. An Atlas URI is still required for an Atlas demonstration; the running database is authenticated MongoDB Community.

Official references: [Ollama model](https://ollama.com/library/nemotron-3-nano:4b), [NVIDIA GGUF model](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF), [native tool calling](https://docs.ollama.com/capabilities/tool-calling), [MongoDB Windows installation](https://www.mongodb.com/docs/manual/administration/install-community-windows/), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [official Node24 archive](https://nodejs.org/dist/v24.22.2/).
