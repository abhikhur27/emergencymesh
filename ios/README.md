# EmergencyMesh iPhone app — Mac handoff

Native SwiftUI app targeting **iOS 17+**, with a portable Xcode project and XCTest target. No CocoaPods, XcodeGen, API key, cloud account or third-party Swift dependency. Source and project were prepared on Windows; **Xcode compilation, simulator layout, signing and physical BLE operation still need the Mac checks below**. A checked-in project or source parse does not prove those checks pass.

## Open on a Mac

1. Extract the handoff ZIP. Open `EmergencyMesh.xcodeproj` in full Xcode 16+ (or newer with an iOS 17+ SDK). Trust only your own checkout; no package-install script is required.
2. Select the **EmergencyMesh** scheme. Select an iPhone simulator and Run to inspect screens. Setup → **Run local codec simulation** exercises encryption/chunk reassembly using public synthetic data. Its result is explicitly labeled simulation; it never writes to BLE or creates a confirmed Outbox request.
3. For a real iPhone, select the EmergencyMesh target → Signing & Capabilities → choose your own development Team, change `org.hackutd.EmergencyMesh` to a unique bundle identifier if necessary, keep automatic signing enabled, then select the connected phone. Enable Developer Mode on that phone if Xcode requests it. The unsigned ZIP is source, not an installable IPA.
4. Import the **private provisioning JSON** created by the hub's provisioning command through Files, or paste it in Setup's secure field. Shape: `{ "region": 1, "keyId": 1, "keyHex": "<64 hexadecimal characters>", "origin": 123456789 }`. Each phone must have a different nonzero `origin`; the hub and all phones in the demo share the region/key. Do not use the public test key from XCTest for actual reports. The app stores the profile in Keychain; the key is not compiled into the firmware or app.
5. Flash companion firmware on your board and confirm the correct frequency/matching antenna. Power it from the USB-C adapter/cable or a suitable independent supply. The USB cable provides power; phone app data uses BLE. Confirm actual phone power stability before relying on this arrangement.
6. Request → Connect → Find nearby radios → select your team's board. **Connected** is shown only after UART characteristics are discovered and receipt notifications are enabled. Grant Bluetooth access. Choose **Use current location** to opt into location access; a recent GPS fix is optional.
7. Enter the category, your reported priority, people count and at most 120 UTF-8 bytes of notes. Queue the request. Inspect Outbox while the hub and any relay are running. A local BLE write completion is only **Submitted to radio device**. Only an authenticated receipt changes it to **Hub received** or **Operator reviewed**. Neither state means emergency services were dispatched.

## Mac verification

From this `ios` directory:

```bash
bash scripts/check-mac.sh
xcrun simctl list devices available
SIMULATOR_ID=<an-installed-iPhone-simulator-UDID> bash scripts/check-mac.sh --test
```

The script lints the plist/project, lists the Xcode targets and builds without device signing. With `--test` it runs the XCTest target on an explicitly selected installed simulator. Tests compare the Swift CryptoKit result with the Node hub golden request, decode its receipt, reject tampering/wrong-region/type, check mutable relay hops, UTF-8 limits, old/unknown GPS and chunk reassembly/timeout. The public test fixture is `EmergencyMeshTests/golden-v1.json`. Xcode's Test action is an alternative.

Inspect Request, Outbox and Setup on a small iPhone and at larger Dynamic Type sizes; check dark mode, denied permissions, Bluetooth off, no device, connection loss during transfer, keyboard scrolling, explicit retry after unconfirmed status, relaunch with a queued request, and GPS older than 2 minutes. A simulator does **not** validate physical BLE, antenna/radio coverage, iPhone USB power or background reliability.

## Delivery and privacy behavior

Drafts and outbox (including the original encrypted radio bytes) are AES-GCM encrypted at rest with a random Keychain local key. The directory is excluded from app backups and uses iOS file protection. Sensitive content is covered when the app is inactive. Clear local history and key removes this phone's stored requests and profile; it cannot remove incidents already received by a hub. Nonsecret identity sequence counters remain in Keychain so reimporting the same profile does not reuse a hub replay ID. Those counters reserve each sequence before any send and survive ordinary reinstalls when Keychain is retained. If the phone is erased or Keychain is reset, provision a fresh phone origin instead of reusing an old profile. Replacing a profile while requests remain is refused so old receipts cannot be mistaken for a new profile's status.

Retries reuse identical encrypted bytes at approximately 10, 25 and 45 seconds after the first attempt, with a minimum 8-second gap when resuming delayed work. After the final attempt's receipt window (55 seconds from first send), status becomes **Delivery unconfirmed**. An explicit retry restarts this bounded sequence. Requests queued while disconnected remain on this phone. Keep the app open during the demonstration: iOS background execution is opportunistic, and timers are not guaranteed while suspended. BLE state restoration and an encrypted outbox support later resume; they do not promise continuous background delivery.

Position is included only if valid and captured within 2 minutes of queuing, with accuracy and request creation time in the packet. Otherwise the payload explicitly means unknown GPS; describe landmarks in the short note. Category/priority and special-condition flags are user reported; the app does not provide medical triage. Shared regional key holders can impersonate one another, and relay metadata/traffic remains visible. The demo is not a production identity/revocation system or an emergency-service connection.

## Files and design evidence

`EmergencyMesh/` contains the app, codec, BLE transport, location and protected storage. `EmergencyMeshTests/` contains cross-language tests. `scripts/create-project.mjs` reproduces the checked-in project with Node if source files are intentionally added/removed; ordinary Mac users need not run it. The shared scheme and source paths are relative to the ZIP root.

The generated UI target is `design/request-target.png`, actually 798×1972 pixels, inspected before UI code. It establishes warm-white/system-native/navy/orange direction. Generated High/Normal priority labels were corrected to protocol **Serious/Assistance**; menu pickers replace cramped five-way segmented controls for Dynamic Type. Native UI uses semantic system colors and scalable layout rather than reproducing generated system chrome. No matching simulator/device screenshot exists yet, so visual fidelity is unverified and no pixel-perfect claim is made.

Primary API references: [Core Bluetooth restoration](https://developer.apple.com/documentation/corebluetooth/cbcentralmanageroptionrestoreidentifierkey), [notification-state callback](https://developer.apple.com/documentation/corebluetooth/cbperipheraldelegate/peripheral(_:didupdatenotificationstatefor:error:)), [background constraints](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html).
