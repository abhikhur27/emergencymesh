import Foundation
import CryptoKit
import Security

enum KeychainStore {
    static let service = "org.hackutd.emergencymesh"
    static func get(_ account: String) throws -> Data? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?; let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw MeshError.invalid("Cannot read protected storage (\(status)). Unlock the phone and retry.") }
        return data
    }
    static func put(_ data: Data, account: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let result = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if result == errSecItemNotFound {
            var addition = query; for (key, value) in attributes { addition[key] = value }
            let status = SecItemAdd(addition as CFDictionary, nil)
            guard status == errSecSuccess else { throw MeshError.invalid("Cannot save protected storage (\(status)).") }
        } else if result != errSecSuccess { throw MeshError.invalid("Cannot update protected storage (\(result)).") }
    }
    static func delete(_ account: String) throws {
        let status = SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw MeshError.invalid("Cannot remove protected storage (\(status)).") }
    }
}

final class SecureStore {
    private let url: URL
    init() throws {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("EmergencyMesh", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var directoryURL = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try directoryURL.setResourceValues(values)
        url = directory.appendingPathComponent("outbox.aesgcm")
    }
    func loadProfile() throws -> ProvisioningProfile? {
        guard let data = try KeychainStore.get("regional-profile-v1") else { return nil }
        let profile = try JSONDecoder().decode(ProvisioningProfile.self, from: data); try profile.validate(); return profile
    }
    func saveProfile(_ profile: ProvisioningProfile) throws {
        try profile.validate(); try KeychainStore.put(JSONEncoder().encode(profile), account: "regional-profile-v1")
    }
    func reserveSequence(for profile: ProvisioningProfile) throws -> UInt32 {
        // Hub identity excludes keyId; changing a key must not reset this phone's sequence.
        let account = "sequence-v1-r\(profile.region)-o\(profile.origin)"
        return try SequenceCounter.reserve(read: { try KeychainStore.get(account) }, write: { try KeychainStore.put($0, account: account) })
    }
    private func localKey() throws -> SymmetricKey {
        if let data = try KeychainStore.get("outbox-key-v1") {
            guard data.count == 32 else { throw MeshError.invalid("Invalid local storage key.") }; return SymmetricKey(data: data)
        }
        guard !FileManager.default.fileExists(atPath: url.path) else { throw MeshError.invalid("Outbox encryption key is missing. Existing data was preserved.") }
        let key = SymmetricKey(size: .bits256)
        let data = key.withUnsafeBytes { Data($0) }; try KeychainStore.put(data, account: "outbox-key-v1"); return key
    }
    func load() throws -> AppSnapshot {
        guard FileManager.default.fileExists(atPath: url.path) else { return AppSnapshot() }
        let bytes = try Data(contentsOf: url)
        guard bytes.count <= 2_000_000 else { throw MeshError.invalid("Outbox exceeds local storage limit.") }
        let opened = try AES.GCM.open(AES.GCM.SealedBox(combined: bytes), using: localKey())
        return try JSONDecoder().decode(AppSnapshot.self, from: opened)
    }
    func save(_ snapshot: AppSnapshot) throws {
        let data = try JSONEncoder().encode(snapshot)
        guard let combined = try AES.GCM.seal(data, using: localKey()).combined else { throw MeshError.invalid("Cannot encrypt local outbox.") }
        try combined.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func clear() throws {
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        try KeychainStore.delete("regional-profile-v1"); try KeychainStore.delete("outbox-key-v1")
        // Deliberately retain nonsecret sequence-v1 identity counters to prevent replay-ID reuse.
    }
}
