#include <Arduino.h>
#include <ArduinoJson.h>
#include <Adafruit_SSD1306.h>
#include <RadioLib.h>
#include <NimBLEDevice.h>
#include <SPI.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_system.h>
#include <esp_mac.h>
#include <mbedtls/base64.h>
#include <atomic>
#include "mesh_protocol.h"
#include "device_identity.h"

#ifndef EM_ROLE
#define EM_ROLE 1
#endif
#ifndef EM_REGION
#define EM_REGION 1
#endif
#ifndef EM_KEY_ID
#define EM_KEY_ID 1
#endif
#ifndef EM_FREQUENCY_HZ
#define EM_FREQUENCY_HZ 915000000L
#endif
#ifndef EM_ENABLE_HUB_BLE
#define EM_ENABLE_HUB_BLE 0
#endif
static_assert(EM_ROLE >= 1 && EM_ROLE <= 3, "Unknown EmergencyMesh firmware role");
static_assert(EM_ENABLE_HUB_BLE == 0 || EM_ENABLE_HUB_BLE == 1, "Hub BLE opt-in must be 0 or 1");

namespace {
using em::Frame;
constexpr char ServiceUuid[] = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
constexpr char RxUuid[] = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
constexpr char TxUuid[] = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";
constexpr bool IsHub = EM_ROLE == 3;
constexpr auto DeviceRole = static_cast<em::DeviceRole>(EM_ROLE);
constexpr bool HasBle = em::bleEnabled(DeviceRole, EM_ENABLE_HUB_BLE == 1);
constexpr const char* Role = EM_ROLE == 1 ? "companion" : (EM_ROLE == 2 ? "relay" : "hub");
constexpr uint32_t TxSpacingMs = 1500;
constexpr uint32_t TxWindowMs = 60000;
constexpr uint16_t TxPerWindow = 20;
constexpr uint8_t LedPin = 25;

em::FrameQueue<8> radioQueue;
em::FrameQueue<4> bleQueue;
em::DuplicateCache<64> seen;
em::Reassembler bleAssembly;
QueueHandle_t bleInput = nullptr;
NimBLECharacteristic* txCharacteristic = nullptr;
std::atomic<bool> bleConnected{false};
std::atomic<bool> bleSubscribed{false};
std::atomic<uint32_t> bleErrors{0};
Adafruit_SSD1306 display(128, 64, &Wire, -1);
SX1276 radio = new Module(18, 26, 23, 33);
bool hasDisplay = false, radioReady = false, transmitting = false;
volatile bool radioEvent = false;
uint32_t txStarted = 0, lastTx = 0, txWindowStart = 0, lastDisplay = 0;
uint16_t txWindowCount = 0;
uint32_t rxCount = 0, txCount = 0, dropCount = 0;
uint32_t nodeId = 0;
Frame bleSending{};
uint8_t bleTransfer = 0, bleChunk = 0;
bool bleSendingActive = false;
uint32_t lastBleChunk = 0;
char serialLine[1025]{};
size_t serialLength = 0;
bool discardSerialLine = false;

void IRAM_ATTR onRadioEvent() { radioEvent = true; }
void error(const char* code);

void startRadioReceive() {
  radioEvent = false;
  radio.setPacketReceivedAction(onRadioEvent);
  if (radio.startReceive() != RADIOLIB_ERR_NONE) { radioReady = false; error("radio_receive_failed"); }
}

void error(const char* code) {
  static bool emitted = false;
  static uint32_t lastError = 0;
  const uint32_t now = millis();
  if (emitted && static_cast<uint32_t>(now - lastError) < 1000) return;
  emitted = true; lastError = now;
  JsonDocument doc;
  doc["op"] = "error"; doc["code"] = code;
  serializeJson(doc, Serial); Serial.println();
}

void emitReady() {
  JsonDocument doc;
  doc["op"] = "ready"; doc["node"] = nodeId; doc["role"] = Role;
  doc["frequency"] = EM_FREQUENCY_HZ / 1000000; doc["region"] = EM_REGION;
  doc["keyId"] = EM_KEY_ID; doc["radioReady"] = radioReady; doc["protocol"] = 1;
  serializeJson(doc, Serial); Serial.println();
}

bool encodeBase64(const Frame& frame, char* output, size_t capacity) {
  size_t size = 0;
  if (mbedtls_base64_encode(reinterpret_cast<unsigned char*>(output), capacity - 1, &size,
                           frame.bytes, frame.length) != 0) return false;
  output[size] = '\0'; return true;
}

bool decodeBase64(const char* text, Frame& frame) {
  if (!text) return false;
  const size_t length = strlen(text);
  if (!length || length > 296 || length % 4) return false;
  for (size_t i = 0; i < length; ++i) {
    const char c = text[i];
    const bool alpha = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
        (c >= '0' && c <= '9') || c == '+' || c == '/';
    if (!alpha && !(c == '=' && i >= length - 2)) return false;
  }
  if (mbedtls_base64_decode(frame.bytes, sizeof(frame.bytes), &frame.length,
                           reinterpret_cast<const unsigned char*>(text), length) != 0) return false;
  char canonical[300];
  return encodeBase64(frame, canonical, sizeof(canonical)) && strcmp(text, canonical) == 0;
}

void emitRx(const Frame& frame, int rssi, float snr) {
  char encoded[300];
  if (!encodeBase64(frame, encoded, sizeof(encoded))) return;
  JsonDocument doc;
  doc["op"] = "rx"; doc["frame"] = encoded; doc["rssi"] = rssi; doc["snr"] = snr;
  serializeJson(doc, Serial); Serial.println();
}

void queueReceiptBle(const Frame& frame) {
  if (!HasBle || frame.bytes[3] != 2 || !bleConnected.load() || !bleSubscribed.load()) return;
  if (!bleQueue.push(frame, millis())) { ++dropCount; error("ble_queue_full"); }
}

void acceptLocal(Frame frame, bool fromSerial) {
  if (!em::validEnvelope(frame, EM_REGION, EM_KEY_ID) || (!fromSerial && frame.bytes[3] != 1)) {
    ++dropCount; error("invalid_envelope"); return;
  }
  if (!radioReady) { ++dropCount; error("radio_unavailable"); return; }
  const uint32_t now = millis();
  // Locally submitted identical retries after cooldown may be transmitted again.
  if (!seen.admit(frame, now)) return;
  if (!radioQueue.push(frame, now + (esp_random() % 100))) {
    ++dropCount; error("radio_queue_full"); return;
  }
  if (fromSerial) {
    queueReceiptBle(frame);
    Serial.println("{\"op\":\"queued\"}");
  }
}

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    if (server->getConnectedCount() > 1) { server->disconnect(info.getConnHandle()); return; }
    bleConnected.store(true);
  }
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo&, int) override {
    if (server->getConnectedCount() != 0) return;
    bleConnected.store(false); bleSubscribed.store(false); bleAssembly.reset();
    NimBLEDevice::getAdvertising()->start();
  }
} serverCallbacks;

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo&) override {
    const auto value = characteristic->getValue();
    Frame frame{};
    const auto result = bleAssembly.accept(value.data(), value.size(), millis(), frame);
    if (result == em::Assembly::Rejected) { ++bleErrors; return; }
    if (result == em::Assembly::Complete &&
        (xQueueSend(bleInput, &frame, 0) != pdTRUE)) ++bleErrors;
  }
} rxCallbacks;

class TxCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo&, uint16_t value) override {
    bleSubscribed.store((value & 1) != 0);
  }
} txCallbacks;

void startBle(uint32_t node) {
  if (!HasBle) return;
  char name[24];
  if (!em::formatBleName(DeviceRole, node, name, sizeof(name))) { error("ble_name_failed"); return; }
  NimBLEDevice::init(name);
  NimBLEDevice::setMTU(23);
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCallbacks);
  NimBLEService* service = server->createService(ServiceUuid);
  auto* rx = service->createCharacteristic(RxUuid, NIMBLE_PROPERTY::WRITE, 20);
  rx->setCallbacks(&rxCallbacks);
  txCharacteristic = service->createCharacteristic(TxUuid, NIMBLE_PROPERTY::NOTIFY, 20);
  txCharacteristic->setCallbacks(&txCallbacks);
  service->start();
  auto* advertising = NimBLEDevice::getAdvertising();
  advertising->enableScanResponse(true);
  if (!advertising->setName(name) || !advertising->addServiceUUID(ServiceUuid) || !advertising->start()) {
    error("ble_advertising_failed");
  }
}

void pollBle() {
  const auto rejected = bleErrors.exchange(0);
  if (rejected) { dropCount += rejected; error("ble_fragment_or_queue_rejected"); }
  Frame input{};
  for (uint8_t i = 0; i < 2 && xQueueReceive(bleInput, &input, 0) == pdTRUE; ++i) acceptLocal(input, false);
  if (!HasBle || !bleConnected.load() || !bleSubscribed.load()) {
    bleSendingActive = false;
    while (bleQueue.takeDue(millis(), input)) {}
    return;
  }
  const uint32_t now = millis();
  if (!bleSendingActive && bleQueue.takeDue(now, bleSending)) {
    bleSendingActive = true; bleChunk = 0; ++bleTransfer;
  }
  if (!bleSendingActive || static_cast<uint32_t>(now - lastBleChunk) < 30) return;
  uint8_t chunk[20];
  const size_t length = em::makeChunk(bleSending, bleTransfer, bleChunk, chunk);
  if (!length) { bleSendingActive = false; return; }
  txCharacteristic->setValue(chunk, length);
  if (!txCharacteristic->notify()) {
    bleSendingActive = false; ++dropCount; error("ble_notify_failed"); return;
  }
  ++bleChunk; lastBleChunk = now;
  if (static_cast<size_t>(bleChunk) * 16 >= bleSending.length) bleSendingActive = false;
}

