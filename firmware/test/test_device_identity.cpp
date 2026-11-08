#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "device_identity.h"

#define assert(condition) do { if (!(condition)) { fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #condition); return 1; } } while (0)

int main() {
  using em::DeviceRole;
  assert(em::bleEnabled(DeviceRole::Companion));
  assert(!em::bleEnabled(DeviceRole::Relay));
  assert(!em::bleEnabled(DeviceRole::Hub));
  assert(em::bleEnabled(DeviceRole::Hub, true));
  assert(!em::bleEnabled(DeviceRole::Relay, true));
  assert(!em::bleEnabled(static_cast<DeviceRole>(99), true));
  puts("PASS default BLE is companion-only; hub requires explicit opt-in");

  // Synthetic canonical MACs share their first four bytes. Truncating the
  // little-endian efuse integer made their old identifiers/names collide.
  const uint8_t companionMac[6] = {0xa0, 0xb1, 0xc2, 0xd3, 0x12, 0x34};
  const uint8_t hubMac[6] = {0xa0, 0xb1, 0xc2, 0xd3, 0x56, 0x78};
  const uint32_t companion = em::nodeIdFromMac(companionMac);
  const uint32_t hub = em::nodeIdFromMac(hubMac);
  assert(companion == 0xc2d31234U);
  assert(hub == 0xc2d35678U);
  assert(companion != hub);
  puts("PASS canonical MAC suffix distinguishes boards sharing a vendor prefix");

  char name[24];
  assert(em::formatBleName(DeviceRole::Companion, companion, name, sizeof(name)));
  assert(strcmp(name, "EM-Companion-1234") == 0);
  assert(em::formatBleName(DeviceRole::Hub, hub, name, sizeof(name)));
  assert(strcmp(name, "EM-Hub-5678") == 0);
  char shortName[8];
  assert(!em::formatBleName(DeviceRole::Companion, companion, shortName, sizeof(shortName)));
  puts("PASS BLE name exposes role and canonical suffix without silent truncation");
  return 0;
}
