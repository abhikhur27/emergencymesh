# Third-party dependencies

The root MIT license covers original EmergencyMesh code and project material. It does not replace the licenses of dependencies, Apple SDKs, build tools or external models. Dependencies are obtained separately by npm, PlatformIO or the development environment; their source is not vendored here.

This repository intentionally distributes firmware **source only**. Prebuilt firmware images are excluded. If redistributing a firmware binary, separately satisfy all applicable dependency notice, source and relinking obligations, including the Arduino ESP32 LGPL license.

| Dependency | Pinned version | License / upstream source |
| --- | --- | --- |
| Arduino ESP32 framework | 2.0.17, provided by Espressif32 6.13.0 | [LGPL-2.1-or-later](https://github.com/espressif/arduino-esp32/blob/2.0.17/LICENSE.md) |
| NimBLE-Arduino | 2.3.7 | [Apache-2.0](https://github.com/h2zero/NimBLE-Arduino/blob/2.3.7/LICENSE), [NOTICE](https://github.com/h2zero/NimBLE-Arduino/blob/2.3.7/NOTICE) |
| RadioLib | 7.4.0 | [MIT](https://github.com/jgromes/RadioLib/blob/7.4.0/license.txt) |
| ArduinoJson | 7.4.2 | [MIT](https://github.com/bblanchon/ArduinoJson/blob/v7.4.2/LICENSE.txt) |
| Adafruit SSD1306 | 2.5.15 | [BSD-2-Clause](https://github.com/adafruit/Adafruit_SSD1306/blob/2.5.15/license.txt) |
| Adafruit GFX Library | 1.13.0 | [BSD-3-Clause](https://github.com/adafruit/Adafruit-GFX-Library/blob/1.13.0/license.txt) |
| Adafruit BusIO | 1.17.4 | [MIT](https://github.com/adafruit/Adafruit_BusIO/blob/1.17.4/LICENSE) |
| SerialPort | 13.0.0 | [MIT](https://github.com/serialport/node-serialport/blob/main/LICENSE) |

The npm lockfile records the hub dependency tree. PlatformIO pins the firmware libraries. Keep upstream notices when using or redistributing their material.

The Swift app uses Apple's platform frameworks and system symbols through the installed Apple SDK. Those SDKs and Xcode are not included in this repository. The optional Ollama runtime and selected model must be obtained separately under their respective licenses; no model weights are distributed here.

The enclosure is original project CAD authored in FreeCAD, exported as native FCStd, STEP and STL. The preview is an actual CAD viewport capture. The iOS design target is generated concept artwork, not a native app screenshot or evidence of device operation.
