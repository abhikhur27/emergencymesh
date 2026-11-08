# RescueMesh protocol v1

Current implementation contract, November 8, 2026. The envelope and field offsets remain v1. Added category values, supply flags and independent device-key lookup use existing bytes; legacy golden vectors remain unchanged. No real dispatch integration is enabled.

## Radio envelope

All multibyte integers are little endian. Maximum complete radio envelope: 220 bytes. Requests occupy 64–184 bytes; receipts occupy 54–134 bytes.

| Byte offset | Field |
| --- | --- |
| 0–1 | ASCII `EM` |
| 2 | Version `1` |
| 3 | Type: `1` request, `2` receipt |
| 4–5 | Region, uint16 |
| 6–9 | Sender origin, uint32 |
| 10–13 | Sender sequence, uint32 |
| 14 | Remaining hops, uint8, 0–4; initial value 3 |
| 15 | Key slot (`keyId`), uint8 |
| 16–27 | Fresh random 12-byte GCM nonce |
| 28 onward | AES-256-GCM ciphertext, followed by a 16-byte authentication tag |

GCM additional authenticated data is header bytes 0–13 concatenated with byte 15. Only hop byte 14 may change in transit. Reject invalid magic, version, type, hop or type-specific size before forwarding. Radio nodes also filter configured region and key slot. Framing is not authentication: companions/relays cannot decrypt or verify the tag; hub/phone authenticate before accepting content.

The registered `(region, origin, keyId)` selects a request key at the hub. Newly enrolled profiles use independent random 256-bit secrets; using slot 1 across current boards does not mean sharing a secret. Unknown/revoked identities fail closed. Explicitly registered legacy profiles remain compatible but can retain an old shared secret. A SHA-256 fingerprint is recognition metadata, not a key. See [key storage and migration](device-security.md).

Request identity is `(region, origin, sequence)`. Replay entries retain a SHA-256 frame digest normalized only at hop byte 14; differing payloads cannot replace an existing identity. Retries reuse identical sealed bytes. New encryption generates a fresh nonce; fixed nonces are for public synthetic vectors only.

## Request plaintext

| Byte offset | Field |
| --- | --- |
| 0 | Category: `1` medical, `2` fire, `3` rescue, `4` safety, `5` supplies, `6` flood, `7` earthquake, `8` other |
| 1 | User-selected priority: `1` urgent, `2` serious, `3` assistance |
| 2 | People, uint8, 1–255 |
| 3 | Flags, uint8; any combination of the eight bits below |
| 4–7 | Creation Unix seconds, uint32 |
| 8–11 | Latitude, int32, degrees × 100,000 |
| 12–15 | Longitude, int32, degrees × 100,000 |
| 16–17 | Accuracy in meters, uint16; 65535 means unknown |
| 18 | Phone battery, 0–100; 255 means unknown |
| 19 | UTF-8 note byte length, 0–120 |
| 20 onward | Exact note bytes |

| Flag value | Meaning |
| --- | --- |
| `1` | Location known |
| `2` | Breathing concern reported |
| `4` | Trapped reported |
| `8` | Severe bleeding reported |
| `16` | Food selected |
| `32` | Water selected |
| `64` | Medicine selected |
| `128` | Power selected |

Supply choices may coexist with any category. They use the flags byte and add no bytes. Supply quantities are not encoded; per-person planning quantities and response-team counts are separately attributed software policy.

Unknown location requires zero coordinates and accuracy 65535. Known coordinates must be in valid geographic ranges. The app automatically attaches the newest usable authorized GPS fix and accuracy when available, without blocking sending for a missing fix. GPS evidence does not establish an address or surveyed campus-map position.

Plaintext is 20–140 bytes; header 16 + nonce 12 + plaintext 20–140 + tag 16 produces a 64–184-byte request. UTF-8 must be valid and length-exact, without silent truncation. The user's reported priority remains immutable through automated processing.

## Receipt plaintext

