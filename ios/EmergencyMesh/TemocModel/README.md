# Temoc's offline model

The default Mac handoff does not bundle model weights. Download `qwen2.5-1.5b-instruct-q4_k_m.gguf` once inside Temoc over Wi-Fi; the app verifies and retains it for offline use. Model weights are deliberately excluded from Git.

Both the default and source-only apps build without the weights and offer explicit model download or file import. Optional `-BundleModel` packaging supports a separately named fully offline handoff. Once installed, chat inference has no network dependency. See `docs/TEMOC.md` for the pinned official model, checksum, license and device verification limits.
