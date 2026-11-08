import XCTest
@testable import EmergencyMesh

final class WireCodecTests: XCTestCase {
    private let key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    private var profile: ProvisioningProfile { ProvisioningProfile(region: 1, keyId: 1, keyHex: key, origin: 16909060) }
    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "golden-v1", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }
    private func request() throws -> Data {
        let date = Date(timeIntervalSince1970: 1794000000)
        let fix = LocationFix(latitude: 32.9858, longitude: -96.7501, accuracy: 12, capturedAt: date)
        let draft = RequestDraft(category: .medical, severity: .urgent, people: 2, note: "Test request")
        return try WireCodec.requestPlaintext(draft: draft, location: fix, battery: 77, createdAt: date)
    }
    func testRequestMatchesNodeGoldenVector() throws {
        let fixture = try fixture()
        let expected = try XCTUnwrap(Data(hex: try XCTUnwrap(fixture["requestFrameHex"] as? String)))
        let sealed = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42, nonce: Data(hex: "000102030405060708090a0b"))
        XCTAssertEqual(sealed, expected)
        XCTAssertEqual(try WireCodec.open(sealed, profile: profile, expectedType: 1), try request())
    }
    func testReadsNodeReceipt() throws {
        let fixture = try fixture(); let frame = try XCTUnwrap(Data(hex: try XCTUnwrap(fixture["receiptFrameHex"] as? String)))
        let receipt = try WireCodec.receipt(frame, profile: profile)
        XCTAssertEqual(receipt.requestOrigin, profile.origin); XCTAssertEqual(receipt.requestSequence, 42)
        XCTAssertEqual(receipt.status, 1); XCTAssertEqual(receipt.text, "Hub received")
    }
    func testOnlyRelayHopMayChangeWithoutAuthenticationFailure() throws {
        var frame = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42)
        frame[14] = 1; XCTAssertEqual(try WireCodec.open(frame, profile: profile, expectedType: 1), try request())
        frame[10] ^= 1; XCTAssertThrowsError(try WireCodec.open(frame, profile: profile, expectedType: 1))
    }
    func testTamperingAndWrongRegionAreRejected() throws {
        var frame = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42)
        frame[30] ^= 1; XCTAssertThrowsError(try WireCodec.open(frame, profile: profile, expectedType: 1))
        let other = ProvisioningProfile(region: 2, keyId: 1, keyHex: key, origin: 5)
        XCTAssertThrowsError(try WireCodec.open(frame, profile: other, expectedType: 1))
        XCTAssertThrowsError(try WireCodec.receipt(frame, profile: profile))
    }
    func testUTF8ByteLimitAndUnknownLocationEncoding() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        var draft = RequestDraft(); draft.note = String(repeating: "é", count: 60)
        let p = try WireCodec.requestPlaintext(draft: draft, location: nil, battery: 255, createdAt: date)
        XCTAssertEqual(p.count, 140); XCTAssertEqual(p[3], 0)
        XCTAssertEqual(try p.readLE(Int32.self, at: 8), 0); XCTAssertEqual(try p.readLE(Int32.self, at: 12), 0)
        XCTAssertEqual(try p.readLE(UInt16.self, at: 16), UInt16.max)
        draft.note += "é"; XCTAssertThrowsError(try WireCodec.requestPlaintext(draft: draft, location: nil, battery: 255, createdAt: date))
    }
    func testOldLocationIsNotTransmitted() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        let old = LocationFix(latitude: 32, longitude: -96, accuracy: 5, capturedAt: date.addingTimeInterval(-121))
        let p = try WireCodec.requestPlaintext(draft: RequestDraft(), location: old, battery: 0, createdAt: date)
        XCTAssertEqual(p[3] & 1, 0)
    }
    func testEverySupplyCombinationPreservesLegacyFlagsAndNoteBytes() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        let fix = LocationFix(latitude: 32.9858, longitude: -96.7501, accuracy: 12, capturedAt: date)
        // Exhaust all 256 flags values: new supply bits must not overwrite GPS or concerns.
        for expected in UInt16(0)...UInt16(255) {
            let flags = UInt8(expected)
            let selected = Set(SupplyNeed.allCases.filter { flags & $0.rawValue != 0 })
            let draft = RequestDraft(breathingConcern: flags & 2 != 0, trapped: flags & 4 != 0,
                                     severeBleeding: flags & 8 != 0, supplies: selected, note: "East door")
            let payload = try WireCodec.requestPlaintext(draft: draft, location: flags & 1 == 0 ? nil : fix, battery: 77, createdAt: date)
            XCTAssertEqual(payload[3], flags, "Flags \(expected)")
            XCTAssertEqual(payload.count, 20 + draft.byteCount)
            XCTAssertEqual(payload[19], UInt8(draft.byteCount))
            XCTAssertEqual(String(data: payload.dropFirst(20), encoding: .utf8), "East door")
        }
    }
    func testNewCategoriesKeepExistingWireIDs() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        let categories: [EmergencyCategory] = [.medical, .fire, .rescue, .safety, .supplies, .flood, .earthquake, .other]
        for (index, category) in categories.enumerated() {
            let payload = try WireCodec.requestPlaintext(draft: RequestDraft(category: category), location: nil, battery: 255, createdAt: date)
            XCTAssertEqual(payload[0], UInt8(index + 1))
            XCTAssertEqual(payload.count, 20)
        }
    }
    func testLegacyDraftWithoutSuppliesPreservesAllFields() throws {
        let legacy = Data(#"{"category":3,"severity":2,"people":7,"breathingConcern":true,"trapped":true,"severeBleeding":false,"note":"North stairwell"}"#.utf8)
        let restored = try JSONDecoder().decode(RequestDraft.self, from: legacy)
        XCTAssertEqual(restored, RequestDraft(category: .rescue, severity: .serious, people: 7,
                                              breathingConcern: true, trapped: true, note: "North stairwell"))
        XCTAssertTrue(restored.supplies.isEmpty)
        let selected = RequestDraft(category: .flood, supplies: [.water, .medicine, .power], note: "Upper floor")
        XCTAssertEqual(try JSONDecoder().decode(RequestDraft.self, from: JSONEncoder().encode(selected)), selected)
    }
    func testLegacySavedHistoryWithoutSuppliesRetainsRetryFrameAndReceiptState() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        let draft = RequestDraft(category: .rescue, people: 3, trapped: true, note: "North stairwell")
        let plaintext = try WireCodec.requestPlaintext(draft: draft, location: nil, battery: 255, createdAt: date)
        let frame = try WireCodec.seal(type: 1, plaintext: plaintext, profile: profile, sequence: 42)
        var item = OutboxItem(origin: profile.origin, sequence: 42, createdAt: date, draft: draft, location: nil, frame: frame)
        item.status = .submitted; item.attemptCount = 2; item.firstAttemptAt = date; item.lastAttemptAt = date
        item.receiptText = "Previously saved text"
        var snapshot = AppSnapshot(); snapshot.draft = draft; snapshot.outbox = [item]
        snapshot.receiptDigests = ["123-7": "saved-authenticated-digest"]
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as? [String: Any])
        var oldDraft = try XCTUnwrap(legacy["draft"] as? [String: Any]); oldDraft.removeValue(forKey: "supplies"); legacy["draft"] = oldDraft
        var oldItems = try XCTUnwrap(legacy["outbox"] as? [[String: Any]])
        var oldItemDraft = try XCTUnwrap(oldItems[0]["draft"] as? [String: Any]); oldItemDraft.removeValue(forKey: "supplies")
        oldItems[0]["draft"] = oldItemDraft; legacy["outbox"] = oldItems
        let restored = try JSONDecoder().decode(AppSnapshot.self, from: JSONSerialization.data(withJSONObject: legacy))
        let saved = try XCTUnwrap(restored.outbox.first)
        XCTAssertEqual(restored.draft, draft); XCTAssertEqual(saved.draft, draft)
        XCTAssertTrue(saved.draft.supplies.isEmpty); XCTAssertEqual(saved.frame, frame)
        XCTAssertEqual(saved.sequence, 42); XCTAssertEqual(saved.attemptCount, 2); XCTAssertEqual(saved.status, .submitted)
        XCTAssertEqual(saved.firstAttemptAt, date); XCTAssertEqual(saved.lastAttemptAt, date)
        XCTAssertEqual(saved.receiptText, "Previously saved text"); XCTAssertEqual(restored.receiptDigests, snapshot.receiptDigests)
        XCTAssertEqual(try WireCodec.open(saved.frame, profile: profile, expectedType: 1), plaintext)
    }
    func testFreshestUsableGPSIsSelectedAtSendTime() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        let olderAccurate = LocationFix(latitude: 32, longitude: -96, accuracy: 2, capturedAt: date.addingTimeInterval(-60))
        let freshest = LocationFix(latitude: 33, longitude: -97, accuracy: 30, capturedAt: date.addingTimeInterval(-2))
        let expired = LocationFix(latitude: 34, longitude: -98, accuracy: 1, capturedAt: date.addingTimeInterval(-121))
        let invalid = LocationFix(latitude: 91, longitude: -98, accuracy: 1, capturedAt: date)
        let future = LocationFix(latitude: 34, longitude: -98, accuracy: 1, capturedAt: date.addingTimeInterval(121))
        let selected = LocationFix.latestUsable([olderAccurate, freshest, expired, invalid, future], at: date)
        XCTAssertEqual(selected, freshest)
        let payload = try WireCodec.requestPlaintext(draft: RequestDraft(supplies: [.water]), location: selected, battery: 255, createdAt: date)
        XCTAssertEqual(payload[3], 1 | 32)
        XCTAssertEqual(try payload.readLE(Int32.self, at: 8), 3_300_000)
        XCTAssertEqual(try payload.readLE(Int32.self, at: 12), -9_700_000)
        // A later send must re-evaluate freshness rather than carrying forward the old selection.
        XCTAssertNil(LocationFix.latestUsable([olderAccurate, freshest, expired, invalid], at: date.addingTimeInterval(121)))
    }
    func testUnavailableGPSLeavesSupplyFlagsAndUsesUnknownLocationSentinel() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        let expired = LocationFix(latitude: 32, longitude: -96, accuracy: 5, capturedAt: date.addingTimeInterval(-121))
        let fix = LocationFix.latestUsable([expired], at: date)
        XCTAssertNil(fix)
        let payload = try WireCodec.requestPlaintext(draft: RequestDraft(supplies: [.food, .power]), location: fix, battery: 255, createdAt: date)
        XCTAssertEqual(payload[3], 16 | 128)
        XCTAssertEqual(try payload.readLE(Int32.self, at: 8), 0)
        XCTAssertEqual(try payload.readLE(Int32.self, at: 12), 0)
        XCTAssertEqual(try payload.readLE(UInt16.self, at: 16), UInt16.max)
    }
    func testChunkReassemblyOutOfOrderAndDuplicates() throws {
        let frame = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42)
        let chunks = try BLEFraming.chunks(frame: frame, transferID: 9)
        XCTAssertTrue(chunks.allSatisfy { $0.count <= 20 })
        var assembler = BLEReassembler(); XCTAssertNil(try assembler.accept(chunks[0]))
        XCTAssertNil(try assembler.accept(chunks[0]))
        var completed: Data?
        for part in chunks.dropFirst().reversed() { if let value = try assembler.accept(part) { completed = value } }
        XCTAssertEqual(completed, frame)
    }
    func testFragmentsTimeoutAndOversizeAreRejected() throws {
        let frame = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42)
        let chunks = try BLEFraming.chunks(frame: frame, transferID: 9); var assembler = BLEReassembler()
        let now = Date(); XCTAssertNil(try assembler.accept(chunks[0], at: now))
        var completed: Data?
        for chunk in chunks.dropFirst() { completed = try assembler.accept(chunk, at: now.addingTimeInterval(6)) }
        XCTAssertNil(completed)
        XCTAssertThrowsError(try assembler.accept(Data([0xe1, 1, 0, 15, 9])))
        XCTAssertThrowsError(try BLEFraming.chunks(frame: Data(repeating: 0, count: 221), transferID: 1))
    }
    func testKeyHexAndProfileValidation() throws {
        XCTAssertNil(Data(hex: "xyz")); XCTAssertNil(Data(hex: "0g"))
        XCTAssertThrowsError(try ProvisioningProfile(region: 0, keyId: 1, keyHex: key, origin: 9).validate())
        XCTAssertThrowsError(try ProvisioningProfile(region: 1, keyId: 1, keyHex: "00", origin: 9).validate())
        XCTAssertThrowsError(try ProvisioningProfile(region: 1, keyId: 1, keyHex: key, origin: 0).validate())
    }
    func testIdentityCounterSurvivesOutboxClearAndReservesBeforeSend() throws {
        var protectedCounter: Data?
        func reserve() throws -> UInt32 { try SequenceCounter.reserve(read: { protectedCounter }, write: { protectedCounter = $0 }) }
        XCTAssertEqual(try reserve(), 1)
        var localHistory = AppSnapshot(); localHistory = AppSnapshot() // clearing history does not own Keychain counters
        XCTAssertTrue(localHistory.outbox.isEmpty)
        XCTAssertEqual(try reserve(), 2) // same profile reimport/relaunch
        XCTAssertEqual(try reserve(), 3)
        let previous = protectedCounter
        XCTAssertThrowsError(try SequenceCounter.reserve(read: { protectedCounter }, write: { _ in throw MeshError.invalid("storage failure") }))
        XCTAssertEqual(protectedCounter, previous)
        XCTAssertEqual(try reserve(), 4)
    }
    func testSiblingDeviceCannotReadRequestOrHubReceipt() throws {
        let sibling = ProvisioningProfile(region: profile.region, keyId: profile.keyId, keyHex: String(repeating: "22", count: 32), origin: 0x22222222)
        let frame = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42)
        XCTAssertThrowsError(try WireCodec.open(frame, profile: sibling, expectedType: 1))
        let fixture = try fixture()
        let receipt = try XCTUnwrap(Data(hex: try XCTUnwrap(fixture["receiptFrameHex"] as? String)))
        XCTAssertThrowsError(try WireCodec.receipt(receipt, profile: sibling))
        XCTAssertEqual(try WireCodec.receipt(receipt, profile: profile).requestOrigin, profile.origin)
    }
    func testReceiptRecipientIsCheckedEvenForExplicitLegacySharedKeys() throws {
        let hub = ProvisioningProfile(region: profile.region, keyId: profile.keyId, keyHex: key, origin: 0x99999999)
        func receipt(origin: UInt32, sequence: UInt32) throws -> Data {
            var payload = Data(); payload.appendLE(origin); payload.appendLE(sequence)
            payload.append(contentsOf: [1, 0])
            return try WireCodec.seal(type: 2, plaintext: payload, profile: hub, sequence: 77)
        }
        XCTAssertThrowsError(try WireCodec.receipt(receipt(origin: 0x22222222, sequence: 42), profile: profile))
        XCTAssertThrowsError(try WireCodec.receipt(receipt(origin: profile.origin, sequence: 0), profile: profile))
        var valid = try receipt(origin: profile.origin, sequence: 42)
        valid[14] = 0 // Opaque relays may consume the hop count on the return path too.
        XCTAssertEqual(try WireCodec.receipt(valid, profile: profile).hubOrigin, hub.origin)
    }
    func testVisibleOriginAndKeySlotAreAuthenticated() throws {
        let frame = try WireCodec.seal(type: 1, plaintext: request(), profile: profile, sequence: 42)
        var changedOrigin = frame; changedOrigin[6] ^= 1
        XCTAssertThrowsError(try WireCodec.open(changedOrigin, profile: profile, expectedType: 1))
        var changedSlot = frame; changedSlot[15] = 2
        let changedProfile = ProvisioningProfile(region: profile.region, keyId: 2, keyHex: key, origin: profile.origin)
        XCTAssertThrowsError(try WireCodec.open(changedSlot, profile: changedProfile, expectedType: 1))
        let fingerprintProfile = ProvisioningProfile(region: profile.region, keyId: profile.keyId, keyHex: profile.keyFingerprint, origin: profile.origin)
        XCTAssertEqual(profile.keyFingerprint.count, 64)
        XCTAssertNotEqual(profile.keyFingerprint, key)
        XCTAssertThrowsError(try WireCodec.open(frame, profile: fingerprintProfile, expectedType: 1))
    }
    func testSavedOutboxRetainsTheOriginalFrameForRetries() throws {
        let date = Date(timeIntervalSince1970: 1794000000)
        var draft = RequestDraft(supplies: [.food, .water, .medicine, .power]); draft.note = String(repeating: "a", count: 120)
        let plaintext = try WireCodec.requestPlaintext(draft: draft, location: nil, battery: 255, createdAt: date)
        XCTAssertEqual(plaintext[3], 0xf0)
        let frame = try WireCodec.seal(type: 1, plaintext: plaintext, profile: profile, sequence: 42)
        XCTAssertEqual(frame.count, 184); XCTAssertLessThanOrEqual(frame.count, WireCodec.maxFrame)
        var snapshot = AppSnapshot()
        snapshot.outbox.append(OutboxItem(origin: profile.origin, sequence: 42, createdAt: date, draft: draft, location: nil, frame: frame))
        let restored = try JSONDecoder().decode(AppSnapshot.self, from: JSONEncoder().encode(snapshot))
        XCTAssertEqual(restored.outbox.first?.frame, frame)
        XCTAssertEqual(restored.outbox.first?.sequence, 42)
        XCTAssertEqual(restored.outbox.first?.draft.supplies, draft.supplies)
        XCTAssertEqual(try WireCodec.open(try XCTUnwrap(restored.outbox.first?.frame), profile: profile, expectedType: 1), plaintext)
    }
}
