# EmergencyMesh radio firmware

Three PlatformIO builds for the **standard LILYGO T3 LoRa32 V1.6.1 ESP32/SX1276**. All three share the same protocol and RF profile. This is a bounded hackathon managed-flood prototype; receipt status comes from the authenticated hub/phone protocol, not radio transmit completion.

| Build | Use | Interfaces |
| --- | --- | --- |
| `companion` | Phone-powered portable node | BLE Nordic UART + LoRa relay |
| `relay` | USB/battery-powered regional repeater | LoRa relay; BLE disabled |
| `hub` | Laptop gateway | USB serial + LoRa relay; BLE disabled |

The supplied label `868/915MHz LILYGO model LoRa32` matches the SX1276 family. Check the board's **V1.6.1** revision before building for this board. **T3-TCXO, T3-S3, LoRa32 V1.3 and SX1278/433MHz boards need different hardware profiles.** This source profile does not support those variants. The `companion-ble-v2` source has been compiled and tested in software; fresh role-specific builds still need physical device acceptance.

## Phone pairing and board roles

Only the **companion** advertises a phone BLE service by default. Choose `EM-Companion-XXXX` in the iPhone app, where `XXXX` is the final two bytes of that board's canonical MAC address. The hub belongs on the laptop's USB data cable and does not appear as a BLE phone accessory in the default release. A relay only forwards LoRa traffic.

The older firmware exposed the same BLE service on both companion and hub, with ambiguous names. Connecting the phone to the hub bypassed the intended companion-to-hub radio path. This release removes that accidental choice. Existing boards keep their old behavior until deliberately reflashed; updating these files does not change a running board.

The public `ready.node` label now uses the final four canonical MAC bytes. The shorter BLE suffix identifies a board for selection; neither label is a security identity or a globally unique guarantee. Encryption/authentication and the v1 radio/BLE wire protocol are unchanged. A private lab can explicitly compile `EM_ENABLE_HUB_BLE=1` to expose an `EM-Hub-XXXX` service, but this opt-in is absent from all supplied default profiles. Use the companion for the standard phone flow.

## Build and test

Requires Python 3 and PlatformIO Core 6.1.18. Install in a virtual environment if PlatformIO is not already available:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install platformio==6.1.18
python -m platformio run -e companion -e relay -e hub
```

On Windows activate `.venv\Scripts\Activate.ps1` instead. An existing PlatformIO installation also works; no developer-specific filesystem path is required.

Native protocol tests run the production C++ transport core with an ordinary compiler:

```sh
sh scripts/test-native.sh
```

Windows with Visual Studio C++ tools:

```powershell
powershell -NoProfile -File scripts/test-native.ps1
```

Tests cover companion-only default BLE policy and explicit hub opt-in, canonical MAC identity/name regression cases, bounded name formatting, malformed/type-size/region/key-ID envelopes, hop-only mutations, a three-hop chain, largest-frame indexed BLE reassembly, conflicting and expired fragments, loop suppression with retry recovery, and queue bounds/clock wrap. These checks do not simulate radio propagation or establish BLE interoperability.

Dependencies are pinned in `platformio.ini`: Espressif32 6.13.0 (Arduino ESP32 2.0.17), NimBLE-Arduino 2.3.7, RadioLib 7.4.0, ArduinoJson 7.4.2, Adafruit SSD1306 2.5.15, GFX 1.13.0 and BusIO 1.17.4. Included dependency source keeps its upstream license in PlatformIO's download cache; source is not copied into this repository.

## Wire and radio profile

The authoritative application contract is [PROTOCOL.md](../docs/PROTOCOL.md). Radio packets are opaque AES-GCM envelopes. Firmware has **no regional encryption key** and cannot authenticate incidents. Only the app and hub can accept their contents as genuine.

Default hardware: SCK5, MISO19, MOSI27, NSS18, RESET23, DIO0=26, DIO1=33. OLED SDA21/SCL22/address0x3c, LED25. PHY: **915MHz, SF7, 125kHz, coding4/5, sync0x12, explicit header, preamble8, CRC enabled, 10dBm**. The matching profile must be used by every radio. Region1/keyID1 are public routing labels, not keys; adjust both firmware compile definitions and app/hub profile together if changed.

The RF profile is a US demonstration assumption, not a certification or a legal operating determination. Attach the correct matching antenna **before power/transmission**. The firmware can transmit queued data after boot; do not flash it for a different RF region or an unidentified radio.

The companion's BLE service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` uses RX `...0002...` writes **with response**, TX `...0003...` notifications, 20-byte ATT values with the protocol's four-byte fragment header. One phone at a time. Its service UUID is in the main advertisement and the role-labelled name is in the scan response. BLE link pairing is not an identity system; sensitive payloads remain encrypted end to end. Keep the private provisioning key off the serial terminal and screenshots.

