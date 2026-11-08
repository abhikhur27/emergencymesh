# Validation scope

The project is a hackathon prototype. Evidence below distinguishes source checks, software integration and physical observations.

| Area | Observed | Remaining |
| --- | --- | --- |
| Hub | 33 Node tests, 19-file syntax check, encrypted simulation and dependency audit; authenticated browser flow including filter selection, review and simulation export | Load, long-duration reliability and production access controls |
| iOS | Portable Xcode targets/scheme, plist/path checks, nine Swift files syntax-parsed, matching public golden fixture and ten XCTest methods authored | Native Xcode/XCTest execution for this exact export and native visual/accessibility acceptance |
| Firmware | Pinned PlatformIO companion/relay/hub builds and native transport checks | Acceptance of each fresh role-specific image on physical hardware |
| Integration | Real firmware C++ helpers and Node AES-GCM/core across modeled forwarding steps, lost-receipt restart recovery and tamper rejection | RF propagation and true multihop field behavior |
| Hardware | Two physical boards flashed and initialized; companion BLE GATT/notification subscription checked; actual non-simulated reports reached the laptop hub through radio and serial | Independently verified phone receipt state, measured coverage, battery/power, thermal behavior and sustained congestion |
| Local AI | Actual local model execution with validated original-text selection; deterministic fallback is labeled | No diagnostic, triage or clinical accuracy claim; original reported facts remain authoritative |
| CAD | Native FreeCAD feature/boolean model, editable FCStd/STEP, separate STL exports and valid final solids | Printed assembly, port alignment, strength, antenna clearance and physical fit |

The phone was observed attaching to a legacy hub BLE service instead of its intended companion. Reconnecting the companion restored operation. Current source prevents this ambiguity by enabling phone BLE only for the companion and deriving its name from unique canonical MAC bytes. Fresh source builds still need device acceptance; this publication does not silently update an already-flashed device.

No raw incident bodies, regional keys, login tokens, device identifiers, process receipts, private host paths or runtime backups are published. Test fixtures are synthetic and use an explicitly public test key. No emergency-service contact, production dispatch or RF certification is claimed.
