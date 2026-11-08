#!/usr/bin/env sh
set -eu
if [ "$#" -ne 2 ]; then echo "Usage: sh flash-release.sh companion|relay|hub /dev/cu.usbserial-CONFIRMED" >&2; exit 2; fi
role=$1
case "$role" in companion|relay|hub) ;; *) echo "Unknown role" >&2; exit 2;; esac
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project/releases/$role"
if command -v shasum >/dev/null 2>&1; then shasum -a256 -c checksums.sha256; else sha256sum -c checksums.sha256; fi
echo "Flashing $role to $2 at915MHz. Hardware must be standard T3 LoRa32 V1.6.1 ESP32/SX1276, matching antenna attached."
"${PYTHON:-python3}" -m esptool --chip esp32 --port "$2" --baud 460800 --before default_reset --after hard_reset write_flash --flash_mode dio --flash_freq 40m --flash_size 4MB 0x1000 bootloader.bin 0x8000 partitions.bin 0xe000 boot_app0.bin 0x10000 firmware.bin
