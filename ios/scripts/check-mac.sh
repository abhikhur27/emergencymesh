#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v xcodebuild >/dev/null || { echo 'Install full Xcode and select it with xcode-select first.' >&2; exit 1; }
plutil -lint EmergencyMesh/Info.plist EmergencyMesh.xcodeproj/project.pbxproj
xcodebuild -list -project EmergencyMesh.xcodeproj
if [[ "${1:-}" == "--test" ]]; then
  # Pass an installed simulator UDID: SIMULATOR_ID=<id> bash scripts/check-mac.sh --test
  : "${SIMULATOR_ID:?Set SIMULATOR_ID to an iPhone simulator UDID from xcrun simctl list devices available}"
  xcodebuild test -project EmergencyMesh.xcodeproj -scheme EmergencyMesh -destination "platform=iOS Simulator,arch=$(uname -m),id=$SIMULATOR_ID" -derivedDataPath .build CODE_SIGNING_ALLOWED=NO
else
  xcodebuild build -project EmergencyMesh.xcodeproj -scheme EmergencyMesh -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .build ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO
fi
