import Foundation
import llama

public struct TemocTurn: Sendable {
    public enum Role: String, Sendable { case user, assistant }
    public let role: Role
    public let text: String
    public init(role: Role, text: String) { self.role = role; self.text = text }
}

public enum TemocEngineError: LocalizedError {
    case unavailable(String), busy, contextFull
    public var errorDescription: String? {
        switch self {
        case .unavailable(let reason): return reason
        case .busy: return "Temoc is finishing the previous reply. Try again in a moment."
        case .contextFull: return "This message is too long for the offline model. Please shorten it."
        }
    }
}

private final class CancellationGate: @unchecked Sendable {
    private let lock = NSLock()
    private var stopped = false
    func reset() { lock.lock(); stopped = false; lock.unlock() }
    func stop() { lock.lock(); stopped = true; lock.unlock() }
    var isStopped: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
}

private final class BackendLifetime: @unchecked Sendable {
    static let shared = BackendLifetime()
    private init() { llama_backend_init() }
}

/// A single local model slot. It never uses a network or radio connection.
/// C inference stays on this actor's executor; cancellation is independently
/// thread-safe, so Stop/background/memory-pressure do not wait behind decoding.
public actor TemocEngine {
    public static let contextTokens = 2048
    public static let maximumReplyTokens = 320
    private nonisolated let gate = CancellationGate()
    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var loadedPath: String?
    private var generating = false

    public init() {}
    public nonisolated func cancel() { gate.stop() }

    public func unload() {
        if let context { llama_free(context) }
        if let model { llama_model_free(model) }
        context = nil; model = nil; loadedPath = nil
    }

    deinit {
        if let context { llama_free(context) }
        if let model { llama_model_free(model) }
    }

    private func load(path: String) throws {
        if loadedPath == path, model != nil, context != nil { return }
        unload()
        _ = BackendLifetime.shared
        var parameters = llama_model_default_params()
        parameters.use_mmap = true
        parameters.progress_callback = { _, pointer in
            guard let pointer else { return true }
            return !Unmanaged<CancellationGate>.fromOpaque(pointer).takeUnretainedValue().isStopped
        }
        parameters.progress_callback_user_data = Unmanaged.passUnretained(gate).toOpaque()
        #if targetEnvironment(simulator)
        parameters.n_gpu_layers = 0
        #else
        parameters.n_gpu_layers = 99
        #endif
        guard let loadedModel = llama_model_load_from_file(path, parameters) else {
            try checkCancellation()
            throw TemocEngineError.unavailable("The local model could not be opened. Check the model file and available memory.")
        }
        var options = llama_context_default_params()
        options.n_ctx = UInt32(Self.contextTokens)
        options.n_batch = 256
        options.n_ubatch = 128
        options.n_threads = 2
        options.n_threads_batch = 4
        guard let loadedContext = llama_init_from_model(loadedModel, options) else {
            llama_model_free(loadedModel)
            throw TemocEngineError.unavailable("The phone could not allocate Temoc's context. Close other memory-heavy apps and retry.")
        }
        llama_set_abort_callback(loadedContext, { pointer in
            guard let pointer else { return false }
            return Unmanaged<CancellationGate>.fromOpaque(pointer).takeUnretainedValue().isStopped
        }, Unmanaged.passUnretained(gate).toOpaque())
        model = loadedModel; context = loadedContext; loadedPath = path
    }

    public func reply(modelPath: String, systemPrompt: String, turns: [TemocTurn], maximumTokens: Int = 320,
                      onText: @escaping @Sendable (String) -> Void) async throws -> String {
        guard !generating else { throw TemocEngineError.busy }
        generating = true; gate.reset()
        defer { generating = false }
        try Task.checkCancellation()
        try load(path: modelPath)
        guard let model, let context, let vocabulary = llama_model_get_vocab(model) else {
            throw TemocEngineError.unavailable("The model is not ready.")
        }
        defer { llama_kv_self_clear(context) }
        llama_kv_self_clear(context)

        // Keep the system guidance and most recent complete turns. Token counts,
        // rather than a character estimate, bound the actual native context.
        var history = Array(turns.suffix(12))
        var promptTokens: [llama_token] = []
        while !history.isEmpty {
            let prompt = Self.chatML(system: systemPrompt, turns: history)
            promptTokens = try tokenize(prompt, vocabulary: vocabulary)
            if promptTokens.count <= Self.contextTokens - Self.maximumReplyTokens - 16 { break }
            if history.count <= 1 { throw TemocEngineError.contextFull }
            history.removeFirst()
            if history.first?.role == .assistant { history.removeFirst() }
        }
        guard !promptTokens.isEmpty else { throw TemocEngineError.contextFull }
        let sampler = llama_sampler_init_greedy()
        guard let sampler else { throw TemocEngineError.unavailable("The local sampler could not be created.") }
        defer { llama_sampler_free(sampler) }
        for offset in stride(from: 0, to: promptTokens.count, by: 256) {
            try checkCancellation()
            var chunk = Array(promptTokens[offset..<min(promptTokens.count, offset + 256)])
            let status = chunk.withUnsafeMutableBufferPointer { tokens in
                llama_decode(context, llama_batch_get_one(tokens.baseAddress, Int32(tokens.count)))
            }
            if status != 0 { try checkCancellation(); throw TemocEngineError.unavailable("Temoc could not read this context. Try a shorter message or a new chat.") }
        }

        var bytes: [UInt8] = []
        var output = ""
        let tokenLimit = min(Self.maximumReplyTokens, max(1, maximumTokens))
        for _ in 0..<tokenLimit {
            try checkCancellation()
            let token = llama_sampler_sample(sampler, context, -1)
            if llama_vocab_is_eog(vocabulary, token) { break }
            var piece = [CChar](repeating: 0, count: 256)
            var length = piece.withUnsafeMutableBufferPointer { llama_token_to_piece(vocabulary, token, $0.baseAddress, Int32($0.count), 0, false) }
            if length < 0 {
                piece = [CChar](repeating: 0, count: Int(-length))
                length = piece.withUnsafeMutableBufferPointer { llama_token_to_piece(vocabulary, token, $0.baseAddress, Int32($0.count), 0, false) }
            }
            guard length >= 0 else { throw TemocEngineError.unavailable("The model returned an invalid text token.") }
            bytes.append(contentsOf: piece.prefix(Int(length)).map { UInt8(bitPattern: $0) })
            if let text = String(bytes: bytes, encoding: .utf8) {
                output += text; bytes.removeAll(keepingCapacity: true); onText(output)
            }
            var next = token
            let status = withUnsafeMutablePointer(to: &next) { llama_decode(context, llama_batch_get_one($0, 1)) }
            if status != 0 { try checkCancellation(); throw TemocEngineError.unavailable("Temoc stopped while generating. You can ask again from this chat.") }
        }
        try checkCancellation()
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func checkCancellation() throws {
        if gate.isStopped || Task.isCancelled { throw CancellationError() }
    }

    private func tokenize(_ text: String, vocabulary: OpaquePointer) throws -> [llama_token] {
        let count = text.utf8.count
        guard count <= 80_000 else { throw TemocEngineError.contextFull }
        var tokens = [llama_token](repeating: 0, count: count + 8)
        let used = tokens.withUnsafeMutableBufferPointer { buffer in
            text.withCString { llama_tokenize(vocabulary, $0, Int32(count), buffer.baseAddress, Int32(buffer.count), true, true) }
        }
        guard used > 0, Int(used) <= tokens.count else { throw TemocEngineError.contextFull }
        return Array(tokens.prefix(Int(used)))
    }

    private static func chatML(system: String, turns: [TemocTurn]) -> String {
        // User/history content cannot introduce ChatML role delimiters.
        func escape(_ text: String) -> String { text.replacingOccurrences(of: "<|", with: "‹|") }
        var text = "<|im_start|>system\n" + escape(system) + "<|im_end|>\n"
        for turn in turns { text += "<|im_start|>\(turn.role.rawValue)\n\(escape(turn.text))<|im_end|>\n" }
        return text + "<|im_start|>assistant\n"
    }
}