| Byte offset | Field |
| --- | --- |
| 0–3 | Original request origin, uint32 |
| 4–7 | Original request sequence, uint32 |
| 8 | Status: `1` hub received, `2` operator reviewed |
| 9 | UTF-8 receipt text byte length, 0–80 |
| 10 onward | Exact receipt text bytes |

Receipt plaintext is 10–90 bytes; the full frame is 54–134 bytes. Envelope origin/sequence identify the hub's outgoing message, not the original request. The hub seals each receipt with the original request's registered phone key and key slot. The phone accepts it only after authentication and matching its own origin and a known request sequence. A delayed hub receipt cannot downgrade operator-reviewed status.

The hub persists a receipt before inference or regional work. Duplicates resend the saved receipt without creating another incident. Status 2 requires human review; automatic regional allocation does not fabricate it. Neither status means real emergency services were dispatched. Regional service acknowledgments are separate application records.

## Bidirectional operator messages

Questions and answers reuse the authenticated v1 request/receipt envelopes. Existing v1 firmware forwards their opaque bytes unchanged; this feature requires an updated phone app and hub software, without a firmware reflash or new packet type.

| Message | Carrier and exact text grammar |
| --- | --- |
| Phone capability | Type 1 note exactly `RMC1\|Q1`; category 8, priority 3, people 1, flags 0, battery 255, unknown location |
| Capability acknowledgment | Type 2, status 1, text exactly `RMC1\|Q1\|OK`, referencing the capability request's own sequence |
| Operator question | Type 2, status 1, text `RMQ1\|<questionId>\|<question>`, referencing the original report's origin and sequence |
| Phone answer | Type 1 note `RMR1\|<reportSequence>\|<questionId>\|<answer>`, with a new persisted phone sequence |

Both identifiers in control text are exactly eight lowercase hexadecimal digits and nonzero. Question text is at most 66 UTF-8 bytes (14-byte prefix); answer text is at most 97 bytes (23-byte prefix). Thus the existing 80-byte receipt and 120-byte note limits remain unchanged. Text must be nonempty, valid UTF-8, already trimmed, and contain no C0 or DEL controls, including newlines; encoding never silently truncates it.

The phone enables messaging only after authenticating the exact versioned capability acknowledgment. The hub durably records capability per `(region, origin, keyId)` and will not send questions to older apps. Questions use that phone's registered key; a relay or another enrolled phone cannot read them. The original report, question and answer must belong to the same enrolled origin/key. Unknown questions and malformed reserved controls fail closed after authentication, timestamp, rate and replay checks. Control traffic never creates an incident or triggers inference or resource allocation.

An answer preserves the original report and includes fresh authorized GPS when available as separate answer context. The hub saves it before sending a normal status-1 receipt referencing the answer's new sequence. This receipt confirms the saved answer, not an operator review. The app handles questions separately from the original report's receipt state.

The hub saves each sealed question before transmission and retries the identical bytes at 0, 10, 25 and 45 seconds, subject to radio readiness and a persistent limit of eight question transmissions per minute with two-second spacing. Status progresses from `queued` to `submitted-to-radio`; no answer after bounded attempts becomes `unconfirmed`, never proof of delivery. One unanswered question per incident and eight globally may be pending; each incident retains at most twelve questions. Explicit closure stops retries and frees capacity. A valid late answer remains accepted and acknowledged without reopening the closed question or changing another question. Duplicate requests return their cached receipts across restart; conflicting reuse of an identity is rejected. Questions originate from an authenticated human operator, locally or through regional coordination.

## BLE

