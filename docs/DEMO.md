# Demo runbook

Use synthetic information. No real emergency service receives anything from this prototype. A local receipt or operator-reviewed receipt never means responders were dispatched.

## Bench setup

- Companion board attached to a USB-C iPhone through the supplied adapter and microUSB lead. BLE carries data. Use a power bank for the first independent board check if phone power is unreliable.
- A matching antenna on **every** radio before transmission. Confirm the actual board is standard LILYGO T3 LoRa32 V1.6.1 SX1276, not TCXO/SX1278, and use the same915MHz PHY profile on each node.
- Hub board attached to the laptop with a known **data** cable. Use `npm run ports` from `hub/` to list ports when available; a successful port listing is not a connected board receipt.
- Optional third relay on independent power. A two-board link demonstrates the request/receipt pipeline; it does not demonstrate multihop forwarding.
- Mac with compatible Xcode for signing/building the app. iOS simulator can exercise UI and explicit demo states; real BLE and phone accessory power require a physical iPhone.

Read the module READMEs for exact commands. Flash only the matched environment for each role. Source and compiled firmware are separate deliverables; a binary build does not establish radio compatibility or range.

## Provision and run

1. Generate a fresh private profile with the hub provisioning command. Keep the resulting key file out of Git, screenshots, presentation slides and public zip files. Import the phone profile privately into the iOS app. Each real phone needs a distinct origin ID; share the regional key only within the demo group.
2. Start the local hub on127.0.0.1:4781, selecting the USB port for the hub board. Open its local console, authenticate with its private operator token, and confirm the transport reports connected. The simulation flag explicitly selects a synthetic transport instead.
3. For local model summaries, start the existing Ollama runtime bound to127.0.0.1 with cloud disabled and an installed local model. Launch the hub with `--ollama --model llama3.2:latest`. If the model is missing or slow, the console must label the fallback extraction; do not call it AI inference. Keep raw source visible.
4. Build/sign the app on the Mac, install on the physical iPhone, grant Bluetooth when needed and optional location on request. Scan for the companion and select it. Confirm notifications are subscribed before submitting a report.
5. Submit a synthetic rescue report with one clear observable fact. Demonstrate the sequence: pending → submitted locally → hub received. The console should contain one incident with the original values, link metadata and a separate summary.
6. Human operator reviews the source and marks reviewed. Show the authenticated **operator reviewed** receipt on the phone and the simulation-only dispatch export. No outgoing email,911 call, web request to an agency or public dispatch occurs.

## Fault demonstrations

- Unplug or switch off the hub: local submission must remain unconfirmed. The phone may retry the same encrypted bytes; it must not claim remote delivery.
- Restore the hub and retry: one incident should appear, with an authenticated receipt. Duplicate identical requests must return the existing receipt without duplicate incidents.
- Restart the hub: prior incident/replay state should survive. Retried bytes should still resolve to the existing incident.
- Deny location: the report must say location unknown, never display an old coordinate as current. Check reported accuracy/time before using a location.
- Disconnect BLE midway: the encrypted outbox should remain available and retries must wait for a ready connection.
- Change one encrypted byte in the software integration harness: the hub must reject it without incident or receipt.
- With three nodes, disable/attenuate the direct link and prove the relay from actual radio logs and returned receipts. The software harness only verifies forwarding behavior in a model, not real RF propagation.

## Stop

Stop the foreground hub and owned bounded Ollama/CAD test processes after review. No schedule or continuing laptop service is installed. Persistent operation, if later requested, belongs on ABHIONEMILLION and needs a separate verified owner/expiry/power setup. Preserve only non-secret synthetic receipts; delete private profiles/state deliberately when retiring the demo region.
