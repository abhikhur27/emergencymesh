#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include "device_identity.h"

namespace em {
enum class StatusScene : uint8_t {
  PairPhone, PhoneLinked, Carrying, HubListening, PacketIn,
  RelayReady, RelayCarrying, RadioCheck, PhoneLost
};

struct StatusInput {
  DeviceRole role = DeviceRole::Companion;
  bool radioReady = false;
  bool phoneLinked = false;
  bool hadPhoneLink = false;
  size_t queued = 0;
  bool hasAcceptedRx = false;
  uint32_t nowMs = 0;
  uint32_t lastRxMs = 0;
  uint32_t frequencyMHz = 915;
};

constexpr uint32_t PacketNoticeMs = 10000;
constexpr uint32_t statusRxAgeSeconds(const StatusInput& input) {
  return static_cast<uint32_t>(input.nowMs - input.lastRxMs) / 1000;
}

inline void formatStatusRxAge(char* output, size_t capacity, uint32_t seconds) {
  const char unit = seconds < 60 ? 's' : (seconds < 3600 ? 'm' : (seconds < 86400 ? 'h' : 'd'));
  const uint32_t value = seconds < 60 ? seconds : (seconds < 3600 ? seconds / 60 : (seconds < 86400 ? seconds / 3600 : seconds / 86400));
  snprintf(output, capacity, "Last RX %lu%c", static_cast<unsigned long>(value), unit);
}

// Presentation only: no keys, packet parsing, timers, blocking work or delivery claims.
constexpr StatusScene selectStatusScene(const StatusInput& input) {
  if (!input.radioReady) return StatusScene::RadioCheck;
  if (input.role == DeviceRole::Hub) {
    return input.hasAcceptedRx && static_cast<uint32_t>(input.nowMs - input.lastRxMs) < PacketNoticeMs
        ? StatusScene::PacketIn : StatusScene::HubListening;
  }
  if (input.role == DeviceRole::Relay) return input.queued ? StatusScene::RelayCarrying : StatusScene::RelayReady;
  if (input.queued) return StatusScene::Carrying;
  if (input.phoneLinked) return StatusScene::PhoneLinked;
  return input.hadPhoneLink ? StatusScene::PhoneLost : StatusScene::PairPhone;
}

struct StatusText {
  char title[22]{};
  char subtitle[22]{};
  char detail[22]{};
  char footer[22]{};
};

inline StatusText statusText(const StatusInput& input) {
  StatusText text{};
  const auto scene = selectStatusScene(input);
  const char* title = "";
  const char* subtitle = "";
  switch (scene) {
    case StatusScene::PairPhone: title = "PAIR PHONE"; subtitle = "Open RescueMesh"; break;
    case StatusScene::PhoneLinked: title = "PHONE LINKED"; subtitle = "Ready to carry"; break;
    case StatusScene::Carrying: title = "CARRYING"; subtitle = "Waiting for radio"; break;
    case StatusScene::HubListening: title = "ECSW HUB"; break;
    case StatusScene::PacketIn: title = "PACKET IN"; break;
    case StatusScene::RelayReady: title = "RELAY READY"; subtitle = "Pass it on"; break;
    case StatusScene::RelayCarrying: title = "PASSING"; subtitle = "Waiting for radio"; break;
    case StatusScene::RadioCheck: title = "RADIO CHECK"; subtitle = "Check antenna/power"; break;
    case StatusScene::PhoneLost: title = "PHONE LOST"; subtitle = "Reconnect phone"; break;
  }
  if (scene == StatusScene::Carrying || scene == StatusScene::RelayCarrying) {
    // The actual radio queue has eight slots. Keep text safe even for an invalid snapshot.
    snprintf(text.title, sizeof(text.title), "%s %u", title, static_cast<unsigned int>(input.queued > 999 ? 999 : input.queued));
  } else snprintf(text.title, sizeof(text.title), "%s", title);
  if (scene == StatusScene::HubListening) {
    snprintf(text.subtitle, sizeof(text.subtitle), "Listening %luMHz", static_cast<unsigned long>(input.frequencyMHz));
    if (input.hasAcceptedRx) formatStatusRxAge(text.detail, sizeof(text.detail), statusRxAgeSeconds(input));
    else snprintf(text.detail, sizeof(text.detail), "Last RX --");
  } else if (scene == StatusScene::PacketIn) {
    snprintf(text.subtitle, sizeof(text.subtitle), "Last RX %lus ago", static_cast<unsigned long>(statusRxAgeSeconds(input)));
  } else snprintf(text.subtitle, sizeof(text.subtitle), "%s", subtitle);
  const char* role = input.role == DeviceRole::Companion ? "COMPANION" : (input.role == DeviceRole::Relay ? "RELAY" : "HUB");
  snprintf(text.footer, sizeof(text.footer), "%s %luMHz", role, static_cast<unsigned long>(input.frequencyMHz));
  return text;
}
}