Serial is 115200 baud, one JSON object per newline, at most1024bytes per line. Only the `hub` build accepts serial `tx` commands. Send `{"op":"status"}` at any time to retrieve the same `ready` metadata emitted at boot; a serial session may open after the original boot line. It emits `rx` frames with RSSI/SNR; `ready`, `queued` and `error` messages carry diagnostics. A `queued` result is local admission only. The laptop must validate and decrypt before accepting an incident, and must validate the role, frequency, region, key ID, protocol and `radioReady` result before transmitting.

## Flood and delivery behavior

Received frames are checked for magic/version/type-specific size, region/key ID and hops0..4. A 64-entry bounded fingerprint cache ignores only the mutable hop byte. An exact duplicate within6seconds is suppressed. An identical retransmission after6seconds is admitted so a lost hub receipt can recover on the phone's10/25/45-second retries. The hub still deduplicates the durable incident and resends its existing authenticated receipt.

Each admitted radio frame can be relayed once with hops decremented. A zero-hop frame can be delivered to the local hub/phone, but is never forwarded. Relays wait a randomized150..699ms before queueing transmission. The TX queue holds8frames; local BLE input holds4frames; BLE receipts hold4frames. TX spacing is at least1.5seconds, with a maximum20radio transmission starts per rolling fixed60-second window. These conservative demonstration caps are congestion controls, not a regional duty-cycle compliance guarantee. High density or flooding can still deny service; there is no guaranteed delivery or range.

Radio IRQ handlers set a flag only; SPI, decoding and serial I/O run in the main loop. A2.5-second TX timeout returns the radio to receive mode. Wi-Fi is disabled; the radio stays listening, so this is **not a measured ultralow-power design**. BLE writes can succeed before the radio queue accepts the whole message. The app must keep the encrypted outbox until an authenticated receipt arrives.

## Flash the correct board deliberately

List serial ports, identify the USB LoRa board (not an unrelated Bluetooth COM port), close other terminal applications and then upload the chosen role:

```sh
python -m platformio device list
python -m platformio run -e companion --target upload --upload-port /dev/cu.usbserial-REPLACE
python -m platformio device monitor --port /dev/cu.usbserial-REPLACE --baud115200
```

Windows uses a confirmed `COMx` in place of `/dev/cu...`. Use `-e hub` for the laptop gateway or `-e relay` for repeaters. Some boards need BOOT held while RESET is pressed during upload. Remove an SD card before flashing. A charge-only cable powers the board but cannot flash it or bridge USB serial; the hub cable must carry data.

Prebuilt firmware is not distributed in this public repository. For a private local build, images can be exported under ignored `releases/<role>/` with SHA-256 manifests and exact flash offsets. After compiling all three roles, run `powershell -File scripts/export-releases.ps1` on Windows to refresh them. Never reuse manifests from an older build after changing source. Install `python -m pip install esptool==4.11.0` on the flashing machine, then run `powershell -File scripts/flash-release.ps1 -Role companion -Port COM9` or `sh scripts/flash-release.sh companion /dev/cu.usbserial-CONFIRMED`. These helpers verify hashes but do not automatically identify a safe board; replace the example port with the confirmed LoRa USB port.

## Bench check before demonstrating

1. Verify revision/frequency, antennas and data cable. Initially power boards from USB supplies. Confirm OLED and `ready.radioReady=true` on each.
2. Open the hub with its real USB serial port and privately provision the phone. Pair to the companion in the iOS app; request location only when needed.
3. Send synthetic text. Check app submitted state, one durable hub incident, authenticated hub receipt, operator review, then authenticated reviewed receipt. Keep original fields visible while inspecting the optional AI summary.
4. Place a relay between radios, control the topology so a direct path is excluded, and repeat. Disconnect/reconnect USB/BLE and deliberately drop a receipt to verify recovery. Record actual results; native tests are not an over-the-air receipt.
5. Test the specific USB-C iPhone/adapter/cable combination under TX bursts. Measure current and temperature, test lock/reconnect behavior, and check that the iPhone actually supplies stable5V. Phone-powered operation and battery life have not been measured. Use an independent USB battery for repeaters or if phone power is unstable.

## Primary references

- [LILYGO hardware specifications and V1.6.1 pin table](https://wiki.lilygo.cc/products/t3-series/t3-lora32/)
- [LILYGO upstream PlatformIO target definitions](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/platformio.ini)
- [RadioLib7.4.0 SX127x interrupt receive example](https://github.com/jgromes/RadioLib/blob/7.4.0/examples/SX127x/SX127x_Receive_Interrupt/SX127x_Receive_Interrupt.ino)
- [RadioLib7.4.0 SX127x interrupt transmit example](https://github.com/jgromes/RadioLib/blob/7.4.0/examples/SX127x/SX127x_Transmit_Interrupt/SX127x_Transmit_Interrupt.ino)
- [NimBLE-Arduino2.3.7 server callbacks](https://github.com/h2zero/NimBLE-Arduino/blob/2.3.7/examples/NimBLE_Server/NimBLE_Server.ino)
