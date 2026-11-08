import Foundation
import CryptoKit
import Security

enum TemocRole: String, Codable { case user, assistant }
enum TemocMessageState: String, Codable { case complete, generating, interrupted }
struct TemocMessage: Identifiable, Codable {
    let id: UUID
    let role: TemocRole
    var text: String
    let createdAt: Date
    var state: TemocMessageState
    var guideID: String?
    init(role: TemocRole, text: String, state: TemocMessageState = .complete, guideID: String? = nil) {
        id = UUID(); self.role = role; self.text = text; createdAt = Date(); self.state = state; self.guideID = guideID
    }
}
struct TemocConversation: Identifiable, Codable {
    let id: UUID
    let createdAt: Date
    var updatedAt: Date
    var messages: [TemocMessage]
    init() { id = UUID(); createdAt = Date(); updatedAt = createdAt; messages = [] }
    var title: String { messages.first(where: { $0.role == .user }).map { String($0.text.prefix(44)) } ?? "New chat" }
}
struct TemocArchive: Codable {
    var version = 1
    var selectedID: UUID?
    var chats: [TemocConversation] = []
    func validate() throws {
        guard version == 1, chats.count <= 20, Set(chats.map(\.id)).count == chats.count,
              selectedID == nil || chats.contains(where: { $0.id == selectedID }) else { throw MeshError.invalid("Invalid Temoc history. Existing data was preserved.") }
        for chat in chats {
            guard chat.messages.count <= 80, Set(chat.messages.map(\.id)).count == chat.messages.count,
                  chat.messages.allSatisfy({ $0.text.utf8.count <= 16_000 }) else { throw MeshError.invalid("Temoc chat exceeds its local storage limits.") }
        }
    }
}

/// Separate key/service and file from the phone's reporting identity/outbox.
final class TemocHistoryStore {
    private let file: URL
    private let service = "org.rescuemesh.temoc.local-history"
    init() throws {
        var folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("Temoc", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
        file = folder.appendingPathComponent("chats.aesgcm")
    }
    private func key() throws -> SymmetricKey {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "chat-key-v1"]
        var read = query; read[kSecReturnData as String] = true; read[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?; let status = SecItemCopyMatching(read as CFDictionary, &value)
        if status == errSecSuccess, let data = value as? Data, data.count == 32 { return SymmetricKey(data: data) }
        guard status == errSecItemNotFound else { throw MeshError.invalid("Temoc's protected storage is unavailable. Unlock the phone and retry.") }
        guard !FileManager.default.fileExists(atPath: file.path) else { throw MeshError.invalid("Temoc's history key is missing. Existing encrypted chats were preserved.") }
        let secret = SymmetricKey(size: .bits256)
        var addition = query; addition[kSecValueData as String] = secret.withUnsafeBytes { Data($0) }
        addition[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw MeshError.invalid("Temoc could not save its local encryption key.") }
        return secret
    }
    func load() throws -> TemocArchive {
        guard FileManager.default.fileExists(atPath: file.path) else { return TemocArchive() }
        let data = try Data(contentsOf: file)
        guard data.count <= 8_000_000 else { throw MeshError.invalid("Temoc history is too large. Existing data was preserved.") }
        let opened = try AES.GCM.open(AES.GCM.SealedBox(combined: data), using: key())
        var archive = try JSONDecoder().decode(TemocArchive.self, from: opened)
        try archive.validate()
        for c in archive.chats.indices { for m in archive.chats[c].messages.indices where archive.chats[c].messages[m].state == .generating { archive.chats[c].messages[m].state = .interrupted } }
        return archive
    }
    func save(_ archive: TemocArchive) throws {
        try archive.validate()
        let data = try JSONEncoder().encode(archive)
        guard data.count <= 8_000_000, let sealed = try AES.GCM.seal(data, using: key()).combined else { throw MeshError.invalid("Temoc's local history is full. Delete an older chat to continue.") }
        try sealed.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