void parseSerialLine() {
  JsonDocument doc;
  const auto result = deserializeJson(doc, serialLine, serialLength,
                                    DeserializationOption::NestingLimit(3));
  if (result || !doc.is<JsonObject>() || !doc["op"].is<const char*>()) {
    error("invalid_serial_command"); return;
  }
  if (strcmp(doc["op"], "status") == 0) { emitReady(); return; }
  if (strcmp(doc["op"], "tx") || !doc["frame"].is<const char*>()) { error("invalid_serial_command"); return; }
  if (!IsHub) { error("serial_tx_requires_hub"); return; }
  Frame frame{};
  if (!decodeBase64(doc["frame"], frame)) { error("invalid_base64"); return; }
  acceptLocal(frame, true);
}

void pollSerial() {
  for (size_t n = 0; n < 128 && Serial.available(); ++n) {
    const int input = Serial.read();
    if (input == '\n') {
      if (discardSerialLine) error("serial_line_too_long");
      else if (serialLength) { serialLine[serialLength] = '\0'; parseSerialLine(); }
      serialLength = 0; discardSerialLine = false;
    } else if (input != '\r' && !discardSerialLine) {
      if (serialLength >= 1024) { discardSerialLine = true; serialLength = 0; }
      else serialLine[serialLength++] = static_cast<char>(input);
    }
  }
}

