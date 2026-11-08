# Verification — November 7, 2026 (CST)

This is a built hackathon prototype with software/CAD evidence. It has not completed physical radio or native iPhone acceptance.

| Component | Actual evidence | Still unverified |
| --- | --- | --- |
| iOS | Portable Xcode app/test targets and shared scheme; OpenStep project parse; relative file/scheme/plist checks; all9Swift files syntax parsed; golden JSON hashes match hub;10XCTest methods authored | Xcode compilation and XCTest execution; signing; native screenshots/accessibility; real BLE and USB phone power |
| Firmware | Fresh PlatformIO compile of companion, relay and hub with pinned ESP32/RadioLib/NimBLE dependencies;7native C++ protocol groups pass;12image hashes checked against release manifests | Flashing; physical chip/revision confirmation; over-air delivery/range/multihop; BLE/iPhone interoperability; power and heat |
| Hub |25Node tests pass;17JavaScript files syntax checked; npm audit0vulnerabilities; encrypted simulation confirms request, duplicate receipt, reviewed receipt and tamper rejection | Physical USB board: inventory contained Bluetooth serial ports only; no actual ESP32 connection claimed |
| Cross-language pipeline | Actual firmware portable C++ helpers fragment/reassemble and model3forwarding steps; real Node AES-GCM/core accepts request; one incident persists; lost receipt retry recovers after restart; operator receipt/export and tamper rejection pass | RF propagation, radio ISR timing and physical mesh behavior are not simulated by this harness |
| Local AI | Actual local Ollama `llama3.2:latest` through real HubCore/summary queue: hub receipt submitted in6ms, validated excerpt selection completed in6725ms for one synthetic report | No performance distribution, medical correctness or production quality claim. Original facts remain authoritative. |
| Operator browser | Actual login → synthetic encrypted report → local AI selection → human review → downloaded JSON export → logout. Layout visually inspected at1280×900 and390×844; compact page had no horizontal overflow. Export read back with simulation true, servicesContacted false, status operator-reviewed, model/method and original people count preserved | Physical phone receipt; native app UI; external dispatch integration |
| CAD | FreeCAD1.1.4 + freecad-mcp0.1.30 installed and enabled on ABHIKHUR; real MCP handshake;109successfulMCPcalls;3finalparts each one valid solid; FCStd/STEP/STL exported and actual preview inspected | Real board/adapter/port measurements, assembly, 3Dprint, mechanical strength, heat and antenna performance |

## Review corrections verified in source/tests

- Reserved iPhone request sequence IDs in Keychain before sending, independently of history/profile data, so clearing local history does not recycle hub replay IDs. A fully erased Keychain still requires a fresh phone origin.
- Late hub-received receipts cannot replace operator-reviewed status/text. Switching BLE devices cancels old transfer state and ignores stale peripheral callbacks.
- An OS-open USB port remains radio-unverified. Matching typed board status is required before hub TX; malformed/mismatched/radio-failed status fails closed. The firmware supports a bounded host status query.
- Duplicate authenticated requests share the same per-origin/global rate budget and still recover after cooldown. Serial writes have a bounded timeout.
- An early free-prose local model test introduced an unsupported quantity. Replaced that path with strict schema/index validation over original source spans. Model prose is never displayed as an accepted factual summary.

## Reproduce

From `hub/`: `npm ci`, `npm test`, `npm run check`, `npm run verify:simulation`, `npm audit --omit=dev`.

From the project root on Windows: `powershell -NoProfile -File firmware/scripts/test-native.ps1`, then `powershell -NoProfile -File integration/check.ps1`. With an already-running local Ollama and installed llama3.2 model: `node integration/verify-local-model.mjs docs/receipts/local-inference.json`. This explicit check uses synthetic data, not actual reports, and fails if the result is a fallback rather than real local inference. Its acknowledgment timing is software-only.

Firmware images/flash offsets and source hashes are in `firmware/releases/<role>/manifest.json`; build receipt is `firmware/verification.json`. iOS structural/syntax receipts and native gaps are in `ios/verification.json`. CAD receipts are in `hardware/mcp-smoke.json`, `hardware/cad-receipt.json` and `docs/cad-install.md`. The local inference receipt contains no key or private profile.

The bounded local hub, Ollama server/model process and FreeCAD RPC process used for checks were stopped after verification. No recurring job, continuing laptop service, paid inference, public deployment, real agency contact or contest submission was created. Existing ScrabbleBot/Relay files and their desktop owners were preserved. Native Mac tests and the physical bench runbook remain the next acceptance steps.


## Companion flash and BLE bench check — November 7, 2026 (CST)

