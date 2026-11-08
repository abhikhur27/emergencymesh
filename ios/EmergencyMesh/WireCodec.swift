import Foundation
import CryptoKit

enum WireCodec {
    static let maxFrame = 220

    static func requestPlaintext(draft: RequestDraft, location: LocationFix?, battery: UInt8, createdAt: Date) throws -> Data {
        guard (1...255).contains(draft.people), draft.note.utf8.count <= 120,
              battery <= 100 || battery == 255 else { throw MeshError.invalid("Check people, battery and the 120-byte note limit.") }
        let seconds = createdAt.timeIntervalSince1970
        guard seconds >= 0, seconds <= Double(UInt32.max) else { throw MeshError.invalid("Phone date is outside the protocol range.") }
        let fix = location.flatMap { $0.isUsable(at: createdAt) ? $0 : nil }
        var flags: UInt8 = fix == nil ? 0 : 1
        if draft.breathingConcern { flags |= 2 }; if draft.trapped { flags |= 4 }; if draft.severeBleeding { flags |= 8 }
        for supply in draft.supplies { flags |= supply.rawValue }
        var data = Data([draft.category.rawValue, draft.severity.rawValue, UInt8(draft.people), flags])
        data.appendLE(UInt32(seconds))
        data.appendLE(Int32(((fix?.latitude ?? 0) * 100_000).rounded()))
        data.appendLE(Int32(((fix?.longitude ?? 0) * 100_000).rounded()))
        data.appendLE(fix.map { UInt16(min(65534, ceil($0.accuracy))) } ?? UInt16.max)
        data.append(battery); data.append(UInt8(draft.note.utf8.count)); data.append(contentsOf: draft.note.utf8)
        return data
    }

    static func seal(type: UInt8, plaintext: Data, profile: ProvisioningProfile, sequence: UInt32,
                     hops: UInt8 = 3, nonce: Data? = nil) throws -> Data {
        try profile.validate()
        guard type == 1 || type == 2, hops <= 4, sequence > 0 else { throw MeshError.invalid("Invalid envelope metadata.") }
        var header = Data([0x45, 0x4d, 1, type]); header.appendLE(profile.region)
        header.appendLE(profile.origin); header.appendLE(sequence); header.append(hops); header.append(profile.keyId)
        let iv: AES.GCM.Nonce
        if let nonce { iv = try AES.GCM.Nonce(data: nonce) } else { iv = AES.GCM.Nonce() }
        let sealed = try AES.GCM.seal(plaintext, using: SymmetricKey(data: profile.keyData), nonce: iv, authenticating: aad(header))
        var frame = header; frame.append(contentsOf: sealed.nonce); frame.append(sealed.ciphertext); frame.append(sealed.tag)
        guard frame.count <= maxFrame else { throw MeshError.invalid("Packet exceeds radio frame limit.") }
        return frame
    }

    static func open(_ frame: Data, profile: ProvisioningProfile, expectedType: UInt8) throws -> Data {
        try profile.validate()
        guard (44...maxFrame).contains(frame.count), frame[0] == 0x45, frame[1] == 0x4d,
              frame[2] == 1, frame[3] == expectedType, frame[14] <= 4,
              try frame.readLE(UInt16.self, at: 4) == profile.region, frame[15] == profile.keyId,
              try frame.readLE(UInt32.self, at: 6) > 0, try frame.readLE(UInt32.self, at: 10) > 0
        else { throw MeshError.invalid("Packet header does not match this region or protocol.") }
        let nonce = try AES.GCM.Nonce(data: frame.subdata(in: 16..<28))
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: frame.subdata(in: 28..<(frame.count - 16)), tag: frame.suffix(16))
        return try AES.GCM.open(box, using: SymmetricKey(data: profile.keyData), authenticating: aad(frame.prefix(16)))
    }

    static func receipt(_ frame: Data, profile: ProvisioningProfile) throws -> AuthenticatedReceipt {
        let p = try open(frame, profile: profile, expectedType: 2)
        guard p.count >= 10, p[8] == 1 || p[8] == 2, p[9] <= 80, p.count == 10 + Int(p[9]),
              let text = String(data: p.dropFirst(10), encoding: .utf8) else { throw MeshError.invalid("Invalid receipt payload.") }
        let requestOrigin = try p.readLE(UInt32.self, at: 0)
        let requestSequence = try p.readLE(UInt32.self, at: 4)
        guard requestOrigin == profile.origin, requestSequence > 0 else { throw MeshError.invalid("Receipt is not for this phone’s request identity.") }
        return AuthenticatedReceipt(hubOrigin: try frame.readLE(UInt32.self, at: 6), hubSequence: try frame.readLE(UInt32.self, at: 10),
                                    requestOrigin: requestOrigin, requestSequence: requestSequence, status: p[8], text: text)
    }

    private static func aad(_ header: Data) -> Data {
        var result = Data(header.prefix(14)); result.append(header[header.startIndex + 15]); return result
    }
}

