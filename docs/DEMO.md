# Demonstration runbook

Use synthetic reports. No real emergency service receives information from this prototype.

## Bench setup

- A matching standard LILYGO T3 LoRa32 V1.6.1 ESP32/SX1276 companion and hub, each with a matching antenna attached before transmitting.
- A data-capable microUSB lead between the hub and laptop. A charge-only lead is insufficient.
- A physical iPhone with the signed app and companion power connection. BLE carries app data; the cable supplies power. Start with an independent USB supply if phone power needs diagnosis.
- An optional third radio on independent power for a controlled relay-path test.
- A compatible Mac/Xcode installation for app signing and native testing.

## Provision

From `hub/`, run `npm ci` and `npm run provision`. The hub creates a private configuration and individual phone JSON under ignored `.emergency/`. Import the phone JSON into the iOS app's Setup. Keep it out of Git, screenshots and public uploads. Each phone needs a unique origin ID; all devices in the same demo region share the regional key.

Build and flash the matched firmware roles following [firmware/README.md](../firmware/README.md). Only the companion should advertise the phone BLE service in current default builds. A historical build that advertised both hub and companion could let the phone connect to the wrong board; use role-specific current builds.

## Run

1. Identify the actual hub serial port with `npm run ports`. Start `npm start -- --serial <actual-port> --minutes 120`. Use `--simulate` instead only for an explicit software-only demonstration.
2. Open `http://127.0.0.1:4781` and enter the current local operator code from `.emergency/operator-token.txt`. Confirm that the board reports the expected hub role, radio readiness and region/profile. Port-open status alone is insufficient.
3. For local extraction, start a local Ollama runtime with an installed model and append `--ollama --model llama3.2:latest`. Missing or slow inference is a labeled fallback, not a successful AI result.
4. In the iOS app, connect to `EM-Companion-XXXX` and wait for receipt notifications to be enabled. Request optional location when needed. Confirm the chosen phone/adapter/cable supplies stable power.
5. Send a short synthetic report. Observe submitted-local state, a single hub incident and an authenticated hub receipt. Inspect original fields and note before using any summary.
6. Human operator marks reviewed. Observe its separate receipt and the simulation export. Neither action dispatches responders.

## Fault checks

- Unplug the hub: local submission must remain unconfirmed. Restore USB and restart the hub session; retry should retain one incident.
- Restart the hub: durable replay state and existing receipts should survive.
- Deny location: the request must say unknown rather than use an old coordinate.
- Interrupt BLE transfer: the protected outbox should remain available; retries wait for a ready link.
- Modify one ciphertext byte in the integration test: authentication must reject it without incident creation.
- To prove a relay, exclude the direct path and record an actual returned receipt. A topology drawing or software harness is insufficient.

Stop foreground services when the bounded test ends. Protect the hub laptop and OS account: the local incident store is plaintext for the operator console. Real field deployment additionally needs identity/abuse controls, data retention, measured power/coverage/thermal behavior, physical fit and an agreed agency workflow.