Owner connected one board and explicitly requested companion flashing. Identified USB CH9102 on COM9; ROM reports ESP32-PICO-D4 revision v1.1,40MHz crystal and4MB flash. Saved a private4MB rollback image under ignored artifacts/private. Rechecked every companion image/source hash, flashed bootloader/partitions/boot_app0/application at the release offsets using bundled esptool4.11.0, and all four writes passed device hash verification.

Actual post-reset serial status: role companion, frequency915, region1,keyId1,protocol1,radioReady true. Actual Windows service-filtered BLE scan found **EmergencyMesh-24F0**; connected, discovered Nordic UART write-with-response and notify characteristics, enabled then stopped receipt notifications, and disconnected. This supersedes the earlier no-board-connected observation for this one companion. Windows service-filtered GATT enumeration returned an unsupported-command error; ordinary service enumeration succeeded. No security settings or pairing changed.

No report payload was sent over BLE or LoRa. Radio delivery, multihop, iPhone interoperability/phone power and enclosure fit remain unverified. Other board roles were not flashed. Source/firmware bytes and previously delivered ZIPs are unchanged; the new device receipt is docs/receipts/companion-flash-20261107.json. Serial port and laptop BLE connection were closed after checking.


## Hub flash and local hardware session — November 7, 2026 (CST)

Owner connected a second CH9102 board on COM10 and requested hub flashing plus a local testing launch. ROM reports ESP32-PICO-D4 rev1.1,40MHz/4MB. Preserved a private4MB rollback copy, rechecked hub image/source hashes, flashed all four release images and verified all device write hashes. Post-reset status is hub/915MHz/region1/keyId1/protocol1/radioReady true.

Started the actual USB hardware hub at http://127.0.0.1:4781 with local Ollama llama3.2:latest; authenticated API and browser show Board reports radio ready. No --simulate flag. Existing regional config and phone profile preserved. Actual bounded synthetic local-inference check passed validated-extractive-selection. Browser left authenticated for testing; previous synthetic incident remains labeled TEST REPORT. No new LoRa test request or phone receipt was exercised.

Bounded local owner started2026-11-08T03:18:50Z and expires2026-11-08T05:18:50Z (November7,11:18PM CST), then stops its app and separately owned Ollama. No recurring schedule or laptop-closed continuity claim. Keep laptop awake and board attached; restarting is required after a USB disconnect. Private runtime receipt/launcher/logs are under hub/.emergency; non-secret flash/runtime receipt is docs/receipts/hub-flash-and-launch-20261107.json.

Cosmetic naming issue observed: both boards currently derive the same node/name suffix from a shared MAC prefix. Distinct USB devices/ROMMACs were confirmed, and this does not affect frame routing/dedupe. iOS distinguishes peripheral UUIDs; choose the companion for phone BLE. Unique canonical-MAC/role naming is an open improvement, not a hardware/radio delivery claim.


## Actual hardware reports and portal selection — November 7, 2026 (CST)

Owner initially reported companion queue/hub drops/no portal data, then explicitly corrected that it was working. Authenticated live state and browser verified six non-simulated requests saved through real hardware. No raw report bodies, profile keys or locations are included in this receipt. Return receipts were submitted; phone-side receipt state was not independently observed.

Separate reproducible UI bug fixed: an old selected test incident remained in detail after filtering it out. Selection now stays within the visible filter, clears for empty results, and preserves the current visible report when others arrive.33hub tests and19file syntax checks pass; actual browser shows a received hardware report under Awaiting review. Safe bounded host/board diagnostic passthrough was added; no authentication/PHY/CRC changes. Radio diagnostic firmware was compiled for investigation but removed from source after the owner correction; no board reflash occurred and source hashes again match deployed releases.

Local app and owned Ollama were briefly restarted preserving all incidents and original regional profile. Session remains bounded to the original approximate11:18PM CST limit. Browser left signed in. Source/runtime UI fix is newer than the initial immutable ZIP handoff. Redacted receipt: docs/receipts/portal-selection-20261107.json.



## BLE role correction, public source and Harp prints — November 7, 2026 (CST)

Owner clarified that Phone subscribed moved from companion to hub, then reconnecting the companion restored operation. This is evidence of wrong BLE endpoint selection. Updated source defaults to companion-only BLE, canonical-MAC node/suffix and role-labeled companion names; hub and relay default to USB/LoRa without a BLE server.10native test groups and all3freshESP32builds pass, including verification that default hub/relay binaries omit NimBLE initialization. All release images/source hashes verified. These new images were NOT flashed to the working devices; live hub/session stayed undisturbed.

