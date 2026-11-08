# EmergencyMesh laptop hub

Local demo console, USB serial gateway, authenticated binary codec, durable incident/replay store and optional local AI extraction. No emergency services are connected. The console does not place calls or dispatch responders.

Requires Node24+. Windows and macOS are supported by the source and SerialPort; actual macOS execution remains a teammate check.

```sh
npm ci
npm run provision
npm start -- --simulate --minutes 30
```

Open `http://127.0.0.1:4781`. Paste the code from `.emergency/operator-token.txt` into the console. The code is regenerated every launch. Click **Send test report** to exercise the real encryption/validation/save/receipt pipeline using software transport. Test incidents are labeled. Simulation does not prove BLE, radio, range or phone power.

For hardware, flash the hub board firmware, connect a **data-capable** USB cable, identify its port and start:

```sh
npm run ports
npm start -- --serial COM9 --minutes 120
# macOS example; replace with the actual discovered path:
npm start -- --serial /dev/cu.usbserial-0001 --minutes 120
```

Choose the actual USB UART board. Windows Bluetooth serial ports are not the ESP32. Serial baud is115200. Opening the OS port only means **USB port open, radio unverified**. The host requests `{"op":"status"}` immediately and twice during boot. Transmission remains blocked until the board reports `radioReady:true`, role `hub`, protocol1, matching region/key ID and frequency915MHz. Missing/malformed status, a profile mismatch or radio initialization/receive failure is visible and blocks host transmission. **Board reports radio ready** is a firmware self-report, never proof of range, RF reception or phone delivery. A host write or firmware queued message also does not confirm delivery. If the port closes, restart the bounded hub session after reconnecting; reports and encrypted receipts remain saved.

## Private provisioning

`npm run provision` creates a random regional AES256 key in `.emergency/config.json` if absent and a new unique private phone profile `phone-profile-<time>-<random>.json` on every call. It prints paths, never the key. Existing hub configuration is preserved. Transfer the phone profile privately to the iPhone app's provisioning flow. Each phone needs its own origin/profile but shares the regional key for this demonstration. The app stores its imported key in Keychain; radio firmware has no key.

Profile format:

```json
{"region":1,"keyId":1,"keyHex":"<64 hexadecimal characters>","origin":123456789}
```

Never use the public fixture key in `fixtures/golden-v1.json` for actual reports. A shared key allows any provisioned participant to impersonate another sender or hub. This demo does not provide field-grade enrollment, identity verification or revocation. Firmware region must match the profile. For another region use `node src/cli.mjs provision --region 2 --data .emergency-region2` and start with the same `--data` path.

The ignored `.emergency` directory holds the key, operator access code and plaintext incident details for the local console. Files use restrictive Unix permissions where supported; Windows uses the current user's filesystem ACLs. At-rest encryption and centralized access control are outside this prototype. Keep synthetic data in the demo and protect the laptop/OS account. Source archives must exclude `.emergency`, `node_modules`, logs and artifacts.

## Optional local AI

With Ollama already installed and serving on `127.0.0.1:11434`, and an already downloaded model:

```sh
npm start -- --simulate --ollama --model llama3.2:latest --minutes 30
```

`OLLAMA_MODEL` is also supported. The hub never downloads models and never uses a cloud inference endpoint. It sends only to the fixed loopback endpoint. Turn off Ollama cloud features in the host's setup if needed. Inference has a12second timeout, a bounded queue and100output-token limit. The encrypted receipt is persisted and submitted before inference begins.

The model selects at most three existing sentence indices from the reported note. Software validates those indices and builds the displayed summary from original structured fields and **exact source spans**. Model-generated free prose is rejected. Priority, people, location and concern flags always come directly from the authenticated report. A selection may omit detail; the full original remains visible and authoritative. Timeout, malformed output or unavailable model produces a visibly labeled extractive fallback. Input reports remain unverified user claims. No AI triage, diagnosis, advice, action execution or automatic escalation exists.

## Operator handoff

**Mark reviewed** persists the operator action and sends an authenticated status2receipt referencing the original request. It means reviewed by a demo operator; it never means services dispatched. **Export demo handoff** becomes available after review and downloads a JSON bundle containing the original report, source-based summary and explicit `simulation:true`, `servicesContacted:false` labels. Integrating a real dispatch agency requires an agreed endpoint/workflow, authorization, service availability, operator procedures and separate validation.

New requests outside24hours in the past or5minutes in the future are rejected. Exact authenticated duplicates resend the original/current receipt and retain one incident, including after restart. A changed encrypted payload reusing the same region/origin/sequence is rejected. The journal retains up to4096incidents and replay identities; full storage fails closed rather than silently losing replay history. Authenticated-request limits, including duplicates, are30per origin/minute and120total/minute, preventing unlimited receipt amplification. Shared regional-key holders can exhaust quotas; field abuse resistance is not solved by this demo.

## Checks

```sh
npm test
npm run check
npm run verify:simulation
npm audit --omit=dev
```

Tests cover encryption/nonce/AAD integrity, UTF8byte limits, malformed frames, unknown profiles, stale reports, replay conflicts, saved-before-ACK ordering, duplicate/retry/restart recovery, operator export gating, local API auth/origin/Host/CSRF protection, serial framing recovery and constrained local-model output. `verify:simulation` runs a serialized encrypted request through the actual hub core and decrypts both received/reviewed receipts, checking tamper rejection.

The HTTP server binds only127.0.0.1, rejects arbitrary Host and Origin values, requires HttpOnly SameSite=Strict session cookies and per-session CSRF tokens for mutations, and uses a restrictive CSP. Loopback HTTP cookies are intentionally not Secure. Do not expose this server using a tunnel or public listener. Sessions end after120minutes by default; `--minutes` accepts up to1440. This is a foreground bounded demo, not a background service or continuing laptop deployment.

Primary implementation references: [Node crypto](https://nodejs.org/api/crypto.html), [SerialPort API](https://serialport.io/docs/guide-usage/). Shared wire/BLE/serial contract is [PROTOCOL.md](../docs/PROTOCOL.md).
