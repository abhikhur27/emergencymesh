# RescueMesh ECSW hub

Local operator workspace, USB LoRa gateway, enrolled-device authenticated codec, durable request store and automatic regional coordination. The physical ECSW hub receives actual radio reports; all emergency-service dispatch remains simulated.

Requires Node24+. From this directory:

```sh
npm ci
npm run provision
npm start -- --simulate --minutes 30
```

Open `http://127.0.0.1:4781`. Sign in as **operator** with the password in the private `.emergency/operator-token.txt`. The existing token is preserved across starts. Remember this browser creates a revocable persistent cookie; signing out invalidates it. A browser session does not expose its token in the interface. Software test reports are labeled and have a separate source filter.

## Physical radio and local Nemotron

```sh
npm run ports
npm start -- --serial <actual-USB-UART-port> --ollama --model nemotron-3-nano:4b --minutes 120
```

Use the actual port from `npm run ports`; Bluetooth serial ports are not the ESP32. The cable must carry data. Serial baud is115200. The host requests board status during boot and requires a matching hub role, protocol, region, key slot and915MHz radio profile before transmitting. An open USB port and board-ready self-report do not establish RF delivery or range. Reports and receipts persist if the serial session stops; reconnect and restart the session deliberately.

Ollama must already serve the installed local model at `http://127.0.0.1:11434`. The hub never downloads a model or substitutes cloud inference. The actual `nemotron-3-nano:4b` native resource tool workflow has been exercised on the laptop CPU; cold inference may take longer than a warm request. The interface reports the latest observed model source/success/error rather than assuming availability.

Intake authenticates, saves the original and submits its hub-received receipt before model or supervisor work. The agent validates the original category, sender priority, people count and note, calls `lookup_resources`, validates the returned arguments, then prepares a structured case using source policy. It cannot rewrite source fields or invent a dispatch. Timeouts, invalid tools and overload use a labeled rules fallback. A durable revisioned outbox retries supervisor delivery without creating a second case.

## Stable region and private runtime

The public reference is `../regions/utd-ecsw.json`. The first start creates `.emergency/region-profile.json`; later starts preserve it. The offline campus schematic uses normalized landmark positions and never claims GPS coordinates, radio coverage or relay paths. Multiple landmarks in a note remain ambiguous until an operator corrects the case. Corrections annotate the case; the original phone request remains unchanged.

The private `.emergency/runtime.json` controls optional integration settings. Its shape is:

```json
{
  "hubId": "ecsw",
  "hubName": "ECSW",
  "model": "nemotron-3-nano:4b",
  "mongoUri": "<private authenticated MongoDB URI>",
  "mongoDatabase": "rescuemesh_hub",
  "supervisorUrl": "<configured supervisor HTTPS origin>",
  "supervisorToken": "<private scoped ECSW machine credential>",
  "supervisorPublicUrl": "<operator-facing supervisor HTTPS origin>"
}
```

Keep actual values out of source control, screenshots and logs. Missing supervisor settings leave work visibly pending in the local outbox. The supervisor must explicitly authorize this hub's machine credential. Public URL validation and browser operator authentication are independent of hub-to-hub authorization. The laptop operator server binds only loopback and should not be publicly tunneled.

## Device enrollment and message privacy

`npm run provision` preserves existing hub configuration and emits a new private phone profile. Each new phone gets a nonzero origin and independent random256-bit key. Transfer the file privately and import it in the iPhone app. Radio firmware and relays do not hold content keys. Profiles contain the compatible fields `region`, `keyId`, `keyHex`, `origin` plus device metadata; the common demo key slot is not a common secret.

The hub resolves `(region, origin, keyId)` in its enrolled registry and rejects unknown or revoked tuples. Keys are authenticated and wrapped under a separate private hub master. Registered legacy profiles remain explicitly labeled and retain their old shared-key limitations; replace them with independent profiles to remove sibling access. Startup migration enrolls only explicitly known existing private profiles and does not accept arbitrary senders using the old regional key. A copied profile clones its identity. A compromised running hub can read its received reports. [Detailed key contract](../docs/device-security.md).

The wire remains compact AES-256-GCM v1: authenticated header, nonce, compact binary request and full tag. Retries reuse sealed bytes. Relay hop metadata may change while authenticated content remains opaque. Compression is not applied to ciphertext. Public deterministic fixtures use public keys and fixed nonces only for tests.

## Operator workflow and reception study

Local requests starts with **Radio reports** and the original selected message. Original category, priority, people and note stay visible or available in source details. ECSW automatically transforms and shares new reports with the regional supervisor; there is no request-support or authorization gate. Historical reports from before this feature are not silently replayed into new allocations.

Inspect summary opens the validated summary and optional agent activity. Correct location saves an annotation and automatically shares a new revision for an existing coordination case. Pause automation stops new coordination work while preserving radio intake and saved state. Regional handoffs shows actual acknowledged revisions, allocation and simulation status.

**Record human review** is an explicit optional action. It persists that decision and submits a separate authenticated operator-reviewed receipt. Automatic agent work never impersonates this review. A receipt submitted to the serial transport is not confirmation that the phone received it. Export remains a simulation-only API operation; no real emergency service is contacted.

Reception study aggregates saved hardware reports. A distinct request counts once even if it was received repeatedly. RSSI/SNR are latest receiver observations, not end-to-end reliability or range estimates. Missing GPS remains missing. A note naming one recognized landmark is an approximate reference, not a verified sender position. Actual GPS and recorded accuracy appear in source details; the non-georeferenced schematic does not plot them.

## User storage and durability

The private local identity store preserves salted operator password hashes, hashed browser sessions and safe enrolled-device metadata. Authenticated MongoDB mirrors those user/session/device records when configured; the application exposes actual connected/degraded status. Local Community MongoDB authenticated read/write was verified for this implementation. Atlas is not configured or claimed.

The incident JSON spool and coordination outbox remain durable when MongoDB or the supervisor is unavailable. After decryption, incident files contain sensitive plaintext and are not encrypted at rest by the hub. Registry wrapping does not protect a stolen wrapping master stored beside it. Protect the OS account and private data directory. Unix restrictive modes are applied where supported; Windows access follows the current filesystem ACLs.

New reports outside24hours in the past or5minutes in the future are rejected. Exact duplicates retain one saved incident and resend the current receipt across restart. Conflicting reuse of an authenticated request identity is rejected. Bounded replay journals fail closed when full; rate limits and queue bounds do not guarantee field abuse resistance or delivery.

## Checks and limits

```sh
npm test
npm run check
npm run verify:simulation
```

Tests cover codec integrity, enrollment/sibling-key rejection, malformed/stale/replayed requests, saved-before-ACK ordering, persistent sessions and logout revocation, CSRF/Host/Origin checks, serial readiness, local-model tools, automatic coordination retries, location revisions and immutable originals. Simulation executes actual codec/core logic without proving radio propagation, iPhone power or native BLE behavior.

The HTTP server uses HttpOnly same-site cookies, CSRF tokens and a restrictive CSP; loopback HTTP cookies are intentionally not Secure. The CLI is bounded to120minutes by default, with `--minutes` up to1440. A host deployment owner may manage a separate bounded runner; starting this CLI does not install a recurring task. No Brev GPU instance has been provisioned; its signed-in workspace is blocked by Terms of Service acceptance and the credit balance is unverified. The regional supervisor currently uses an independently managed local desktop GPU. Native Mac/iPhone checks, current companion flashing, true RF multihop, coverage and enclosure fit require separate receipts.