Published a fresh source-only public repository https://github.com/abhikhur27/emergencymesh, sole main branch, commit de773e53f01267ba1ff850a992580b3039a2a8eb,77files. Independent privacy audit plus explicit source manifest excludes regional secrets, reports, tokens, profiles, backups, runtime receipts, other projects and parent history. Original code MIT, third-party dependency licensing documented; prebuilt firmware binaries omitted from public distribution. Anonymous README access verified200. Public-copy33hub tests/19file syntax/encrypted simulation/audit0/10nativechecks/modeled integration pass. No native Mac build claim. Local public checkout: C:/Users/abhim/Documents/ChatGPT/emergencymesh-public. Receipt docs/public-repository.json remains in the private workspace, outside published tree.

At owner's explicit request submitted BasePrint.stl (onecopy,10:19PM) and LidPrint.stl (onecopy,10:24PM) through authenticated Harp hardware portal. Both confirmed In review, not printing-started. Included100% millimetre scale, orientation, material/color preferences and prototype-fit status. Pickup location ECSW1.160Workshop. AdapterPrint.stl submission is blocked by portal's2activeprints/team limit; next permitted after pickup. No cap bypass, cancellation, payment or extra queue job. Private request receipts/links: artifacts/private/harp-prints-20261107.json. Printed fit/quality/completion remain unverified.


## RescueMesh operational upgrade — November8,2026

The normal ECSW hub is the physical915MHz receiver with RescueMesh's neutral/magenta interface. Region, credentials and reports persist. Actual browser access survived validated replacements. Reception study:19 distinct hardware requests,29 receptions,1GPS/18without. No invented coverage or relay paths. MongoDB Community authentication and actual application user/hashed-session/device write/read checks passed through a private desktop forward.

Fresh rescuemesh-oled-v3 all-role builds and16native groups passed. The attached matched hub was flashed after a successful4MiB lower-speed rollback read; all4image write hashes passed and post-reset hub/915MHz/region1/keyslot1/protocol1/radioReady was host-validated. First high-speed backup failed; its partial file remains private. OLED appearance, updated companion installation and a fresh over-air transfer were not observed.

Actual local nemotron-3-nano:4b executed on laptop CPU/desktop GPU. One explicitly synthetic encrypted ECSW request passed durable ACK before native model tools, automatic supervisor allocation/simulateddispatch and return status; exact retry retained one dispatch identity. No radio/human review was used in that check. Supervisor17tests plus reconnect byte/count-budget regression and hub59tests plus numeric reception-date regression pass. Windows source checks are not native Xcode execution.

The bounded laptop owner preserves immutable validated releases and a disk last-good pointer. An invalid candidate retained the same receiver; valid updates changed PID/release and retained login. Actual serial readiness is checked. Desktop providers/supervisor and authenticated QuickTunnel are independently owned through2026-11-10T05Z. Dependencies are frozen; host power and physical radio attachment remain necessary.

Native FreeCAD MCP/editable enclosure files remain available. Latest Harp check shows both earlier prints cancelled; no resubmission pending clarification. Brev is signed in but TermsOfService blocks credit verification. No paid Brev resource or Atlas connection is claimed.


## Updated campus maps and both board roles — November 8, 2026

The real hub and desktop supervisor now use interactive maps with original UTD campus geometry and allocation-backed regional links. Campus framing and selected-label collision fixes passed 78 hub tests; the initial public copy passed 25 supervisor and 5 lifecycle tests plus 59 JavaScript syntax checks. The subsequent supplier-eligibility fix passed the expanded 27-test supervisor suite. Browser checks confirmed pan, zoom/reset, building and report selection, source filtering and agent activity. The immutable release includes both public catalog files; an incomplete candidate was rejected without replacing the previous receiver.

Both matched boards received rescuemesh-oled-v3 with all four write hashes verified independently. Post-flash serial status confirmed each role, 915 MHz, region 1, key slot 1, protocol 1 and radio ready. The companion advertises its canonical role-specific BLE name; only service-filtered advertisement discovery was exercised in this step, leaving it free for the phone. The original hub returned to COM10 and the owned physical receiver resumed with 20 saved reports. Fresh phone receipt, over-air delivery and physical OLED appearance remain separate checks. Safe role receipts are in docs/receipts/hub-reflash-20261108.json and companion-reflash-20261108.json.

The owner explicitly requested leaving Harp prints cancelled. Brev terms, team credits and temporary-key approval are resolved. Failed environments were removed with authenticated absence verified. The single approved-offering retry uses a plain VM without Jupyter, a conservative prior-spend allowance, an actual desktop guard and a separate enabled deadline cleanup. Actual private SSH, native 30B tools, model digest, loaded GPU memory and live provider attribution passed. The supervisor now uses Brev inference while its application/data remain on the desktop; ECSW retains local 4B. The post-fix Addison native check passed without accepting self-supply. See the dated runtime receipt and sanitized provider JSON for evidence and timing limits.
