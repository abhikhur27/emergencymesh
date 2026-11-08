# RescueMesh application storyboards

Current authority: RESCUEMESH.md. This is a full state/transition specification, not 38 separate navigation destinations. The clickable journey demonstrates the central automatic flow and exception controls. Supporting login, provisioning, database and native-device execution remain design specifications rather than deployed functions.

## Phone

Primary workspaces: Ask for help, My request, Setup. An enrolled user enters directly into asking for help. Setup never requires a cloud login during the emergency path.

| State | What is visible | Action and transition |
|---|---|---|
| P01 First use | What the companion does; power versus BLE explained briefly | Set up companion → P02. Saved valid profile skips this state. |
| P02 Enroll region | Fixed UT Dallas ECSW identity; private profile import; no secret rendered | Valid import → P03. Invalid/expired profile preserves the current valid setup and explains recovery. QR enrollment is a future authenticated convenience. |
| P03 Pair companion | Role-labeled companion list; no hub shown as a companion | Choose companion → P04. Denied Bluetooth permission offers system-setting guidance. |
| P04 Ready | Current companion connection and region; Create request | Open P05. Lost BLE preserves drafts and later reconnects. Connection alone does not prove a reachable hub. |
| P05 Ask | Categories Medical, Fire, Rescue, Safety, Supplies; people; optional note; sender situation | Category/people/note edited without losing draft. Actual values map to protocol category1–5 and severity urgent/serious/assistance. Send → P07 after validation. |
| P06 Place | Optional GPS with captured accuracy/time, typed landmark or no location | Return to draft. Manual landmark never becomes GPS; no-location send remains possible. |
| P07 Saved | Immutable saved request reference and original content | Bounded automatic transfer → P08. No duplicate identity on repeat taps. |
| P08 Await receipt | Saved on phone; submitted state if actually known; current pending status | Receipt → P09. Timeout → P11. |
| P09 Hub received | Authenticated ECSW receipt; same original request; human review pending | Remain here while agents automatically coordinate. Agent progress does not upgrade this to P10. |
| P10 Human reviewed | Explicit human-review receipt if and only if a human recorded review | View original/history or start a separate new request. No responder-arrival claim. |
| P11 Unconfirmed | Saved request; no hub receipt; last attempt available on demand | Retry same request identity and bytes; reconnect BLE. Current protocol has no cancel/edit/update semantics for a sent request. |
| P12 Local history and setup | Saved requests, region, companion and private data controls | Open a request; replace profile through validation; local data deletion has a native consequence explanation. |

Keyboard and large text must keep the current field and Send action reachable. Byte validation preserves user text and describes the recovery; no silent truncation. Native implementation must verify Dynamic Type, permissions and safe areas on the supported iOS version.

## ECSW local hub

Primary workspaces: Local requests, Regional handoffs, Reception study and Settings. The normal case proceeds automatically. Humans inspect and correct exceptions rather than approving every exchange.

| State | What is visible | Automatic behavior and optional human control |
|---|---|---|
| H01 Access | Small professional sign-in form, fixed region, Remember this browser | Valid revocable remembered session opens H02. Region/private keys remain stable across restarts; tokens never appear in the page. |
| H02 Intake | Original selected request, people, sender category/situation and location certainty | Authenticate/decode/deduplicate/persist; send hub receipt; enqueue local processing without a routing button. |
| H03 Local processing | One current processing state; source remains readable | Validate immutable fields, extract source-grounded need and missing information. Inspect summary/source on demand. No model-generated priority or invented location. |
| H04 Automatic sharing | Structured case and current supervisor-exchange state | Persist and send policy-allowed fields automatically with stable event IDs; show acknowledgment separately from sending. No Authorize regional request gate. |
| H05 Disconnected | Radio intake still usable; outbound case remains queued | Retry supervisor events with same identities. Atlas or WAN failure must not discard the local durable intake. Human can inspect or pause. |
| H06 Outcome | Regional offer/allocation/result linked to the original | Receive accepted updates and record current case state. Only actual simulated acknowledgment may advance simulated dispatch. No fabricated human review receipt. |
| H07 Exception | Missing/uncertain location, invalid structured output, conflict or operator pause | Correct case location with provenance while preserving immutable original; pause/resume automation; explicitly record human review when performed. |
| H08 Reception study | Dated sample ledger; one GPS request, manual landmarks and unlocated records distinct | Inspect captured evidence. 19 unique hardware requests and 29 receptions are historical aggregates, not live incident counts or coverage proof. |
| H09 Quiet desk | Readiness and actual last confirmed state, no invented activity | Wait for intake. No metric wall or simulated case inserted into the real queue without a source label. |
| H10 System | Region, sessions, spool/DB, radio, model and supervisor status progressively disclosed | Reconnect supported services, inspect model/runtime, revoke access. Never show a model as running before verification. |

