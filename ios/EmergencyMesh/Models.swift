import Foundation

enum MeshError: LocalizedError {
    case invalid(String)
    var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}

struct ProvisioningProfile: Codable, Equatable {
    let region: UInt16
    let keyId: UInt8
    let keyHex: String
    let origin: UInt32
    var keyData: Data { Data(hex: keyHex) ?? Data() }
    func validate() throws {
        guard region > 0, keyId > 0, origin > 0, keyData.count == 32 else {
            throw MeshError.invalid("Profile needs region, keyId, nonzero origin and a 64-character hexadecimal key.")
        }
    }
}

enum EmergencyCategory: UInt8, Codable, CaseIterable, Identifiable, Hashable {
    case medical = 1, fire, rescue, safety, supplies
    var id: UInt8 { rawValue }
    var title: String { switch self { case .medical: return "Medical"; case .fire: return "Fire"; case .rescue: return "Rescue"; case .safety: return "Safety"; case .supplies: return "Supplies" } }
    var symbol: String { switch self { case .medical: return "cross.case"; case .fire: return "flame"; case .rescue: return "lifepreserver"; case .safety: return "shield"; case .supplies: return "shippingbox" } }
}

enum ReportedSeverity: UInt8, Codable, CaseIterable, Identifiable, Hashable {
    case urgent = 1, serious, assistance
    var id: UInt8 { rawValue }
    var title: String { switch self { case .urgent: return "Urgent"; case .serious: return "Serious"; case .assistance: return "Assistance" } }
}

struct RequestDraft: Codable, Equatable {
    var category: EmergencyCategory = .medical
    var severity: ReportedSeverity = .urgent
    var people = 1
    var breathingConcern = false
    var trapped = false
    var severeBleeding = false
    var note = ""
    var byteCount: Int { note.utf8.count }
}

struct LocationFix: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    let accuracy: Double
    let capturedAt: Date
    func isUsable(at date: Date = Date()) -> Bool {
        latitude.isFinite && longitude.isFinite && accuracy.isFinite &&
        (-90...90).contains(latitude) && (-180...180).contains(longitude) &&
        accuracy >= 0 && accuracy < 65535 && abs(date.timeIntervalSince(capturedAt)) <= 120
    }
}

enum DeliveryStatus: String, Codable {
    case queued, submitted, unconfirmed, hubReceived, operatorReviewed
    var title: String { switch self {
        case .queued: return "Queued on phone"
        case .submitted: return "Submitted to radio device"
        case .unconfirmed: return "Delivery unconfirmed"
        case .hubReceived: return "Hub received"
        case .operatorReviewed: return "Operator reviewed"
    } }
    var confirmed: Bool { self == .hubReceived || self == .operatorReviewed }
}

struct OutboxItem: Codable, Identifiable {
    var id: String { "\(origin)-\(sequence)" }
    let origin: UInt32
    let sequence: UInt32
    let createdAt: Date
    let draft: RequestDraft
    let location: LocationFix?
    let frame: Data
    var status: DeliveryStatus = .queued
    var firstAttemptAt: Date?
    var attemptCount = 0
    var lastAttemptAt: Date?
    var receiptText: String?
    var receiptAt: Date?
    var lastError: String?
}

struct AppSnapshot: Codable {
    var draft = RequestDraft()
    var outbox: [OutboxItem] = []
    var receiptDigests: [String: String] = [:]
}

enum SequenceCounter {
    // The next value must be committed before exposing the reserved value to a sender.
    // Keychain identity counters survive clearing app history and ordinary reinstall.
    static func reserve(read: () throws -> Data?, write: (Data) throws -> Void) throws -> UInt32 {
        let stored = try read()
        if let stored, stored.count != 4 { throw MeshError.invalid("Invalid protected identity counter. Provision a new phone origin.") }
        let current = try stored?.readLE(UInt32.self, at: 0) ?? 1
        guard current > 0, current < UInt32.max else { throw MeshError.invalid("Request counter exhausted. Provision a new phone origin.") }
        var next = Data(); next.appendLE(current + 1); try write(next)
        return current
    }
}

struct AuthenticatedReceipt {
    let hubOrigin: UInt32
    let hubSequence: UInt32
    let requestOrigin: UInt32
    let requestSequence: UInt32
    let status: UInt8
    let text: String
}

extension Data {
    init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var bytes = [UInt8](); bytes.reserveCapacity(hex.count / 2)
        var i = hex.startIndex
        while i < hex.endIndex {
            let end = hex.index(i, offsetBy: 2)
            guard let byte = UInt8(hex[i..<end], radix: 16) else { return nil }
            bytes.append(byte); i = end
        }
        self.init(bytes)
    }
    var hex: String { map { String(format: "%02x", $0) }.joined() }
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var v = value.littleEndian
        Swift.withUnsafeBytes(of: &v) { append(contentsOf: $0) }
    }
    func readLE<T: FixedWidthInteger>(_ type: T.Type, at offset: Int) throws -> T {
        guard offset >= 0, count >= offset + MemoryLayout<T>.size else { throw MeshError.invalid("Truncated packet.") }
        var result: T = 0
        for n in 0..<MemoryLayout<T>.size { result |= T(self[startIndex + offset + n]) << (n * 8) }
        return result
    }
}
