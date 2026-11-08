# EmergencyMesh

An offline emergency-reporting prototype built for HackUTD: **iPhone → BLE companion → LoRa mesh → USB laptop hub → local AI excerpt selection → human-reviewed demo handoff**.

The phone encrypts compact requests before sending them over BLE. Radio nodes forward opaque frames without the regional key. The hub authenticates and saves reports, sends return receipts, and presents the original information in a local operator console. This prototype has no connection to real emergency services.

## What's included

- A native SwiftUI iOS 17+ app with CoreBluetooth, CryptoKit, Keychain provisioning, optional location and a protected outbox.
- PlatformIO source for companion, relay and hub roles on standard LILYGO T3 LoRa32 V1.6.1 ESP32/SX1276 boards.
- A local Node hub with USB serial, authenticated operator access, durable replay handling and optional local Ollama extraction.
- A documented binary protocol, public synthetic cross-language fixtures, native transport tests and a modeled integration check.
- Editable FreeCAD/STEP enclosure files and three STL print parts. Mechanical fit is provisional.

This repository contains source and CAD, not prebuilt firmware, private profiles, incident data or signing credentials. Build firmware locally using the pinned dependencies. Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Start the laptop demo

Requires Node 24+ and npm.

```sh
git clone https://github.com/abhikhur27/emergencymesh.git
cd emergencymesh/hub
npm ci
npm run provision
npm start -- --simulate --minutes 30
```

Open `http://127.0.0.1:4781`. Enter the access code saved locally in `hub/.emergency/operator-token.txt`. **Send test report** uses actual encryption, validation and persistence with a clearly labeled software transport.

For physical hardware, identify the USB UART port using `npm run ports`, then use it explicitly:

```sh
npm start -- --serial <actual-port> --minutes 120
```

The hub requires a data-capable USB cable. An open port is not proof of radio readiness: the console waits for matching hub, region, key ID, protocol and radio status. Sessions are bounded; reconnecting USB requires restarting the app. [Hub setup and privacy behavior](hub/README.md).

### Optional local AI

Start an installed Ollama runtime on `127.0.0.1:11434` with a locally downloaded model, then append:

```sh
--ollama --model llama3.2:latest
```

The model selects existing note sentence indices. Software validates the selection and displays only original text spans alongside authoritative reported fields. Model prose is rejected; failures use a labeled extractive fallback. The full original remains visible. There is no automatic medical triage or dispatch.

## Build the iPhone app

Open `ios/EmergencyMesh.xcodeproj` in compatible full Xcode on a Mac. Select the **EmergencyMesh** scheme, choose a development Team and your iPhone, and build. There are no third-party Swift packages, CocoaPods or XcodeGen prerequisites.

From `ios/`:

```sh
bash scripts/check-mac.sh
xcrun simctl list devices available
SIMULATOR_ID=<installed-iPhone-simulator-UDID> bash scripts/check-mac.sh --test
```

Generate an individual private phone profile using the hub provisioning command and import that JSON in the app's Setup. Keep it out of Git and public uploads. Each phone needs a unique origin ID. The public golden test key must never be used for actual reports. [Mac signing, tests and app behavior](ios/README.md).

## Connect the devices correctly

The phone's USB-C adapter and microUSB lead supply power. **BLE carries app data.** The USB cable between the hub board and laptop carries serial data.

Use **companion** firmware for the board connected to the phone. Current source advertises it as `EM-Companion-XXXX`, derived from the device's canonical MAC suffix. Hub and relay firmware do not advertise phone BLE by default. A phone connected to a hub's legacy BLE service can leave its intended companion without a phone connection; flash the matching current role builds rather than relying on identical old device names.

All radios need the same profile. The source defaults to **915 MHz, SF7, 125 kHz, coding 4/5, sync 0x12, CRC and 10 dBm**, for a US demonstration on matching SX1276 hardware. Verify the actual board revision and antenna before transmitting. Other T3 revisions and SX1278/433 MHz boards need different hardware profiles. Attach matching antennas before radio operation. [Firmware build and bench instructions](firmware/README.md).

Two boards demonstrate a direct link. A third independently powered board enables a real relay-path test; exclude the direct path before claiming multihop delivery.

## Receipts and operator handoff

The app distinguishes **queued**, **submitted to radio device**, **hub received** and **operator reviewed**. Only authenticated receipts advance the remote delivery states. Retries reuse identical encrypted bytes, and duplicates retain one incident across hub restart.

**Mark reviewed** records a human action. **Export demo handoff** creates a JSON bundle explicitly marked simulation with `servicesContacted: false`. None of these states means responders were dispatched. Integrating an agency requires an agreed workflow and endpoint.

## Enclosure

The [hardware directory](hardware/README.md) contains an editable FreeCAD feature tree, STEP assembly, base, lid and adapter cradle STL files, and an actual CAD preview. The model was created through FreeCAD MCP native primitives and boolean operations. Board ports, display alignment and adapter dimensions still require a physical fit check before relying on the enclosure.

![Actual FreeCAD enclosure preview](hardware/enclosure-preview.png)

## Verify

```sh
cd hub
npm test
npm run check
npm run verify:simulation
npm audit --omit=dev
```

From the repository root with a C++ compiler:

```sh
sh firmware/scripts/test-native.sh
sh integration/check.sh
```

Windows with Visual Studio C++ tools can use the corresponding `.ps1` scripts. The integration check uses actual firmware C++ transport helpers and the Node hub core across modeled forwarding steps, restart recovery and tamper rejection. It does not simulate radio propagation.

See [validation scope](docs/VALIDATION.md), [architecture](docs/ARCHITECTURE.md), [protocol](docs/PROTOCOL.md) and [demo runbook](docs/DEMO.md). Firmware compilation and software tests are distinct from native iPhone, power, coverage, mechanical and emergency-service acceptance.
