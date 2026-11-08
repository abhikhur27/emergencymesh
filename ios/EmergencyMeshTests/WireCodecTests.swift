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

    private func followupItem(sequence: UInt32 = 42, note: String = "Original report") throws -> OutboxItem {
        let date = Date(timeIntervalSince1970: 1794000000)
        let draft = RequestDraft(category: .medical, severity: .urgent, people: 3, breathingConcern: true, supplies: [.medicine, .water], note: note)
        let plain = try WireCodec.requestPlaintext(draft: draft, location: nil, battery: 77, createdAt: date)
        return OutboxItem(origin: profile.origin, sequence: sequence, createdAt: date, draft: draft, location: nil,
                          frame: try WireCodec.seal(type: 1, plaintext: plain, profile: profile, sequence: sequence))
    }
    private func followupReceipt(text: String, requestSequence: UInt32 = 42, hubSequence: UInt32 = 100, status: UInt8 = 1) -> AuthenticatedReceipt {
        AuthenticatedReceipt(hubOrigin: 0x99999999, hubSequence: hubSequence, requestOrigin: profile.origin,
                             requestSequence: requestSequence, status: status, text: text)
    }
    private func followupReceiptFrame(text: String, requestSequence: UInt32 = 42, origin: UInt32? = nil) throws -> Data {
        var plain = Data(); plain.appendLE(origin ?? profile.origin); plain.appendLE(requestSequence)
        plain.append(1); plain.append(UInt8(text.utf8.count)); plain.append(contentsOf: text.utf8)
        let hub = ProvisioningProfile(region: profile.region, keyId: profile.keyId, keyHex: key, origin: 0x99999999)
        return try WireCodec.seal(type: 2, plaintext: plain, profile: hub, sequence: 100)
    }
    func testFollowupQuestionAndAnswerFitUnchangedFirmwareLimits() throws {
        let question = try FollowupWire.questionText(id: "00000001", text: String(repeating: "é", count: 33))
        XCTAssertEqual(question.utf8.count, 80)
        let frame = try followupReceiptFrame(text: question)
        XCTAssertEqual(frame.count, 134)
        let parsed = try FollowupWire.question(from: WireCodec.receipt(frame, profile: profile).text)
        XCTAssertEqual(parsed?.id, "00000001"); XCTAssertEqual(parsed?.text.utf8.count, 66)
        XCTAssertThrowsError(try FollowupWire.questionText(id: "00000001", text: String(repeating: "é", count: 34)))
        let original = try followupItem()
        let answer = String(repeating: "é", count: 48) + "a"
        let draft = try FollowupWire.replyDraft(original: original.draft, reportSequence: 42, questionID: "00000001", text: answer)
        XCTAssertEqual(draft.note.utf8.count, 120)
        XCTAssertEqual(FollowupWire.answerText(from: draft.note), answer)
        XCTAssertTrue(draft.supplies.isEmpty); XCTAssertFalse(draft.breathingConcern)
        let date = Date(timeIntervalSince1970: 1794000010)
        let plain = try WireCodec.requestPlaintext(draft: draft, location: nil, battery: 77, createdAt: date)
        XCTAssertEqual(try WireCodec.seal(type: 1, plaintext: plain, profile: profile, sequence: 43).count, 184)
        XCTAssertThrowsError(try FollowupWire.answerNote(reportSequence: 42, questionID: "00000001", text: answer + "x"))
    }
    func testReviewedReportStillReceivesQuestionWithoutReceiptDowngrade() throws {
        var item = try followupItem(); item.status = .operatorReviewed
        let reviewedAt = Date(timeIntervalSince1970: 1794000005)
        item.receiptText = "Reviewed by operator"; item.receiptAt = reviewedAt
        var state = AppSnapshot(); state.outbox = [item]
        let now = reviewedAt.addingTimeInterval(5)
        let text = try FollowupWire.questionText(id: "00000001", text: "Which entrance are you near?")
        let first = try state.applyReceipt(followupReceipt(text: text), digest: "first", at: now)
        XCTAssertEqual(first, .questionAdded("\(item.id)-00000001"))
        XCTAssertEqual(state.outbox[0].status, .operatorReviewed)
        XCTAssertEqual(state.outbox[0].receiptText, "Reviewed by operator")
        XCTAssertEqual(state.outbox[0].receiptAt, reviewedAt)
        XCTAssertEqual(try state.applyReceipt(followupReceipt(text: text), digest: "first", at: now.addingTimeInterval(10)), .duplicate)
        XCTAssertEqual(try state.applyReceipt(followupReceipt(text: text, hubSequence: 101), digest: "retry", at: now.addingTimeInterval(20)), .duplicate)
        XCTAssertEqual(state.hubQuestions.count, 1); XCTAssertEqual(state.hubQuestions[0].receivedAt, now)
        XCTAssertNil(state.hubQuestions[0].seenAt)
        let changed = try FollowupWire.questionText(id: "00000001", text: "Changed question")
        XCTAssertThrowsError(try state.applyReceipt(followupReceipt(text: changed, hubSequence: 102), digest: "changed", at: now))
        XCTAssertNil(state.receiptDigests["2576980377-102"])
        XCTAssertEqual(state.outbox[0].frame, item.frame)
    }
    func testFollowupRecipientAndOriginalReportBindingFailClosed() throws {
        let text = try FollowupWire.questionText(id: "00000001", text: "Please name a landmark.")
        XCTAssertThrowsError(try WireCodec.receipt(followupReceiptFrame(text: text, origin: 99), profile: profile))
        let sibling = ProvisioningProfile(region: 1, keyId: 1, keyHex: String(repeating: "22", count: 32), origin: 99)
        XCTAssertThrowsError(try WireCodec.receipt(followupReceiptFrame(text: text), profile: sibling))
        var state = AppSnapshot(); var control = try followupItem(sequence: 43); control.kind = .capability
        state.outbox = [control]
        XCTAssertThrowsError(try state.applyReceipt(followupReceipt(text: text, requestSequence: 43), digest: "control", at: Date()))
        XCTAssertEqual(try state.applyReceipt(followupReceipt(text: text), digest: "unrelated", at: Date()), .unrelated)
        XCTAssertTrue(state.hubQuestions.isEmpty); XCTAssertTrue(state.receiptDigests.isEmpty)
    }
    func testControlAndReplyReceiptsDoNotCreateOrChangeReports() throws {
        let report = try followupItem()
        var capability = try followupItem(sequence: 43, note: FollowupWire.capabilityNote)
        capability.kind = .capability; capability.profileIdentity = profile.messagingIdentity
        var reply = try followupItem(sequence: 44, note: FollowupWire.answerNote(reportSequence: 42, questionID: "00000001", text: "West entrance"))
        reply.kind = .reply; reply.reportID = report.id; reply.questionID = "00000001"
        var state = AppSnapshot(); state.outbox = [report, capability, reply]
        state.hubQuestions = [HubQuestion(reportID: report.id, questionID: "00000001", text: "Which entrance?", receivedAt: Date(), replyOutboxID: reply.id)]
        XCTAssertEqual(state.reports.count, 1)
        _ = try state.applyReceipt(followupReceipt(text: FollowupWire.capabilityAcknowledgment, requestSequence: 43, hubSequence: 101), digest: "cap", at: Date())
        XCTAssertTrue(state.messagingAcknowledgedProfiles.contains(profile.messagingIdentity))
        XCTAssertTrue(state.needsReply(state.hubQuestions[0]))
        _ = try state.applyReceipt(followupReceipt(text: "Reply saved", requestSequence: 44, hubSequence: 102), digest: "reply", at: Date())
        XCTAssertFalse(state.needsReply(state.hubQuestions[0]))
        XCTAssertEqual(state.reply(to: state.hubQuestions[0])?.status, .hubReceived)
        XCTAssertEqual(state.outbox[0].frame, report.frame); XCTAssertEqual(state.outbox[0].draft, report.draft)
        XCTAssertEqual(state.outbox[0].status, .queued); XCTAssertEqual(state.reports.count, 1)
    }
    func testLegacySnapshotDefaultsNewKindsAndConversationFields() throws {
        let item = try followupItem()
        var state = AppSnapshot(); state.outbox = [item]
        var old = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        old.removeValue(forKey: "hubQuestions"); old.removeValue(forKey: "messagingAcknowledgedProfiles")
        var oldItems = try XCTUnwrap(old["outbox"] as? [[String: Any]])
        for field in ["kind", "reportID", "questionID", "profileIdentity"] { oldItems[0].removeValue(forKey: field) }
        old["outbox"] = oldItems
        let restored = try JSONDecoder().decode(AppSnapshot.self, from: JSONSerialization.data(withJSONObject: old))
        XCTAssertEqual(restored.outbox[0].kind, .report)
        XCTAssertEqual(restored.reports.count, 1); XCTAssertTrue(restored.hubQuestions.isEmpty)
        XCTAssertTrue(restored.messagingAcknowledgedProfiles.isEmpty)
        XCTAssertEqual(restored.outbox[0].frame, item.frame)
    }
    func testFollowupGrammarRejectsMalformedAndNoncanonicalText() throws {
        XCTAssertNil(try FollowupWire.question(from: "Hub received"))
        XCTAssertTrue(FollowupWire.isReservedRequestNote("RMC1|Q1"))
        XCTAssertTrue(FollowupWire.isReservedRequestNote("RMR1|0000002a|00000001|West"))
        XCTAssertFalse(FollowupWire.isReservedRequestNote("West entrance"))
        for text in ["RMQ1|00000000|Where?", "RMQ1|0000000A|Where?", "RMQ1|000000001|Where?", "RMQ1|00000001|", "RMQ1|00000001| Where?", "RMQ1|00000001|Where? ", "RMQ1|00000001|Line\nbreak", "RMQ1|00000001|Bad\u{0000}text"] {
            XCTAssertThrowsError(try FollowupWire.question(from: text), text)
        }
        XCTAssertThrowsError(try FollowupWire.answerNote(reportSequence: 0, questionID: "00000001", text: "West"))
        XCTAssertThrowsError(try FollowupWire.answerNote(reportSequence: 42, questionID: "00000001", text: "Line\nbreak"))
        XCTAssertEqual(try FollowupWire.answerNote(reportSequence: 42, questionID: "00000001", text: "  West | lobby  "), "RMR1|0000002a|00000001|West | lobby")
        XCTAssertEqual(FollowupWire.answerText(from: "RMR1|0000002a|00000001|West | lobby"), "West | lobby")
    }
    func testReplyUsesNewSequenceAndFreshGPSWithoutChangingOriginalReport() throws {
        let original = try followupItem(); let originalBytes = original.frame
        let date = Date(timeIntervalSince1970: 1794000010)
        let draft = try FollowupWire.replyDraft(original: original.draft, reportSequence: original.sequence, questionID: "00000001", text: "West entrance")
        let fix = LocationFix(latitude: 32.9861, longitude: -96.7514, accuracy: 9, capturedAt: date)
        let plain = try WireCodec.requestPlaintext(draft: draft, location: fix, battery: 77, createdAt: date)
        let first = try WireCodec.seal(type: 1, plaintext: plain, profile: profile, sequence: 43)
        let second = try WireCodec.seal(type: 1, plaintext: plain, profile: profile, sequence: 44)
        XCTAssertEqual(plain[3], 1); XCTAssertEqual(try first.readLE(UInt32.self, at: 10), 43)
        XCTAssertNotEqual(first.subdata(in: 16..<28), second.subdata(in: 16..<28))
        XCTAssertEqual(try WireCodec.open(first, profile: profile, expectedType: 1), plain)
        XCTAssertEqual(original.frame, originalBytes); XCTAssertEqual(original.draft.note, "Original report")
    }
    func testHubQuestionRetentionAndReceiptCollisionAreBounded() throws {
        var state = AppSnapshot(); state.outbox = [try followupItem()]
        for number in UInt32(1)...12 {
            let text = try FollowupWire.questionText(id: String(format: "%08x", number), text: "Where are you?")
            _ = try state.applyReceipt(followupReceipt(text: text, hubSequence: number), digest: "digest-\(number)", at: Date())
        }
        XCTAssertEqual(state.hubQuestions.count, 12)
        let extra = try FollowupWire.questionText(id: "0000000d", text: "Where are you?")
        XCTAssertThrowsError(try state.applyReceipt(followupReceipt(text: extra, hubSequence: 13), digest: "extra", at: Date()))
        XCTAssertEqual(state.hubQuestions.count, 12)
        XCTAssertThrowsError(try state.applyReceipt(followupReceipt(text: extra, hubSequence: 1), digest: "conflict", at: Date()))
        XCTAssertEqual(state.receiptDigests["2576980377-1"], "digest-1")
    }
    func testSetupControlDoesNotStarveQueuedReportAndRetriesKeepSavedBytes() throws {
        var control = try followupItem(sequence: 43, note: FollowupWire.capabilityNote); control.kind = .capability
        let report = try followupItem()
        var state = AppSnapshot(); state.outbox = [control, report]
        let now = Date(timeIntervalSince1970: 1794000020)
        XCTAssertEqual(state.nextTransportIndex(at: now, retryOffsets: [0, 10, 25, 45]), 1)
        state.outbox[1].status = .hubReceived
        XCTAssertEqual(state.nextTransportIndex(at: now, retryOffsets: [0, 10, 25, 45]), 0)
        state.outbox[0].status = .submitted; state.outbox[0].attemptCount = 1
        state.outbox[0].firstAttemptAt = now; state.outbox[0].lastAttemptAt = now
        XCTAssertNil(state.nextTransportIndex(at: now.addingTimeInterval(7), retryOffsets: [0, 10, 25, 45]))
        XCTAssertEqual(state.nextTransportIndex(at: now.addingTimeInterval(10), retryOffsets: [0, 10, 25, 45]), 0)
        let restored = try JSONDecoder().decode(AppSnapshot.self, from: JSONEncoder().encode(state))
        XCTAssertEqual(restored.outbox[0].frame, control.frame); XCTAssertEqual(restored.outbox[0].kind, .capability)
        XCTAssertEqual(restored.reports.count, 1)
    }
    func testCapabilityRequiresExactVersionedAcknowledgment() throws {
        var capability = try followupItem(sequence: 43, note: FollowupWire.capabilityNote)
        capability.kind = .capability; capability.profileIdentity = profile.messagingIdentity
        var state = AppSnapshot(); state.outbox = [capability]
        for text in ["Hub received", "Messaging enabled", "RMC1|Q2|OK", "RMC1|Q1|OK "] {
            XCTAssertThrowsError(try state.applyReceipt(followupReceipt(text: text, requestSequence: 43), digest: "invalid", at: Date()))
            XCTAssertTrue(state.messagingAcknowledgedProfiles.isEmpty)
            XCTAssertTrue(state.receiptDigests.isEmpty)
            XCTAssertEqual(state.outbox[0].status, .queued)
        }
        XCTAssertThrowsError(try state.applyReceipt(followupReceipt(text: FollowupWire.capabilityAcknowledgment, requestSequence: 43, status: 2), digest: "wrong-status", at: Date()))
        _ = try state.applyReceipt(followupReceipt(text: FollowupWire.capabilityAcknowledgment, requestSequence: 43), digest: "valid", at: Date())
        XCTAssertEqual(state.outbox[0].status, .hubReceived)
        XCTAssertTrue(state.messagingAcknowledgedProfiles.contains(profile.messagingIdentity))
        XCTAssertEqual(state.receiptDigests.count, 1)
        XCTAssertTrue(state.reports.isEmpty); XCTAssertTrue(state.hubQuestions.isEmpty)
    }
    func testFollowupMessagesMatchSharedNodeGoldenVectors() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "followup-v1", withExtension: "json"))
        let fixture = try JSONDecoder().decode(NodeFollowupFixture.self, from: Data(contentsOf: url))
        XCTAssertTrue(fixture.fixtureIsPublicSynthetic)
        let phone = ProvisioningProfile(region: fixture.profile.region, keyId: fixture.profile.keyId,
                                        keyHex: fixture.keyHex, origin: fixture.profile.origin)
        let vectors: [(String, NodeFollowupFixture.Entry)] = [
            ("capability", fixture.capability), ("capabilityAcknowledgment", fixture.capabilityAcknowledgment),
            ("question", fixture.question), ("reply", fixture.reply), ("replyAcknowledgment", fixture.replyAcknowledgment)
        ]
        for (name, vector) in vectors {
            let envelope = vector.envelope
            let sender = ProvisioningProfile(region: envelope.region, keyId: envelope.keyId,
                                             keyHex: fixture.keyHex, origin: envelope.origin)
            let expected = try XCTUnwrap(Data(hex: vector.frameHex), name)
            let nonce = try XCTUnwrap(Data(hex: vector.nonceHex), name)
            let plaintext: Data
            let type: UInt8
            if let request = vector.request {
                XCTAssertNil(vector.receipt, name)
                let date = Date(timeIntervalSince1970: Double(request.createdAt))
                let selected = Set(SupplyNeed.allCases.filter { request.flags & $0.rawValue != 0 })
                let draft = RequestDraft(category: try XCTUnwrap(EmergencyCategory(rawValue: request.category)),
                                         severity: try XCTUnwrap(ReportedSeverity(rawValue: request.severity)), people: Int(request.people),
                                         breathingConcern: request.flags & 2 != 0, trapped: request.flags & 4 != 0,
                                         severeBleeding: request.flags & 8 != 0, supplies: selected, note: request.note)
                let location = request.flags & 1 == 0 ? nil : LocationFix(latitude: Double(request.latitude) / 100_000,
                    longitude: Double(request.longitude) / 100_000, accuracy: Double(request.accuracy), capturedAt: date)
                plaintext = try WireCodec.requestPlaintext(draft: draft, location: location, battery: request.battery, createdAt: date)
                XCTAssertEqual(plaintext[3], request.flags, name)
                XCTAssertEqual(try plaintext.readLE(Int32.self, at: 8), request.latitude, name)
                XCTAssertEqual(try plaintext.readLE(Int32.self, at: 12), request.longitude, name)
                XCTAssertEqual(try plaintext.readLE(UInt16.self, at: 16), request.accuracy, name)
                type = 1
            } else {
                let receipt = try XCTUnwrap(vector.receipt, name)
                var data = Data(); data.appendLE(receipt.requestOrigin); data.appendLE(receipt.requestSequence)
                data.append(receipt.status); data.append(UInt8(receipt.text.utf8.count)); data.append(contentsOf: receipt.text.utf8)
                plaintext = data; type = 2
                let decoded = try WireCodec.receipt(expected, profile: phone)
                XCTAssertEqual(decoded.requestOrigin, receipt.requestOrigin, name)
                XCTAssertEqual(decoded.requestSequence, receipt.requestSequence, name)
                XCTAssertEqual(decoded.hubOrigin, envelope.origin, name)
                XCTAssertEqual(decoded.hubSequence, envelope.sequence, name)
                XCTAssertEqual(decoded.status, receipt.status, name); XCTAssertEqual(decoded.text, receipt.text, name)
            }
            let sealed = try WireCodec.seal(type: type, plaintext: plaintext, profile: sender, sequence: envelope.sequence,
                                            hops: envelope.hops, nonce: nonce)
            XCTAssertEqual(sealed, expected, name)
            XCTAssertEqual(try WireCodec.open(expected, profile: phone, expectedType: type), plaintext, name)
        }
        XCTAssertEqual(fixture.capability.request?.note, FollowupWire.capabilityNote)
        XCTAssertEqual(fixture.capabilityAcknowledgment.receipt?.text, FollowupWire.capabilityAcknowledgment)
        let question = try XCTUnwrap(FollowupWire.question(from: fixture.question.receipt?.text ?? ""))
        XCTAssertEqual(question.id, fixture.questionId)
        let answer = try XCTUnwrap(FollowupWire.answerText(from: fixture.reply.request?.note ?? ""))
        XCTAssertEqual(try FollowupWire.answerNote(reportSequence: fixture.reportSequence, questionID: fixture.questionId, text: answer), fixture.reply.request?.note)
    }
}

// Public Node-generated vectors are also consumed by the hub's protocol tests.
private struct NodeFollowupFixture: Decodable {
    let fixtureIsPublicSynthetic: Bool
    let keyHex: String
    let profile: Profile
    let reportSequence: UInt32
    let questionId: String
    let capability: Entry
    let capabilityAcknowledgment: Entry
    let question: Entry
    let reply: Entry
    let replyAcknowledgment: Entry
    struct Profile: Decodable { let region: UInt16; let keyId: UInt8; let origin: UInt32 }
    struct Envelope: Decodable { let region: UInt16; let keyId: UInt8; let origin: UInt32; let sequence: UInt32; let hops: UInt8 }
    struct Request: Decodable {
        let category: UInt8; let severity: UInt8; let people: UInt8; let flags: UInt8; let createdAt: UInt32
        let latitude: Int32; let longitude: Int32; let accuracy: UInt16; let battery: UInt8; let note: String
    }
    struct Receipt: Decodable { let requestOrigin: UInt32; let requestSequence: UInt32; let status: UInt8; let text: String }
    struct Entry: Decodable { let request: Request?; let receipt: Receipt?; let envelope: Envelope; let nonceHex: String; let frameHex: String }
}
