#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
runtime="$root/TemocRuntime"
archive="$runtime/llama-b5046-xcframework.zip"
model="$root/EmergencyMesh/TemocModel/qwen2.5-1.5b-instruct-q4_k_m.gguf"
archive_sha='c19be78b5f00d8d29a25da41042cb7afa094cbf6280a225abe614b03b20029ab'
model_sha='6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e'

[[ "$(uname -s)" == Darwin ]] || { echo 'Run this preparation script on the receiving Mac.' >&2; exit 1; }
case "${1:-}" in ''|--open) ;; *) echo 'Usage: bash scripts/prepare-mac.sh [--open]' >&2; exit 1 ;; esac

verify_file() {
  local file="$1" bytes="$2" expected="$3"
  [[ -f "$file" && ! -L "$file" ]] || { echo "Missing regular file: $file" >&2; exit 1; }
  [[ "$(stat -f '%z' "$file")" == "$bytes" ]] || { echo "Wrong file size: $file" >&2; exit 1; }
  echo "Verifying $(basename "$file")…"
  [[ "$(shasum -a 256 "$file" | awk '{print $1}')" == "$expected" ]] || { echo "SHA-256 mismatch: $file" >&2; exit 1; }
}

mode=checkout
if [[ -f "$root/MANIFEST.json" ]]; then
  mode="$(plutil -extract packageMode raw -o - "$root/MANIFEST.json")"
  case "$mode" in offline-bundled|download-once|source-only) ;; *) echo 'Unsupported handoff package mode.' >&2; exit 1 ;; esac
fi
if [[ "$mode" == offline-bundled || -f "$model" ]]; then
  verify_file "$model" 1117320736 "$model_sha"
else
  echo 'Model not bundled. Use Temoc → Set up → Download model over Wi-Fi or import the pinned GGUF on the iPhone.'
fi

if [[ "$mode" == offline-bundled || "$mode" == download-once || -f "$archive" ]]; then
  verify_file "$archive" 74944281 "$archive_sha"
  stage="$(mktemp -d "$runtime/.prepare-XXXXXX")"
  trap 'rm -rf "$stage"' EXIT
  # Native extraction restores macOS Versions/Current symlinks. A framework
  # extracted on Windows may instead contain ordinary text files at those paths.
  ditto -xk "$archive" "$stage"
  framework="$stage/build-apple/llama.xcframework"
  [[ -f "$framework/Info.plist" ]] || { echo 'Archive has no XCFramework metadata.' >&2; exit 1; }
  for slice in ios-arm64 ios-arm64_x86_64-simulator; do
    [[ -f "$framework/$slice/llama.framework/llama" && -f "$framework/$slice/llama.framework/Headers/llama.h" ]] || { echo "Missing iOS runtime slice: $slice" >&2; exit 1; }
  done
  mac_framework="$framework/macos-arm64_x86_64/llama.framework"
  for link in Headers Modules Resources llama Versions/Current; do
    [[ -L "$mac_framework/$link" ]] || { echo "Framework symlink was not restored: $link" >&2; exit 1; }
  done
  [[ -f "$mac_framework/Headers/llama.h" && -f "$mac_framework/llama" ]] || { echo 'Restored macOS framework links do not resolve.' >&2; exit 1; }
  mkdir -p "$runtime/Vendor"
  previous="$stage/previous-llama.xcframework"
  destination="$runtime/Vendor/llama.xcframework"
  if [[ -e "$destination" || -L "$destination" ]]; then mv "$destination" "$previous"; fi
  if ! mv "$framework" "$destination"; then
    if [[ -e "$previous" ]]; then mv "$previous" "$destination"; fi
    echo 'Could not install framework; previous framework restored.' >&2
    exit 1
  fi
  echo 'Verified official llama.cpp b5046 restored with native framework symlinks.'
else
  echo 'Source-only checkout: Xcode will download the checksum-pinned llama.cpp b5046 archive through Swift Package Manager.'
fi

echo 'Preparation complete. Open EmergencyMesh.xcodeproj and select the EmergencyMesh scheme.'
if [[ "${1:-}" == --open ]]; then open "$root/EmergencyMesh.xcodeproj"; fi
