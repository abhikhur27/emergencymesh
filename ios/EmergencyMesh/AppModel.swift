import Foundation
import Combine
import CryptoKit
import UIKit

final class AppModel: ObservableObject {
    let radio = BLETransport()
    let location = LocationService()
    @Published private(set) var profile: ProvisioningProfile?
    @Published private(set) var snapshot = AppSnapshot()
    @Published var errorMessage: String?
    @Published private(set) var lastAction = ""
    @Published private(set) var demoResult: String?
    @Published private(set) var storageReady = false
    private var store: SecureStore?
    private var timer: AnyCancellable?
    private var sendingID: String?
    private var subscriptions: Set<AnyCancellable> = []
    private let retryOffsets: [TimeInterval] = [0, 10, 25, 45]

    init() {
        do { let created = try SecureStore(); store = created; profile = try created.loadProfile(); snapshot = try created.load(); storageReady = true }
        catch { errorMessage = "Protected storage could not be opened. Data was preserved. \(error.localizedDescription)" }
        radio.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &subscriptions)
        location.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &subscriptions)
        radio.onFrame = { [weak self] in self?.receive($0) }
        radio.onReady = { [weak self] in self?.ensureMessagingCapability(retryUnconfirmed: true); self?.pump() }
        timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] _ in self?.pump() }
        UIDevice.current.isBatteryMonitoringEnabled = true
    }
    var draft: RequestDraft { snapshot.draft }
    // Controls and replies share the durable transport but never become emergency reports.
    var outbox: [OutboxItem] { snapshot.reports.sorted { $0.createdAt > $1.createdAt } }
    var unansweredHubQuestionCount: Int { snapshot.hubQuestions.filter { snapshot.needsReply($0) }.count }
    var unreadHubReportID: String? { snapshot.hubQuestions.first { $0.seenAt == nil && snapshot.needsReply($0) }?.reportID }
    var unreadHubQuestionCount: Int { snapshot.hubQuestions.filter { $0.seenAt == nil && snapshot.needsReply($0) }.count }
    var messagingReady: Bool { profile.map { snapshot.messagingAcknowledgedProfiles.contains($0.messagingIdentity) } ?? false }
    var messagingStatus: String {
        if profile == nil { return "Install a phone profile first" }
        if messagingReady { return "Hub messages ready" }
        if let item = snapshot.outbox.last(where: { $0.kind == .capability && $0.profileIdentity == profile?.messagingIdentity }) {
            return item.status == .unconfirmed ? "Messaging setup unconfirmed" : "Waiting for the hub to enable messages"
        }
        return "Connect a companion to enable hub messages"
    }
    func questions(for reportID: String) -> [HubQuestion] { snapshot.questions(for: reportID) }
    func reply(to question: HubQuestion) -> OutboxItem? { snapshot.reply(to: question) }
    func needsReply(for reportID: String) -> Bool { questions(for: reportID).contains { snapshot.needsReply($0) } }
    func updateDraft(_ update: (inout RequestDraft) -> Void) {
        update(&snapshot.draft); persist()
    }
    @discardableResult private func persist() -> Bool {
        guard let store, storageReady else { errorMessage = "Protected storage unavailable. Request was not submitted."; return false }
        do { try store.save(snapshot); return true }
        catch { storageReady = false; errorMessage = "Could not save encrypted outbox. Nothing new will be sent. \(error.localizedDescription)"; return false }
    }
    func importProfile(_ json: String) {
        do {
            guard json.utf8.count <= 4096 else { throw MeshError.invalid("Profile file is too large.") }
            let candidate = try JSONDecoder().decode(ProvisioningProfile.self, from: Data(json.utf8)); try candidate.validate()
            guard profile == nil || profile == candidate || (snapshot.outbox.allSatisfy { $0.kind == .capability } && snapshot.hubQuestions.isEmpty) else {
                throw MeshError.invalid("Existing requests belong to a different profile. Save their status, then clear local history before changing profiles.")
            }
            guard let store, storageReady else { throw MeshError.invalid("Protected storage unavailable.") }
            try store.saveProfile(candidate)
            if profile != candidate { snapshot.receiptDigests = [:]; snapshot.hubQuestions = []; snapshot.messagingAcknowledgedProfiles = []; snapshot.outbox.removeAll { $0.kind == .capability } }
            profile = candidate; guard persist() else { return }; lastAction = "Private phone profile stored in Keychain."
            ensureMessagingCapability()
        } catch { errorMessage = "Could not import profile. \(error.localizedDescription)" }
    }
    @discardableResult func queueRequest() -> String? {
        do {
            guard storageReady, let profile, let store else { throw MeshError.invalid("Import your private phone profile in Setup first.") }
            guard snapshot.reports.count < 200, snapshot.outbox.count < 512 else { throw MeshError.invalid("Local history is full. Clear report history after recording any needed statuses.") }
            guard !FollowupWire.isReservedRequestNote(draft.note) else { throw MeshError.invalid("Please reword the start of your note before sending this report.") }
            // Snapshot the freshest already available fix now. GPS never delays an urgent request;
            // once sealed, retries keep this exact location and encrypted frame.
            let date = Date(); let fix = location.currentFix(at: date)
            let battery = UIDevice.current.batteryLevel
            let percentage: UInt8 = battery >= 0 ? UInt8(max(0, min(100, (battery * 100).rounded()))) : 255
            let plaintext = try WireCodec.requestPlaintext(draft: draft, location: fix, battery: percentage, createdAt: date)
            let sequence = try store.reserveSequence(for: profile)
            let frame = try WireCodec.seal(type: 1, plaintext: plaintext, profile: profile, sequence: sequence)
            let item = OutboxItem(origin: profile.origin, sequence: sequence, createdAt: date, draft: draft, location: fix, frame: frame)
            snapshot.outbox.append(item)
            guard persist() else { return nil }
            lastAction = "Request queued on this phone. Hub delivery is not confirmed."
            pump()
            return item.id
        } catch { errorMessage = error.localizedDescription; return nil }
    }
    @discardableResult func queueReply(questionID: String, text: String) -> String? {
        do {
            guard storageReady, let profile, let store else { throw MeshError.invalid("Import your private phone profile first.") }
            guard let q = snapshot.hubQuestions.firstIndex(where: { $0.id == questionID }),
                  let report = snapshot.outbox.first(where: { $0.id == snapshot.hubQuestions[q].reportID && $0.kind == .report && $0.origin == profile.origin }) else { throw MeshError.invalid("The original request for this question is unavailable.") }
            guard snapshot.hubQuestions[q].replyOutboxID == nil else { throw MeshError.invalid("A reply is already saved. Retry that saved reply if delivery is unconfirmed.") }
            guard snapshot.outbox.count < 512 else { throw MeshError.invalid("Local message history is full.") }
            let question = snapshot.hubQuestions[q]
            let replyDraft = try FollowupWire.replyDraft(original: report.draft, reportSequence: report.sequence, questionID: question.questionID, text: text)
            let date = Date(), fix = location.currentFix(at: date)
            let battery = UIDevice.current.batteryLevel
            let percentage: UInt8 = battery >= 0 ? UInt8(max(0, min(100, (battery * 100).rounded()))) : 255
            let plain = try WireCodec.requestPlaintext(draft: replyDraft, location: fix, battery: percentage, createdAt: date)
            let sequence = try store.reserveSequence(for: profile)
            let frame = try WireCodec.seal(type: 1, plaintext: plain, profile: profile, sequence: sequence)
            var item = OutboxItem(origin: profile.origin, sequence: sequence, createdAt: date, draft: replyDraft, location: fix, frame: frame)
            item.kind = .reply; item.reportID = report.id; item.questionID = question.questionID
            snapshot.outbox.append(item); snapshot.hubQuestions[q].replyOutboxID = item.id; snapshot.hubQuestions[q].seenAt = date
            guard persist() else { return nil }
            lastAction = "Reply saved on this phone. A hub receipt confirms its delivery."; pump(); return item.id
        } catch { errorMessage = error.localizedDescription; return nil }
    }
    func markHubQuestionsSeen(for reportID: String) {
        var changed = false
        for index in snapshot.hubQuestions.indices where snapshot.hubQuestions[index].reportID == reportID && snapshot.hubQuestions[index].seenAt == nil {
            snapshot.hubQuestions[index].seenAt = Date(); changed = true
        }
        if changed { persist() }
    }
    func retryMessagingSetup() { ensureMessagingCapability(retryUnconfirmed: true); pump() }
    private func ensureMessagingCapability(retryUnconfirmed: Bool = false) {
        guard storageReady, radio.ready, let profile, let store, !messagingReady else { return }
        if let index = snapshot.outbox.firstIndex(where: { $0.kind == .capability && $0.profileIdentity == profile.messagingIdentity }) {
            if retryUnconfirmed && snapshot.outbox[index].status == .unconfirmed { retry(snapshot.outbox[index].id) }
            return
        }
        do {
            guard snapshot.outbox.count < 512 else { return }
            let date = Date()
            let control = RequestDraft(category: .other, severity: .assistance, note: FollowupWire.capabilityNote)
            let plain = try WireCodec.requestPlaintext(draft: control, location: nil, battery: 255, createdAt: date)
            let sequence = try store.reserveSequence(for: profile)
            let frame = try WireCodec.seal(type: 1, plaintext: plain, profile: profile, sequence: sequence)
            var item = OutboxItem(origin: profile.origin, sequence: sequence, createdAt: date, draft: control, location: nil, frame: frame)
            item.kind = .capability; item.profileIdentity = profile.messagingIdentity
            snapshot.outbox.append(item); _ = persist()
        } catch { errorMessage = "Could not save hub messaging setup. \(error.localizedDescription)" }
    }
    func retry(_ id: String) {
        guard let i = snapshot.outbox.firstIndex(where: { $0.id == id }), !snapshot.outbox[i].status.confirmed else { return }
        guard sendingID != id else { return }
        snapshot.outbox[i].firstAttemptAt = nil; snapshot.outbox[i].attemptCount = 0; snapshot.outbox[i].lastAttemptAt = nil
        snapshot.outbox[i].status = .queued; snapshot.outbox[i].lastError = nil
        if persist() { pump() }
    }
    func pump() {
        guard storageReady else { return }
        let now = Date(); var changed = false
        for i in snapshot.outbox.indices {
            guard !snapshot.outbox[i].status.confirmed, let first = snapshot.outbox[i].firstAttemptAt else { continue }
            if snapshot.outbox[i].attemptCount >= retryOffsets.count && now.timeIntervalSince(first) >= 55 && sendingID != snapshot.outbox[i].id {
                if snapshot.outbox[i].status != .unconfirmed { snapshot.outbox[i].status = .unconfirmed; changed = true }
            }
        }
        if changed && !persist() { return }
        guard radio.ready, !radio.busy, sendingID == nil else { return }
        // An already queued report/reply always goes before a setup control.
        guard let index = snapshot.nextTransportIndex(at: now, retryOffsets: retryOffsets) else { return }
        let id = snapshot.outbox[index].id; let frame = snapshot.outbox[index].frame
        if snapshot.outbox[index].firstAttemptAt == nil { snapshot.outbox[index].firstAttemptAt = now }
        snapshot.outbox[index].attemptCount += 1; snapshot.outbox[index].lastAttemptAt = now
        // Reserve this attempt durably before sending; restart never silently creates a new frame/nonce.
        guard persist() else { return }; sendingID = id
        radio.send(frame) { [weak self] result in
            guard let self else { return }; self.sendingID = nil
            guard let i = self.snapshot.outbox.firstIndex(where: { $0.id == id }) else { return }
            switch result {
            case .success:
                if !self.snapshot.outbox[i].status.confirmed { self.snapshot.outbox[i].status = .submitted }
                self.snapshot.outbox[i].lastError = nil
            case .failure(let error): self.snapshot.outbox[i].lastError = error.localizedDescription
            }
            self.persist()
        }
    }
    private func receive(_ frame: Data) {
        guard storageReady, let profile else { return }
        do {
            let receipt = try WireCodec.receipt(frame, profile: profile)
            guard receipt.requestOrigin == profile.origin else { return }
            var canonical = frame; canonical[14] = 0
            let digest = SHA256.hash(data: canonical).map { String(format: "%02x", $0) }.joined()
            let result = try snapshot.applyReceipt(receipt, digest: digest, at: Date())
            guard result != .unrelated else { return }
            _ = persist()
        } catch { /* Unauthenticated, malformed, unrelated or stale-region input cannot confirm delivery. */ }
    }
    func clearLocalData() {
        radio.disconnect(); sendingID = nil
        do {
            guard let store else { throw MeshError.invalid("Protected storage unavailable.") }
            try store.clear(); snapshot = AppSnapshot(); profile = nil; storageReady = true
            guard persist() else { return }; lastAction = "Local requests, draft and phone profile removed."; demoResult = nil
        } catch { errorMessage = error.localizedDescription }
    }
    func runCodecDemo() {
        do {
            // Public, synthetic self-test. It never writes to BLE or changes real outbox states.
            let key = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
            let testProfile = ProvisioningProfile(region: 1, keyId: 1, keyHex: key, origin: 0x01020304)
            let date = Date(timeIntervalSince1970: 1794000000)
            let draft = RequestDraft(category: .medical, severity: .urgent, people: 2, note: "Test request")
            let fix = LocationFix(latitude: 32.9858, longitude: -96.7501, accuracy: 12, capturedAt: date)
            let plain = try WireCodec.requestPlaintext(draft: draft, location: fix, battery: 77, createdAt: date)
            let frame = try WireCodec.seal(type: 1, plaintext: plain, profile: testProfile, sequence: 42, nonce: Data(hex: "000102030405060708090a0b"))
            let chunks = try BLEFraming.chunks(frame: frame, transferID: 1); var assembler = BLEReassembler(); var complete: Data?
            for chunk in chunks { complete = try assembler.accept(chunk) }
            guard let complete, try WireCodec.open(complete, profile: testProfile, expectedType: 1) == plain else { throw MeshError.invalid("Self-test mismatch.") }
            demoResult = "SIMULATION ONLY: \(frame.count)-byte encrypted request split into \(chunks.count) BLE chunks and decoded locally. No radio, hub or emergency service contacted."
        } catch { demoResult = "Simulation self-test failed: \(error.localizedDescription)" }
    }
}