void pollRadio() {
  if (!radioReady) return;
  const uint32_t now = millis();
  if (transmitting) {
    if (!radioEvent) {
      if (static_cast<uint32_t>(now - txStarted) > 2500) {
        radio.finishTransmit(); transmitting = false; digitalWrite(LedPin, LOW);
        error("radio_tx_timeout"); ++dropCount; startRadioReceive();
      }
      return;
    }
    radio.finishTransmit(); transmitting = false; digitalWrite(LedPin, LOW); startRadioReceive();
    if (!radioReady) return;
  }
  if (radioEvent) {
    radioEvent = false;
    Frame frame{};
    frame.length = radio.getPacketLength();
    const float rssi = radio.getRSSI(), snr = radio.getSNR();
    const int16_t state = frame.length <= em::MaxFrame ? radio.readData(frame.bytes, frame.length) : RADIOLIB_ERR_PACKET_TOO_LONG;
    if (state != RADIOLIB_ERR_NONE || !em::validEnvelope(frame, EM_REGION, EM_KEY_ID)) {
      ++dropCount;
    } else if (seen.admit(frame, now)) {
      ++rxCount;
      if (IsHub) emitRx(frame, static_cast<int>(rssi), snr);
      queueReceiptBle(frame);
      if (em::decrementHops(frame)) {
        if (!radioQueue.push(frame, now + 150 + esp_random() % 550)) { ++dropCount; error("radio_queue_full"); }
      }
    }
    startRadioReceive();
    if (!radioReady) return;
  }
  if (static_cast<uint32_t>(now - txWindowStart) >= TxWindowMs) {
    txWindowStart = now; txWindowCount = 0;
  }
  if (txWindowCount >= TxPerWindow || static_cast<uint32_t>(now - lastTx) < TxSpacingMs) return;
  Frame frame{};
  if (!radioQueue.takeDue(now, frame)) return;
  radio.standby(); radioEvent = false; radio.setPacketSentAction(onRadioEvent);
  if (radio.startTransmit(frame.bytes, frame.length) != RADIOLIB_ERR_NONE) {
    ++dropCount; error("radio_tx_failed"); startRadioReceive(); return;
  }
  transmitting = true; txStarted = now; lastTx = now; ++txWindowCount; ++txCount;
  digitalWrite(LedPin, HIGH);
}

void updateDisplay() {
  const uint32_t now = millis();
  if (!hasDisplay || static_cast<uint32_t>(now - lastDisplay) < 2000 || transmitting) return;
  lastDisplay = now;
  display.clearDisplay(); display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0); display.println("EMERGENCY MESH");
  display.print(Role); display.print(" "); display.print(EM_FREQUENCY_HZ / 1000000); display.println("MHz");
  display.println(radioReady ? "Radio ready" : "RADIO ERROR");
  if (HasBle) display.println(bleSubscribed.load() ? "Phone subscribed" : "Phone not ready");
  display.printf("RX %lu TX %lu\n", static_cast<unsigned long>(rxCount), static_cast<unsigned long>(txCount));
  display.printf("Queue %u Drop %lu\n", static_cast<unsigned int>(radioQueue.size()), static_cast<unsigned long>(dropCount));
  display.display();
}
}

void setup() {
  Serial.begin(115200);
  pinMode(LedPin, OUTPUT); digitalWrite(LedPin, LOW);
  WiFi.persistent(false); WiFi.mode(WIFI_OFF);
  Wire.begin(21, 22); Wire.setClock(400000);
  // Wire probing avoids treating an absent display as proof of hardware failure.
  Wire.beginTransmission(0x3c);
  hasDisplay = Wire.endTransmission() == 0 && display.begin(SSD1306_SWITCHCAPVCC, 0x3c);
  bleInput = xQueueCreate(4, sizeof(Frame));
  if (!bleInput) { error("allocation_failed"); while (true) delay(1000); }
  uint8_t mac[6]{};
  if (esp_efuse_mac_get_default(mac) == ESP_OK) {
    nodeId = em::nodeIdFromMac(mac);
    startBle(nodeId);
  } else error("mac_read_failed");
  SPI.begin(5, 19, 27, 18);
  radioReady = radio.begin(EM_FREQUENCY_HZ / 1000000.0F, 125.0F, 7, 5, 0x12, 10, 8, 0) == RADIOLIB_ERR_NONE;
  if (radioReady) {
    radioReady = radio.setCRC(true) == RADIOLIB_ERR_NONE;
    if (radioReady) startRadioReceive();
  } else error("radio_initialization_failed");
  emitReady();
  lastDisplay = millis() - 2000; updateDisplay();
}

void loop() {
  pollSerial(); pollBle(); pollRadio(); updateDisplay(); delay(2);
}
