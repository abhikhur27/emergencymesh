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


## November 8 typed signals, offline Temoc and native Mac acceptance

Native Mac verification passed on November 8: [run 42480891780](https://github.com/abhikhur27/emergencymesh/actions/runs/42480891780), Xcode 16.4 and iOS 18.5 arm64 simulator, all 24 XCTest methods (20 protocol/storage/GPS and 4 Temoc). The official framework was verified and extracted with native symlinks. Actual pinned Qwen weights produced a nonempty native macOS reply with a 32-token limit, in 19.854 seconds including cold loading. This does not establish native visual acceptance or base iPhone 15 performance.

The current source passes 89 hub and 40 supervisor tests plus 42/25 JavaScript syntax checks. Expanded categories and four supply flags preserve v1 frame size and old golden vectors. A flood + food + water case produced three independent allocations in an isolated cross-application check; replay did not reserve again. Original signal facts precede optional model assistance. The live hub kept all 26 saved reports and resumed automatic coordination; the cloud provider generated 12 exercise scenarios at the dated upgrade check. Current dashboard browser checks verified supplied logos, actual ACK/return counts, numeric histograms, campus building selection/zoom/reset, geographic saved-allocation edges and resource-specific status. A missing static module route and misleading legacy ACK timestamp label were fixed. Real emergency agencies remain unconnected.

The full offline Mac ZIP contains the pinned 1,117,320,736-byte GGUF and original 74,944,281-byte runtime archive. Its manifest and every decompressed payload were read back and hashed; SourceOnly is also available. No private provisioning profile, login credential or report store is bundled. Native phone layout, iPhone 15 memory/thermals/speed, Airplane Mode and a fresh physical typed-supply receipt remain acceptance work on the actual phone.


## November 8 model-download preference update

The owner selected one-time in-app model download. The default RescueMesh-Mac.zip is now download-once mode: 77,097,728 bytes, 54 entries, no GGUF, with the official pinned runtime archive included. Manifest/readback and all 53 payload hashes passed; modelBundled=false and zero GGUF entries were independently checked. Its SHA-256 is 3f7b6b2d8a5ee3def7c1745825df2eddf0a878151a4c6a2d00d10f53c7ef7f0d. SourceOnly is 2,153,247 bytes. Optional -BundleModel creates the separately named RescueMesh-Mac-Offline.zip; the old full-offline default above is superseded. Temoc downloads explicitly over Wi-Fi, verifies pinned length/SHA-256, stores in protected Application Support and uses the retained file offline. Runtime behavior is unchanged; the app setup footer and package instructions now match this choice.

## Main dashboard and two-way messaging release — November8,2026

The owner authorized promotion of the side-study dashboard changes to both main applications. The actual local and regional sites now show large reported-priority counts/graphics, people reported, attention counts and source-preserving case detail. The regional map uses attributed Leaflet1.9.4/OpenStreetMap tiles and saved resource allocations; no arbitrary radio-coverage lines are drawn. Synthetic staged browser checks exercised priority filtering, question submission, legacy-app gating, real street tiles/map controls and the390px regional layout without horizontal overflow. Normal authenticated browser sessions were then reloaded on the deployed sites.

Source verification:106 local-hub tests,48 supervisor tests and6 cross-application/C++ pipeline tests pass. Static route checks cover every new regional module and required Leaflet asset plus CSP/referrer/auth boundaries. An independent protocol review identified the capability-ACK ambiguity; the release now requires exact authenticated `RMC1|Q1|OK`. Five synthetic AES-GCM vectors match Node and Swift byte for byte.

Native iOS validation: [run42498293166](https://github.com/abhikhur27/emergencymesh/actions/runs/42498293166), commit8eed5f60012d3245ac7b17007190fd9a6d96814d, Xcode16.4, iOS18.5arm64. All35 XCTest methods executed with zero failures. Actual pinned Qwen native macOS generation passed again:99characters at a32-token limit,18.824seconds including cold loading. This is a Mac measurement, not an iPhone performance result. The new Mac handoff contains the updated source, both synthetic fixtures and the official runtime ZIP, with one-time in-app model download and no private profile.

The local desk and regional desk can ask a capability-ready phone for information. Questions and authenticated replies remain attached to the original report; answer GPS is separate evidence. Cross-application tests cover paused automation, lost acknowledgments/restart, concurrent questions, close recovery, scope rejection and no extra incident/inventory reservation. Current v1 boards need no reflash. The new physical iPhone question/reply round trip remains pending installation of the updated app.

Live checks retained30saved local reports(29radio-source and one synthetic), authenticated year-long sessions, MongoDB connectivity, local Nemotron4B configuration, the regional connection and COM10hub/915MHz/region1/keyslot1/protocol1/radio-ready status. The runtime was also corrected to keep the normal dashboard available while the USB board is missing and retry only COM10. A real normal CLI test with a nonexistent port proved authenticated saved-report access without simulated radio readiness. The existing bounded owner/wrapper and November9,11PMCentral deadline were preserved.

The desktop regional app remains behind its existing Cloudflare HTTPS address with Brev Nemotron30B via the private model forward. Successful native tool use and the current Mongo connection were observed after deployment. Generated-town wording can use the retained seeded policy when model generation times out; that attribution remains visible. No real emergency service is contacted.

The12-second product film was rendered on ABHIONEMILLION:1080p,30fps,360frames,H.264/AAC,BT.709. Genuine Blender MCP2.2.7 calls imported the native enclosure CAD, created the studio scene and rendered120product frames. The final film includes that four-second turntable. Stereo and mono PCM analysis found zero clipping. Movie SHA256:54358851d7dc01a7df959580f6ac6b0da98a95cc3b5be9f8755571fd210ccad0. Editable Remotion source and original sound design are supplied. Illustrated mesh timing does not claim measured RF latency; a hub receipt does not claim responder dispatch.

## Geographic GPS map, product film corrections and second companion — November8

The local Location card now renders original WGS84 GPS on Leaflet/OpenStreetMap, including locations without a campus building match and outside campus. ECSW is a separate gray receiver marker. Missing GPS/landmark data produces no fabricated report point. A corrected landmark does not overwrite original GPS. Browser checks covered campus/Dallas synthetic GPS, unknown location, corrections, finder/recenter and actual main-site tab transitions. Two integration defects found visually were corrected: Leaflet cached zero-sized geometry through hidden/detail reattachment, and legacy fixed-height map-host CSS clipped the new viewport. The visible main card now includes the full300px street map, meter accuracy, attribution and legend; its initial point is centered within one pixel after Activity→Requests. Hub verification passed113tests and50syntax files.

The revised product film removes gray presentation footer/tagline text, separates the phone mockup from the brand and fixes radio icon SVG clipping. Genuine Blender MCP added the confirmed short black whip and gold SMA connector to the native product scene, with unchanged printable CAD. The antenna dimensions are a visual estimate from the official kit photo, not a measured fit claim. The corrected12-second movie and six encoded sample frames were inspected; browser playback reached its end without error. Stereo/mono decoded audio has zero clipping. Corrected movie SHA256:6c0d561f4db62783a0f7b3cced050ed8c94e4269af966ea07f572424def15b38. Native four-second antenna clip SHA256:ae5ab11c4d7a8f33ef6e50a0502f8378c06ca843881dd6ced02f1e5fd145f23b. Previous outputs were backed up. The corrected handoff is dist/RescueMesh-Product-Demo-v2.mp4.

The newly connected distinct T3board was flashed onCOM11 as EM-Companion-7948 using the unchanged verifiedv3 companion firmware. Five source hashes, four image hashes, four write verifications and four explicit device readback digests passed. An original4MB rollback backup was retained privately; post-reset role/frequency/region/keyslot/protocol/radio-ready status matched companion/915/1/1/1/true. COM11 was closed afterward. The old companion and hub were not reflashed. See [sanitized second-board receipt](second-companion-flash-20261108.json). No new BLE GATT or second-phone RF test is claimed.

A separate private second-phone profile was enrolled with independent random key and origin. It is not bundled in the public source or Mac ZIP; the first phone profile stays active. The existing hub owner reloaded the registry without changing the approved deadline. After the owner reconnected the hub, COM10 typed radio-ready status, authenticated local API, MongoDB and supervisor connection were observed. Two phones must import different private profiles and select their own companion.

## Regional agent conversation view — November8

The regional Conversation workspace has All-hubs/ECSW/Plano/Garland/Addison/Supervisor channels, actor/recipient chat bubbles and links back to each source request. Concise messages derive from persisted intake, inventory snapshots, actual model tool calls/proposals, validated reservations and saved acknowledgments. This is not raw model scratchpad, a second orchestration system or invented dialogue. Town inventory replies are attributed to saved snapshots; the three exercise towns share the regional cloud model. Existing retained cases appear without a reset or extra model call.

Recorded timestamps and numeric event sequence preserve chronology, with requests before their within-event replies. Meaningful regression tests cover ordering, deduplication, scope, rejected proposals, model attribution and literal rendering of untrusted text. All59supervisor tests and32syntax files passed. The existing dispatcher summary, inventory, source data, session protection and automation state were retained. Browser verification confirmed the deployed channel selection and inventory-request→town-replies sequence. The owner then explicitly requested resuming coordination. The deployed browser confirmed Coordination active and new inventory requests, proposals, reservations and handoff receipts; no real agency dispatch is configured.
