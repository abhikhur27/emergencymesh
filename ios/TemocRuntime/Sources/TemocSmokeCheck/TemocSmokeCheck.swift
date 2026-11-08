import Foundation
import CryptoKit
import TemocRuntime

enum SmokeFailure: Error { case expectedModelArgument, invalidPinnedModel, emptyNativeReply }

@main
struct TemocSmokeCheck {
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw SmokeFailure.expectedModelArgument }
        let file = URL(fileURLWithPath: CommandLine.arguments[1])
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize
        guard size == 1_117_320_736 else { throw SmokeFailure.invalidPinnedModel }
        let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
        var hash = SHA256()
        while let bytes = try handle.read(upToCount: 1_048_576), !bytes.isEmpty { hash.update(data: bytes) }
        let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
        guard digest == "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e" else { throw SmokeFailure.invalidPinnedModel }
        let engine = TemocEngine(), started = Date()
        do {
            let response = try await engine.reply(modelPath: file.path,
                systemPrompt: "You are Temoc, a calm offline preparedness assistant. Give a short practical general answer. You cannot contact anyone. Do not give medical advice or claim live information.",
                turns: [TemocTurn(role: .user, text: "A storm is forecast tomorrow. Name two simple things I can pack now.")],
                maximumTokens: 32, onText: { _ in })
            await engine.unload()
            guard response.count >= 5 else { throw SmokeFailure.emptyNativeReply }
            let receipt: [String: Any] = ["nativeGeneration": true, "platform": "macOS acceptance runner, not iPhone",
                "model": "Qwen2.5-1.5B-Instruct-Q4_K_M", "modelSha256": digest,
                "contextTokens": TemocEngine.contextTokens, "maximumReplyTokens": 32,
                "replyCharacters": response.count, "elapsedMs": Int(Date().timeIntervalSince(started) * 1000),
                "reply": response, "radioContacted": false, "chatAPIContacted": false]
            print(String(decoding: try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]), as: UTF8.self))
        } catch { await engine.unload(); throw error }
    }
}
