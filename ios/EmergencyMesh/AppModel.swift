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
        radio.onReady = { [weak self] in self?.pump() }
        timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] _ in self?.pump() }
        UIDevice.current.isBatteryMonitoringEnabled = true
    }
    var draft: RequestDraft { snapshot.draft }
    var outbox: [OutboxItem] { snapshot.outbox.sorted { $0.createdAt > $1.createdAt } }
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
            guard profile == nil || profile == candidate || snapshot.outbox.isEmpty else {
                throw MeshError.invalid("Existing requests belong to a different profile. Save their status, then clear local history before changing profiles.")
            }
            guard let store, storageReady else { throw MeshError.invalid("Protected storage unavailable.") }
            try store.saveProfile(candidate)
            if profile != candidate { snapshot.receiptDigests = [:] }
            profile = candidate; guard persist() else { return }; lastAction = "Private phone profile stored in Keychain."
        } catch { errorMessage = "Could not import profile. \(error.localizedDescription)" }
    }
    @discardableResult func queueRequest() -> String? {
        do {
            guard storageReady, let profile, let store else { throw MeshError.invalid("Import your private phone profile in Setup first.") }
            guard snapshot.outbox.count < 200 else { throw MeshError.invalid("Local history is full (200 requests). Clear history after recording any needed statuses.") }
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
        guard radio.ready, !radio.busy, sendingID == nil,
              let index = snapshot.outbox.firstIndex(where: { item in
                  guard !item.status.confirmed, item.status != .unconfirmed, item.attemptCount < retryOffsets.count else { return false }
                  guard let first = item.firstAttemptAt else { return true }
                  let lastGap = item.lastAttemptAt.map { now.timeIntervalSince($0) } ?? .infinity
                  return now.timeIntervalSince(first) >= retryOffsets[item.attemptCount] && lastGap >= 8
              }) else { return }
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
            guard receipt.requestOrigin == profile.origin,
                  let i = snapshot.outbox.firstIndex(where: { $0.origin == receipt.requestOrigin && $0.sequence == receipt.requestSequence }) else { return }
            var canonical = frame; canonical[14] = 0
            let digest = SHA256.hash(data: canonical).map { String(format: "%02x", $0) }.joined()
            let receiptID = "\(receipt.hubOrigin)-\(receipt.hubSequence)"
            if let old = snapshot.receiptDigests[receiptID], old != digest { return }
            if snapshot.receiptDigests.count >= 1024 && snapshot.receiptDigests[receiptID] == nil { return }
            snapshot.receiptDigests[receiptID] = digest
            if receipt.status == 1 && snapshot.outbox[i].status == .operatorReviewed {
                persist(); return // Delayed hub ACK must not replace the operator's text or timestamp.
            }
            if receipt.status == 2 { snapshot.outbox[i].status = .operatorReviewed }
            else if snapshot.outbox[i].status != .operatorReviewed { snapshot.outbox[i].status = .hubReceived }
            snapshot.outbox[i].receiptText = receipt.text; snapshot.outbox[i].receiptAt = Date(); snapshot.outbox[i].lastError = nil
            persist()
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
