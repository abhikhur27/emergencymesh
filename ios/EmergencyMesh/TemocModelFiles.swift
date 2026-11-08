import Foundation
import CryptoKit

enum TemocModelFiles {
    static let filename = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    static let expectedBytes: Int64 = 1_117_320_736
    static let sha256 = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
    static let revision = "91cad51170dc346986eccefdc2dd33a9da36ead9"
    static let downloadURL = URL(string: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf")!
    static let description = "Qwen2.5 1.5B · 4-bit · 1.12 GB"

    static func directory() throws -> URL {
        var folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("TemocModels", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
        return folder
    }
    static func candidate() throws -> URL? {
        let installed = try directory().appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: installed.path) { return installed }
        let stem = String(filename.dropLast(5))
        return Bundle.main.url(forResource: stem, withExtension: "gguf", subdirectory: "TemocModel")
            ?? Bundle.main.url(forResource: stem, withExtension: "gguf", subdirectory: "Models")
            ?? Bundle.main.url(forResource: stem, withExtension: "gguf")
    }
    static func verify(_ url: URL) throws -> URL {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              Int64(values.fileSize ?? 0) == expectedBytes else { throw MeshError.invalid("This is not the expected 1.12 GB Qwen model. The selected file was not installed.") }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            try Task.checkCancellation(); hash.update(data: data)
        }
        let actual = hash.finalize().map { String(format: "%02x", $0) }.joined()
        guard actual == sha256 else { throw MeshError.invalid("The model checksum does not match the pinned official file. It was not loaded.") }
        return url
    }
    static func install(_ source: URL) throws -> URL {
        let folder = try directory(), temporary = folder.appendingPathComponent("import-\(UUID().uuidString).gguf")
        let destination = folder.appendingPathComponent(filename)
        defer { if FileManager.default.fileExists(atPath: temporary.path) { try? FileManager.default.removeItem(at: temporary) } }
        let values = try source.resourceValues(forKeys: [.fileSizeKey])
        guard Int64(values.fileSize ?? 0) == expectedBytes else { throw MeshError.invalid("Choose the pinned Qwen 1.5B Q4_K_M model file (1.12 GB).") }
        try FileManager.default.copyItem(at: source, to: temporary)
        _ = try verify(temporary)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else { try FileManager.default.moveItem(at: temporary, to: destination) }
        return destination
    }
}

final class TemocDownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let progress: @Sendable (Double) -> Void
    init(progress: @escaping @Sendable (Double) -> Void) { self.progress = progress }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : TemocModelFiles.expectedBytes
        progress(min(1, max(0, Double(totalBytesWritten) / Double(total))))
    }
}
