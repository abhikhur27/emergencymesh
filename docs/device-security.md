# RescueMesh device keys

RescueMesh uses the existing compact v1 encoding and AES-256-GCM. Each newly enrolled phone/companion pair gets an independently generated 256-bit secret and origin. Relays and radio boards forward opaque frames; they do not hold content keys. A recipient hub resolves the registered `(region, origin, keyId)` tuple before authenticating/decrypting a request. An unknown or revoked tuple fails closed, even if the old regional key remains in private configuration.

The fingerprint is SHA-256 recognition metadata. It is not the encryption secret, an authentication credential, or proof of physical board possession. The secret is held in the phone's Keychain and in the hub's private registry. This is identity provisioning for a phone/companion pair, not a tamper-resistant ESP32 secure element or secure physical BLE enrollment.

## Enrollment and storage

`initializeDeviceKeyring(config)` creates a separate random hub wrapping master, version and registry in the caller's in-memory config. `createDeviceProfile(config, options)` returns a private profile with the unchanged iOS fields `region`, `keyId`, `keyHex`, `origin`, plus safe device metadata. The caller must atomically persist the changed private config before releasing that profile. `registerDeviceProfile` supports an explicitly supplied profile; network packets never enroll themselves.

Device keys in the registry are wrapped with AES-256-GCM under a master separate from the old regional key. Region, origin, key slot, fingerprint, label, enrollment time, legacy status and revocation time are authenticated as wrapping AAD. A revoked record cannot be reactivated by removing its revocation timestamp. The wrapping master must stay private on the hub; do not put it in a phone profile, MongoDB metadata projection, API, log or public repository. Key wrapping does not protect a compromised running hub or an attacker who obtains its master and registry together.

`publicDevices` returns only enrollment metadata. Do not expose the full configuration or wrapped-key records as a substitute for that safe projection. Private profile delivery remains an operator-controlled enrollment step; copying a profile clones its cryptographic identity.

## Compatibility and migration

The v1 wire does not change. Header16 + nonce12 + request payload20–140 + tag16 remains64–184 bytes, below the220-byte radio cap. Plaintext fields use the existing compact binary schema; ciphertext is not compressed. Only hop byte14 is excluded from message AAD so relays may decrement it. Origin, sequence, region, type/version and key slot remain authenticated.

The currently flashed firmware filters `keyId == EM_KEY_ID` (normally1). All demo devices therefore use the same **key slot**, but different origins and independently random secrets. A key slot is not a device ID. Issue a fresh origin/key in that same slot and revoke the old tuple for a live migration. Changing the radio key slot requires matching firmware configuration across the participating boards.

For existing phones, the hub startup migration may register only the known private profile identities with `legacy:true`. There is no automatic fallback for arbitrary origins using the shared regional key. Explicitly registered legacy profiles remain transitional: any legacy phones sharing that old secret can read each other's legacy traffic. Re-provision them with distinct new profiles to remove that legacy sharing. Preserve current profiles/outbox during migration and report legacy status honestly.

## Receipts and replay

A receipt's visible sender origin remains the hub origin. Its AES key and key-slot byte must come from the original request's device enrollment, not a global regional key. Phones already open receipts with their own profile key and validate the receipt request origin/sequence. The hub does not trial-decrypt receipts against every key; incoming receipt echoes can be ignored by type before request decoding.

Revocation blocks new/retried radio requests for that identity. Enrollment does not replace the durable replay/deduplication store, bounded retries, per-origin sequence reservation, receipt matching or rate limits. Retransmission reuses the already sealed frame. Production encodings use fresh 96-bit random nonces; fixed nonces are for public deterministic tests only. Automatic agent processing never creates an operator-reviewed receipt or a responder-arrival claim.

## Primary references

- [NIST SP800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final): GCM authenticated encryption with associated data and nonce requirements.
- [Node crypto API](https://nodejs.org/api/crypto.html): `createCipheriv`, `setAAD`, full authentication tags, `createDecipheriv` and `randomBytes`.
- [Apple CryptoKit AES.GCM](https://developer.apple.com/documentation/cryptokit/aes/gcm): native iOS authenticated sealing/opening. Actual native execution requires a Mac/iOS build; Node golden vectors are not a native-device test.