The map and list are equivalent entry points. Unknown location stays in the unlocated list. A sender's landmark may produce an explicitly unverified schematic area; it does not establish a GPS coordinate, measured radio route or coverage polygon.

## Regional supervisor

Primary workspaces: Handoffs, Hubs, History and Simulation. One physical ECSW hub and three simulated town hubs are distinct. Example towns Plano, Garland and Addison are not represented as official agency integrations.

| State | What is visible | Automatic behavior and optional human control |
|---|---|---|
| S01 Access | Quiet authenticated sign-in and remembered revocable session | HTTPS/Cloudflare access precedes the private application. No public passwordless bypass. |
| S02 Handoffs | Selected need and offering hub; other hubs recede | Receive/deduplicate structured updates and keep per-case exchange current. Do not replicate every raw note as another chat feed. |
| S03 Hub context | Last contact, resource provenance, local versus remote model location | Detect stale hubs and exclude unavailable resources according to policy. Hub/resource list remains available without a map. |
| S04 Plan | Bounded structured need and candidate resources | Nemotron tool workflow validates need, reads the resource catalog and proposes a policy-conforming allocation. Show tool outcomes on demand, not private reasoning. |
| S05 Allocate | Accepted eligible offer and resource counts | Reserve automatically, once, with stable event identity; publish update back to ECSW. Example 2 kits, Plano8→6. |
| S06 Demo dispatch | Explicitly simulated destination and acknowledgment | Send only to simulated service endpoints; record actual mock acknowledgment. No real calls/messages or responder-arrival claim. |
| S07 History | Causal request/offer/allocation/dispatch events and outcomes | Preserve failed/pending events and retries. Filters open only when needed. |
| S08 Simulation control | Run seed, rates, scenario/resource fixtures and paused state | Start/pause/advance/reset simulated intake only. Real ECSW intake is separate. No decorative random activity mixed into actual source evidence. |
| S09 Exception | Shortage, stale hub, missing fields, invalid proposal or unavailable model | Human chooses an allowed alternate or keeps pending; may pause automation. Example Plano1 cannot supply2; Garland4→2 if alternate accepted. |
| S10 Access and sharing | Users, revocable sessions, hub/device enrollment, permitted fields and safe audit history | Enforce roles/revocation/key rotation. No private keys or raw credentials rendered. |

Ordinary information transformation, exchange and eligible simulation allocation never wait on a manual regional-support button. The human role is exception handling and oversight.

## OLED

Accepted six-state display layout remains: O01 Pair phone; O02 Phone linked; O03 Carrying a queued packet; O04 ECSW hub listening; O05 Packet in; O06 Actionable phone/radio fault. The name is RescueMesh. Physical output remains monochrome. Do not derive report-saved/hub-received/operator-reviewed semantics solely from raw radio counters. USB power has no invented battery percentage.

## Visual and execution verification boundary

Generated rasters show the intended composition. The HTML journey is a static browser prototype with synthetic state. It is not native iOS execution or an operational agent/backend integration. Production work must verify native text sizes/permissions, real radio receipts, model tool results, durable retries/restarts, Atlas behavior, encryption enrollment and authenticated HTTPS exchanges separately.