The companion advertises Nordic UART service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`. The phone writes RX `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` **with response**, and subscribes to TX `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` notifications. Hub firmware disables BLE by default so the phone cannot select the receiving hub as its companion.

Each ATT value is at most 20 bytes: marker `0xE1`, transfer ID uint8, zero-based chunk index uint8, chunk count uint8 (1–14), then 1–16 frame bytes. All nonfinal chunks have exactly 16 bytes. Indexed reassembly is bounded to 220 bytes and expires after five seconds. Transfer ID identifies fragmentation, not a request identity.

Writes are sequential and respect write responses. TX uses the same fragmentation for sealed receipts. Local completion means submission to the device, not hub delivery. Firmware queues complete opaque frames and emits serial diagnostics; it does not fabricate a BLE delivery acknowledgment. Automatic phone attempts are initially at 0, 10, 25 and 45 seconds, subject to readiness/backoff. It then shows unconfirmed and offers explicit retry. The encrypted outbox preserves sealed bytes across reconnect/relaunch.

## USB serial and mesh forwarding

USB serial is 115200 baud, newline-delimited JSON, at most 1024 bytes per line. Only the hub build accepts host transmission commands:

```json
{"op":"tx","frame":"<base64>"}
```

Radio input is forwarded as:

```json
{"op":"rx","frame":"<base64>","rssi":-70,"snr":7.0}
```

The host may query `{"op":"status"}` after opening a port. Boot/status metadata includes `op: "ready"`, node, role, frequency, protocol, region, keyId and radioReady. Bounded `error` and `queued` messages describe local failures/admission. The host transmits only after matching typed readiness and `radioReady: true`. An open port or ready self-report is not proof of RF delivery; `queued` is local admission only. Debug text is never parsed as a frame.

Firmware uses expiring duplicate suppression, a six-second duplicate cooldown, randomized relay delay, hop decrement and bounded queues/rate. A zero-hop frame may be delivered locally but never rebroadcast. Identical retries may transmit after cooldown to recover lost receipts. The hub sends serial-origin frames over radio; the companion forwards received receipts over BLE when a phone is subscribed. All nodes use the same PHY and regional filter. This custom managed flood is not LoRaWAN or Meshtastic.

## Current hardware profile

LILYGO T3 LoRa32 V1.6.1 ESP32/SX1276 standard profile: SCK 5, MISO 19, MOSI 27, NSS 18, RESET 23, DIO0 26, DIO1 33; LED 25; OLED SDA 21, SCL 22, address `0x3c`.

Current US PHY: 915 MHz, 125 kHz bandwidth, SF7, coding rate 4/5, sync word `0x12`, 10 dBm, CRC enabled, explicit header, eight-symbol preamble. A TCXO/433 MHz/other board variant needs a verified matching profile and antenna. A family label alone does not prove radio/pin variant, legal operating profile, measured range or RF compliance.

## Provisioning and application boundaries

Private enrollment supplies the phone's region, key slot, secret and origin. The phone uses Keychain; the hub wraps independent keys under a separate private master and exposes only safe metadata. Firmware has no encryption secret. Current flashed nodes filter slot 1; changing it requires matching firmware across the mesh. Copying a profile clones identity rather than proving physical board possession. Legacy identities are preserved explicitly until revoked or re-provisioned.

The hub stores original authenticated fields before processing. Complete typed signals bypass summarization. Bounded local Nemotron assistance may consult permitted tools for freeform content; failures retain source-preserving policy. Notes remain untrusted data, including embedded instructions. The local operator UI uses authenticated sessions, same-origin mutation checks and CSRF protection.

Automatic coordination uses the separate `rescuemesh.case.v1` JSON schema over authenticated HTTP transport. The deployment carries this through a private SSH forward to the desktop; the regional operator page separately uses Cloudflare HTTPS. Durable event/case IDs, revision acknowledgments and returned updates support retries without double reservation. `summary.needRequests[]` carries each resource and quantity provenance; original `request.flags` and derived supply choices stay explicit. Old prepared single-resource envelopes retain compatibility.

The supervisor validates fields/inventory, uses Brev Nemotron's restricted tools when valid, reserves each resource once and records partial fulfillment/human exceptions. The same cloud provider generates bounded wording for three exercise towns. The dispatcher adapter acknowledges exercise resources only. Human review remains required for an operator-reviewed phone receipt and optional reviewed simulation export. No inference or automatic workflow contacts a real emergency agency.

Temoc's Qwen model, local chats and offline guides are independent of this radio/coordination protocol. It cannot send reports or create delivery status. See [architecture](ARCHITECTURE.md), [Temoc](TEMOC.md) and [the full stack](TECHSTACK.md) for deployment and acceptance evidence.
