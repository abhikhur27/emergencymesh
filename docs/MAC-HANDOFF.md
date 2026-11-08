# RescueMesh Mac handoff

Send **`dist/RescueMesh-Mac.zip`** to your teammate with a Mac. It contains the native iPhone application source, Xcode project and shared scheme, all nine Swift files, the public cross-language encryption fixture, current design reference, verification notes and Mac check scripts. It contains no private device profile, hub login token, runtime database or dependency directory. The app shown on the phone is named **RescueMesh**; the Xcode project and scheme retain the compatible name **EmergencyMesh**.

## Open, build and run

1. Extract the archive and open `RescueMesh-Mac/EmergencyMesh.xcodeproj` in full Xcode16 or newer with an iOS17+ SDK. No third-party Swift packages, CocoaPods or project generator is required.
2. Select the **EmergencyMesh** scheme and an installed iPhone simulator, then Run. The app has Request, My requests and Setup navigation. Setup’s **Check encryption locally** is a radio-free check using synthetic data.
3. In Terminal, from the extracted `RescueMesh-Mac` folder, run:

   ```bash
   bash scripts/check-mac.sh
   xcrun simctl list devices available
   SIMULATOR_ID=<installed-iPhone-simulator-UDID> bash scripts/check-mac.sh --test
   ```

4. For a physical iPhone, choose your development Team under the EmergencyMesh target’s Signing & Capabilities, set a unique bundle identifier if necessary and enable automatic signing. Select the connected iPhone and enable its Developer Mode if prompted. This ZIP is unsigned source; it is not an installable IPA.
5. Obtain the private per-phone provisioning JSON separately from the hub owner. Import it in Setup through Files or paste it into the secure profile field. The public golden fixture key in the archive is for tests only. Each newly enrolled phone needs an independent random key and nonzero origin. No real key is compiled into this app or the relay firmware.
6. Power the companion board, connect through the app’s Bluetooth flow, then send a short request. USB supplies board power; BLE carries phone data. **Waiting for the hub** means the BLE transfer finished. **Received by the hub** requires an authenticated hub receipt. Neither means emergency services were dispatched.

The detailed application README includes profile shape, BLE states, location freshness, bounded retries, protected local storage, revocation limitations and the14 authored XCTest methods.

## What is verified

The Windows packaging script checks all required filenames, nine Swift project references, plist XML and RescueMesh display name, shared app/test scheme, fixture equality with the hub, and every decompressed ZIP payload’s SHA-256. `MANIFEST.json` inside the archive records each file’s relative path, byte length and hash. This establishes package integrity and completeness for the checked source snapshot.

**Native Xcode compilation, XCTest execution, simulator rendering and physical BLE/LoRa/phone power have not been verified by packaging on Windows.** Run the Mac checks above, inspect small-screen and large-text layouts, and test a real companion and hub before claiming those results. The current `verification.json` separates source checks from unexecuted native checks.

## Rebuild the handoff on Windows

From the repository root:

```powershell
pwsh -NoProfile -File emergency-mesh/scripts/package-mac.ps1
```

The script prints the absolute ZIP path, SHA-256, byte size and file count after reading back and verifying the archive. It copies only explicitly listed public iOS source and documentation. If the iOS owner intentionally adds a Swift file, update both the Xcode project and packaging allowlist before rebuilding. Native asset catalogs are included when present.
