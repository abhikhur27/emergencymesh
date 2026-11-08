# Temoc on-device assistant

Temoc means Technical Emergency Operations Coordinator. It is a separate peer tab in the native iPhone app. It runs a downloaded language model inside the app; it does not use the ECSW model, Brev, a chat API, Bluetooth or LoRa. It cannot send a report, contact an operator, obtain live conditions or confirm that help is coming. The Reporting tab remains independent.

## Pinned runtime and model

| Part | Pinned artifact |
| --- | --- |
| Runtime | Official ggml-org/llama.cpp `b5046` XCFramework, MIT |
| Archive | `https://github.com/ggml-org/llama.cpp/releases/download/b5046/llama-b5046-xcframework.zip` |
| Runtime archive SHA-256 | `c19be78b5f00d8d29a25da41042cb7afa094cbf6280a225abe614b03b20029ab` |
| Model | Official `Qwen/Qwen2.5-1.5B-Instruct-GGUF`, Q4_K_M, Apache 2.0 |
| Model revision | `91cad51170dc346986eccefdc2dd33a9da36ead9` |
| File | `qwen2.5-1.5b-instruct-q4_k_m.gguf` |
| Exact file bytes | `1,117,320,736` |
| Model SHA-256 | `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e` |

The binary archive was actually downloaded and its SHA-256 matched the official example. Its iOS arm64 and simulator slices, C module map `llama`, and pinned C header were inspected. Native Swift APIs follow the [official pinned Swift example](https://github.com/ggml-org/llama.cpp/blob/b5046/examples/llama.swiftui/llama.cpp.swift/LibLlama.swift) and [pinned C API](https://github.com/ggml-org/llama.cpp/blob/b5046/include/llama.h). The [official XCFramework instructions](https://github.com/ggml-org/llama.cpp/blob/master/docs/xcframework.md) document binary integration. The [official model card](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF) identifies the architecture, quantizations and license.

The local Swift package at `ios/TemocRuntime` exports product `TemocRuntime`. Its binary target is named `llama`, matching the framework/module. The manifest checks for the vendored framework relative to its own file, rather than the caller's working directory. The full Mac handoff includes the untouched official framework ZIP. Run `bash scripts/prepare-mac.sh --open` on the receiving Mac to verify its checksum and restore `Vendor/llama.xcframework` with native framework symlinks. A source-only checkout resolves the same checksum-pinned official archive through Swift Package Manager. The two license texts are included in the package directory.

The app discovers a bundled model in `TemocModel/`, `Models/`, or the app resource root. A bundle containing the model requires no model network download. An unbundled build offers explicit import or one-time Wi-Fi download from the pinned official Hugging Face revision. File length and a streaming SHA-256 must both pass before loading. A failed or cancelled verification does not install the file. Chat text, GPS and profile keys are not part of a model download.

## Execution bounds

The configuration targets the base iPhone 15. It uses a 2,048-token context, at most 320 generated tokens, prompt batches of 256, two decode threads and four batch threads. Device builds request Metal offload; simulator builds use CPU. Model weights are memory-mapped. These choices limit resource use; they are not a measured iPhone memory, speed, battery or thermal guarantee.

One actor owns the model/context. A thread-safe cancellation gate is available independently of actor scheduling, including a native load-progress callback and decode abort callback. Stop, leaving the tab, entering the background and memory-pressure notifications cancel generation; the model is then unloaded. Each reply clears its KV cache and rebuilds only that chat's bounded recent context using actual tokenizer counts. Older messages remain in encrypted history. User/history strings cannot inject ChatML role delimiters.

## Local history and controls

Chats use an independent AES-256-GCM file and a separate Keychain service, with a device-only key. The directory is excluded from app backups and the file uses iOS protected storage. A corrupt file or missing key fails closed and preserves the existing encrypted data. This is separate from the reporting profile, sequence counter and outbox.

New chat creates a separate context while preserving prior chats. History lets the user reopen or explicitly delete a chat. Storage is bounded to 20 chats and 80 messages per chat; a full archive requires a new chat or deliberate deletion instead of silently discarding history. A cancelled or interrupted reply is marked as interrupted. Native model output is withheld until a small output screen checks for obvious medication-dose and false dispatch/contact claims. This screen is a limited safeguard, not a clinical safety classifier.

## Guidance boundaries

The system prompt is in `TemocSafety.swift`: calm, concise help; one useful next step; honest uncertainty; no diagnosis, medication doses, invasive care, dangerous procedures, invented local facts or claims of contacting help. Source/profile secrets are not requested, and likely private-key pastes are rejected before saving a message.

Recognized high-risk medical messages use explicit saved guidance rather than an unvalidated model diagnosis. Saved guides remain available when no model is installed. They cover severe bleeding, drinking-water precautions, floodwater, power outages and a gentle grounding exercise. They are short, attributed paraphrases checked November 8, 2026, not a replacement for professional help or a complete first-aid course. Unknown or paraphrased risks may evade keyword matching; the assistant is not clinically validated. No crisis hotline number is invented or generated by the app.

Primary guidance references:

- [American Red Cross: life-threatening external bleeding](https://www.redcross.org/take-a-class/resources/learn-first-aid/bleeding-life-threatening-external)
- [CDC: make water safe in an emergency](https://www.cdc.gov/water-emergency/about/index.html)
- [CDC: floodwater safety](https://www.cdc.gov/floods/safety/floodwater-after-a-disaster-or-emergency-safety.html)
- [CDC: power-outage precautions](https://www.cdc.gov/natural-disasters/response/what-to-do-protect-yourself-during-a-power-outage.html)
- [WHO: Doing What Matters in Times of Stress](https://www.who.int/publications/i/item/9789240003927)

Opening a source link requires connectivity. Reading the included summaries does not. Temoc does not automatically escalate a chat or copy it into a report; users choose what to report separately.

## Native acceptance

The image target `ios/design/temoc-target.png` was inspected before implementing the SwiftUI view (852 × 1846 pixels). The code uses a native navigation bar, History/New chat controls, a conditional offline status, restrained user bubbles, plain assistant text, a safe-area composer and the parent tab bar. It contains no hardcoded sample conversation or fake device chrome. An actual same-size native rendering has not been inspected on Windows, so no 1:1 visual-match claim is made.

Required Mac/device checks:

1. Resolve/link local package product `TemocRuntime`, build the app and verify the dynamic `llama` framework is embedded by Xcode/SPM.
2. On a base iPhone 15, verify the bundled model's hash, load it, enable Airplane Mode, and obtain a non-empty reply to a benign preparedness question.
3. Measure peak memory, first-load/warm latency and sustained thermal behavior on that phone; do not substitute desktop/model-file size for these observations.
4. Test Stop during prompt loading and generation, tab switching, backgrounding and memory pressure; verify Reporting remains responsive and Temoc releases its model.
5. Reopen the app and recover separate chats. Confirm New chat resets context, deletion affects only the selected chat, and reporting identity/counters remain unchanged.
6. Exercise medical red flags, an attempted key paste, a false dispatch output, model corruption, missing model and model-download cancellation. Verify honest recovery states.
7. Inspect the keyboard, larger text, light/dark appearance and VoiceOver on the actual iPhone.

Source and archive inspection do not establish native compilation, model inference on iOS, or a measured iPhone performance result.

The package also provides a bounded native acceptance executable:

```sh
swift run --package-path ios/TemocRuntime -c release TemocSmokeCheck /absolute/path/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

It rechecks the model length and SHA-256, loads the real native engine, requests one reply with a 32-token maximum to a fixed nonmedical preparedness question, and fails with a nonzero exit code for missing/wrong weights, inference failure or an empty reply. Its JSON receipt includes the actual answer, elapsed time and an explicit macOS-not-iPhone platform label. It performs no model download, radio write, chat API call or history write. `TemocSafetyTests.swift` adds four authored XCTest methods covering urgent routing, unsafe generated claims, likely-key rejection and independent archive contexts/bounds. They require native XCTest execution before being called passing.


Native Mac verification passed on November 8: [run 42480891780](https://github.com/abhikhur27/emergencymesh/actions/runs/42480891780), Xcode 16.4 and iOS 18.5 arm64 simulator, all 24 XCTest methods (20 protocol/storage/GPS and 4 Temoc). The official framework was verified and extracted with native symlinks. Actual pinned Qwen weights produced a nonempty native macOS reply with a 32-token limit, in 19.854 seconds including cold loading. This does not establish native visual acceptance or base iPhone 15 performance.
