#include <stdint.h>
#include <initializer_list>
#include <stdio.h>
#include <string.h>
#include "status_screen.h"

#define assert(condition) do { if (!(condition)) { fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #condition); return 1; } } while (0)

int main() {
  using em::DeviceRole; using em::StatusScene;
  em::StatusInput input{}; input.radioReady = true;
  assert(em::selectStatusScene(input) == StatusScene::PairPhone);
  auto text = em::statusText(input);
  assert(strcmp(text.title, "PAIR PHONE") == 0);
  assert(strcmp(text.subtitle, "Open RescueMesh") == 0);
  assert(strcmp(text.footer, "COMPANION 915MHz") == 0);
  input.phoneLinked = true; input.hadPhoneLink = true;
  assert(em::selectStatusScene(input) == StatusScene::PhoneLinked);
  assert(strcmp(em::statusText(input).subtitle, "Ready to carry") == 0);
  input.phoneLinked = false;
  assert(em::selectStatusScene(input) == StatusScene::PhoneLost);
  input.phoneLinked = true;
  assert(em::selectStatusScene(input) == StatusScene::PhoneLinked);
  puts("PASS companion pairing, real link, loss and reconnect states");

  input.queued = 3; input.phoneLinked = false;
  assert(em::selectStatusScene(input) == StatusScene::Carrying);
  assert(strcmp(em::statusText(input).title, "CARRYING 3") == 0);
  assert(strcmp(em::statusText(input).subtitle, "Waiting for radio") == 0);
  input.hadPhoneLink = false;
  assert(em::selectStatusScene(input) == StatusScene::Carrying);
  input.queued = 0;
  assert(em::selectStatusScene(input) == StatusScene::PairPhone);
  puts("PASS queued work takes priority over pairing and link-loss decoration");

  input.role = DeviceRole::Hub; input.phoneLinked = true; input.hadPhoneLink = true;
  assert(em::selectStatusScene(input) == StatusScene::HubListening);
  text = em::statusText(input);
  assert(strcmp(text.title, "ECSW HUB") == 0);
  assert(strcmp(text.subtitle, "Listening 915MHz") == 0);
  assert(strcmp(text.detail, "Last RX --") == 0);
  input.hasAcceptedRx = true; input.lastRxMs = 2000; input.nowMs = 6000;
  assert(em::selectStatusScene(input) == StatusScene::PacketIn);
  assert(strcmp(em::statusText(input).subtitle, "Last RX 4s ago") == 0);
  input.nowMs = 12000;
  assert(em::selectStatusScene(input) == StatusScene::HubListening);
  assert(strcmp(em::statusText(input).detail, "Last RX 10s") == 0);
  input.nowMs = 62000;
  assert(strcmp(em::statusText(input).detail, "Last RX 1m") == 0);
  input.nowMs = 3602000;
  assert(strcmp(em::statusText(input).detail, "Last RX 1h") == 0);
  input.nowMs = 86402000;
  assert(strcmp(em::statusText(input).detail, "Last RX 1d") == 0);
  puts("PASS hub uses actual accepted RX age and packet-notice expiry");

  input.lastRxMs = UINT32_MAX - 1999; input.nowMs = 2000;
  assert(em::statusRxAgeSeconds(input) == 4);
  assert(em::selectStatusScene(input) == StatusScene::PacketIn);
  input.nowMs = 8000;
  assert(em::statusRxAgeSeconds(input) == 10);
  assert(em::selectStatusScene(input) == StatusScene::HubListening);
  puts("PASS RX age and notice selection survive millis rollover");

  input.role = DeviceRole::Relay; input.queued = 0;
  assert(em::selectStatusScene(input) == StatusScene::RelayReady);
  assert(strcmp(em::statusText(input).subtitle, "Pass it on") == 0);
  input.queued = 8;
  assert(em::selectStatusScene(input) == StatusScene::RelayCarrying);
  assert(strcmp(em::statusText(input).title, "PASSING 8") == 0);
  assert(strcmp(em::statusText(input).footer, "RELAY 915MHz") == 0);
  puts("PASS relay has role-specific states independent of phone connection");

  for (const auto role : {DeviceRole::Companion, DeviceRole::Relay, DeviceRole::Hub}) {
    input.role = role; input.radioReady = false; input.queued = 8; input.phoneLinked = true;
    assert(em::selectStatusScene(input) == StatusScene::RadioCheck);
    text = em::statusText(input);
    assert(strcmp(text.title, "RADIO CHECK") == 0);
    assert(strcmp(text.subtitle, "Check antenna/power") == 0);
    assert(strstr(text.title, "delivered") == nullptr);
  }
  puts("PASS radio fault takes priority over queue, phone link and received packet");
  return 0;
}