/// Reserved text extensions inside the unchanged authenticated v1 request/receipt envelopes.
enum FollowupWire {
    static let capabilityNote = "RMC1|Q1"
    static let capabilityAcknowledgment = "RMC1|Q1|OK"
    static let questionLimit = 66
    static let answerLimit = 97
    private static let trimSet = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
    struct Question: Equatable { let id: String; let text: String }
    static func trimmed(_ value: String) -> String { value.trimmingCharacters(in: trimSet) }
    static func isReservedRequestNote(_ value: String) -> Bool {
        value.hasPrefix("RMC1|") || value.hasPrefix("RMR1|") || value.hasPrefix("RMQ1|")
    }
    static func canonicalText(_ value: String, limit: Int) throws -> String {
        guard value == trimmed(value), !value.isEmpty, value.utf8.count <= limit,
              !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
            throw MeshError.invalid("Use one short line, up to \(limit) UTF-8 bytes, without extra outer spaces.")
        }
        return value
    }
    static func validID(_ value: String) -> Bool {
        value.utf8.count == 8 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } && UInt32(value, radix: 16) != 0
    }
    static func question(from text: String) throws -> Question? {
        guard text.hasPrefix("RMQ1|") else { return nil }
        let parts = text.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, validID(parts[1]) else { throw MeshError.invalid("Invalid hub question identity.") }
        return Question(id: parts[1], text: try canonicalText(parts[2], limit: questionLimit))
    }
    static func questionText(id: String, text: String) throws -> String {
        guard validID(id) else { throw MeshError.invalid("Invalid hub question identity.") }
        return "RMQ1|\(id)|\(try canonicalText(trimmed(text), limit: questionLimit))"
    }
    static func answerNote(reportSequence: UInt32, questionID: String, text: String) throws -> String {
        guard reportSequence > 0, validID(questionID) else { throw MeshError.invalid("Invalid reply identity.") }
        let answer = try canonicalText(trimmed(text), limit: answerLimit)
        return "RMR1|\(String(format: "%08x", reportSequence))|\(questionID)|\(answer)"
    }
    static func answerText(from note: String) -> String? {
        let parts = note.split(separator: "|", maxSplits: 3, omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4, parts[0] == "RMR1", validID(parts[1]), validID(parts[2]),
              (try? canonicalText(parts[3], limit: answerLimit)) != nil else { return nil }
        return parts[3]
    }
    static func replyDraft(original: RequestDraft, reportSequence: UInt32, questionID: String, text: String) throws -> RequestDraft {
        RequestDraft(category: original.category, severity: original.severity, people: original.people,
                     note: try answerNote(reportSequence: reportSequence, questionID: questionID, text: text))
    }
}

enum BLEFraming {
    static func chunks(frame: Data, transferID: UInt8) throws -> [Data] {
        guard (44...WireCodec.maxFrame).contains(frame.count) else { throw MeshError.invalid("Invalid radio frame size.") }
        let count = (frame.count + 15) / 16
        return (0..<count).map { index in
            var value = Data([0xe1, transferID, UInt8(index), UInt8(count)])
            value.append(frame.subdata(in: (index * 16)..<min(frame.count, (index + 1) * 16))); return value
        }
    }
}

struct BLEReassembler {
    private var transfer: UInt8?
    private var count = 0
    private var parts: [Int: Data] = [:]
    private var startedAt: Date = .distantPast
    mutating func reset() { transfer = nil; count = 0; parts = [:]; startedAt = .distantPast }
    mutating func accept(_ value: Data, at now: Date = Date()) throws -> Data? {
        guard (5...20).contains(value.count), value[0] == 0xe1, (1...14).contains(value[3]), value[2] < value[3],
              value[2] == value[3] - 1 || value.count == 20 else { reset(); throw MeshError.invalid("Malformed BLE fragment.") }
        if now.timeIntervalSince(startedAt) > 5 { reset() }
        if transfer != value[1] { reset(); transfer = value[1]; count = Int(value[3]); startedAt = now }
        guard count == Int(value[3]) else { reset(); throw MeshError.invalid("Conflicting BLE fragment count.") }
        let index = Int(value[2]); let payload = Data(value.dropFirst(4))
        if let existing = parts[index], existing != payload { reset(); throw MeshError.invalid("Conflicting BLE fragment.") }
        parts[index] = payload
        guard parts.values.reduce(0, { $0 + $1.count }) <= WireCodec.maxFrame else { reset(); throw MeshError.invalid("Oversized BLE transfer.") }
        guard parts.count == count else { return nil }
        var frame = Data(); for i in 0..<count { guard let piece = parts[i] else { return nil }; frame.append(piece) }
        reset(); guard frame.count >= 44 else { throw MeshError.invalid("Truncated BLE frame.") }; return frame
    }
}
