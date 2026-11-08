# RescueMesh Mac handoff

Send **`dist/RescueMesh-Mac.zip`** to your teammate with a Mac. The default handoff uses **download once in the app**: it contains 13 app Swift files, two XCTest source files, the TemocRuntime Swift package and its sources, Xcode project/shared scheme, native logo assets, design concepts, public synthetic encryption fixture, licenses and verification notes. It includes the untouched **74,944,281-byte official llama.cpp b5046 ZIP**, but no Qwen model weights. Expect an archive around **77 MB**. After installation, use **Temoc → Set up → Download model over Wi-Fi** for the approximately 1.12 GB model; the app checks its exact length and SHA-256, keeps it on the phone and then runs offline. No private profile, login token, runtime database, build output or Windows-extracted framework is included. The installed app is **RescueMesh**; the Xcode project/scheme remain **EmergencyMesh**.

The optional **`dist/RescueMesh-Mac-SourceOnly.zip`** and public Git source also omit the framework archive. They require a first Swift Package Manager runtime download and the same one-time in-app model download/import before open-ended Temoc chat. Saved offline guides are included in every mode. An explicitly requested full offline handoff can be built with `-BundleModel` as **`dist/RescueMesh-Mac-Offline.zip`**, about 1.19 GB.

## Open, build and run

1. Extract the archive. In Terminal, enter the extracted `RescueMesh-Mac` folder and run:

   ```bash
   bash scripts/prepare-mac.sh --open
   ```

   This verifies the original official runtime archive, restores `TemocRuntime/Vendor/llama.xcframework` using macOS `ditto`, checks its framework symlinks and opens Xcode. In the optional offline-bundled mode it also verifies the model. Prepare **before** package resolution. The original archive is intentionally carried intact because Windows extraction can turn macOS symlinks into text files. Full Xcode 16+ with an iOS 17+ SDK is required; install Xcode and any needed SDK/simulator components in advance for an offline build. No CocoaPods, project generator or chat API key is required.
2. Select the **EmergencyMesh** scheme and an installed iPhone simulator, then Run. The app has Report, My requests, Temoc and Setup navigation. Setup’s **Check encryption locally** uses synthetic data and does not use the radio.
3. In Terminal, from the extracted `RescueMesh-Mac` folder, run:

   ```bash
   bash scripts/check-mac.sh
   xcrun simctl list devices available
   SIMULATOR_ID=<installed-iPhone-simulator-UDID> bash scripts/check-mac.sh --test
   ```

4. For a physical iPhone, choose your development Team under the EmergencyMesh target’s Signing & Capabilities, set a unique bundle identifier if necessary and enable automatic signing. Select the connected iPhone and enable its Developer Mode if prompted. This ZIP is unsigned source; it is not an installable IPA.
5. Obtain the private per-phone provisioning JSON separately from the hub owner. Import it in Setup through Files or paste it into the secure profile field. The public golden fixture key in the archive is for tests only. Each newly enrolled phone needs an independent random key and nonzero origin. No real key is compiled into this app or the relay firmware.
6. Power the companion board, connect through the app’s Bluetooth flow, then complete the single Report form and tap **Send**. Available fresh GPS is included automatically; no separate review screen is required. USB supplies board power; BLE carries phone data. **Waiting for the hub** means the BLE transfer finished. **Received by the hub** requires an authenticated hub receipt. Neither means emergency services were dispatched.
7. On Wi-Fi, open **Temoc → Set up → Download model over Wi-Fi**. Let the download and verification finish, then relaunch and test a benign preparedness question in Airplane Mode. The model persists under the app’s protected `Application Support/TemocModels/` directory; ordinary later chats do not redownload it.

The application README covers profile shape, BLE states, location freshness, bounded retries, protected storage, revocation limits, 20 protocol XCTest methods and four Temoc methods. Temoc uses Qwen2.5 1.5B Q4_K_M locally through llama.cpp, with separate encrypted chat histories, recent-context limits and saved safety guides. It has no radio tools and cannot send a request or contact help. Model correctness, medical suitability and iPhone inference performance are not established by packaging or a simulator build.

## What is verified

The Windows packaging script checks the reviewed 13 app, two test and two runtime Swift sources; app/test project references; local Swift package reference; native assets; plist display name; shared scheme; public fixture equality; and all decompressed ZIP payload hashes. Modes containing the runtime archive require its exact length, SHA-256 and macOS framework symlink metadata. `-BundleModel` additionally requires the exact model length and SHA-256. `MANIFEST.json` records `download-once`, `source-only` or `offline-bundled` mode, dependency pins and every payload’s relative path, length and SHA-256. The manifest itself is read back before each payload is streamed through SHA-256. The previous deliverable is replaced atomically only after those checks pass.

**Windows packaging does not execute Xcode, XCTest, simulator rendering, model inference or physical BLE/LoRa/phone-power checks.** Read the dated `verification.json` and `TemocRuntime/verification.json` receipts for the latest recorded native checks. Run the Mac checks above, inspect small-screen and large-text layouts, test local generation disconnected from the internet, and exercise a real companion and hub before claiming those results.

## Rebuild the handoff on Windows

From the repository root:

```powershell
pwsh -NoProfile -File emergency-mesh/scripts/package-mac.ps1
# Optional small handoff; no weights or runtime archive:
pwsh -NoProfile -File emergency-mesh/scripts/package-mac.ps1 -SourceOnly
# Optional full offline handoff, only when explicitly wanted:
pwsh -NoProfile -File emergency-mesh/scripts/package-mac.ps1 -BundleModel
```

The script prints the absolute ZIP path, mode, SHA-256, byte size and file count after verifying the archive. Default mode requires the already downloaded pinned archive at `ios/TemocRuntime/llama-b5046-xcframework.zip`. Only `-BundleModel` additionally needs `ios/EmergencyMesh/TemocModel/qwen2.5-1.5b-instruct-q4_k_m.gguf`; `-SourceOnly` needs neither large dependency. The script streams files without loading the model into memory and embeds model/archive bytes without recompression. It copies only allowlisted source/documentation plus JSON/PNG/PDF files under the reviewed native asset catalog. New Swift files require an allowlist/project review. Public source publishing must continue to exclude model weights and `TemocRuntime/Vendor`.
