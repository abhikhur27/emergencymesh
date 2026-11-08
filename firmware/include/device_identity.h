#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

namespace em {
enum class DeviceRole : uint8_t { Companion = 1, Relay = 2, Hub = 3 };

constexpr bool bleEnabled(DeviceRole role, bool hubOptIn = false) {
  return role == DeviceRole::Companion || (role == DeviceRole::Hub && hubOptIn);
}

// Canonical MAC byte order, independent of ESP32's little-endian efuse integer.
// This compact ID and its name suffix are display labels, not authentication.
constexpr uint32_t nodeIdFromMac(const uint8_t mac[6]) {
  return (static_cast<uint32_t>(mac[2]) << 24) | (static_cast<uint32_t>(mac[3]) << 16) |
      (static_cast<uint32_t>(mac[4]) << 8) | static_cast<uint32_t>(mac[5]);
}

inline bool formatBleName(DeviceRole role, uint32_t node, char* output, size_t capacity) {
  const char* label;
  switch (role) {
    case DeviceRole::Companion: label = "Companion"; break;
    case DeviceRole::Relay: label = "Relay"; break;
    case DeviceRole::Hub: label = "Hub"; break;
    default: return false;
  }
  const int length = snprintf(output, capacity, "EM-%s-%04X", label, static_cast<unsigned int>(node & 0xffff));
  return length >= 0 && static_cast<size_t>(length) < capacity;
}
}
