import Foundation
import Combine
import TemocRuntime

@MainActor
final class TemocChatModel: ObservableObject {
    @Published private(set) var archive = TemocArchive()
    @Published var draft = ""
    @Published var errorMessage: String?
    @Published private(set) var historyReady = false
    @Published private(set) var generating = false
    @Published private(set) var modelStatus = "Checking offline model…"
    @Published private(set) var modelReady = false
    @Published private(set) var installingModel = false
    @Published private(set) var downloadProgress: Double?
    private var store: TemocHistoryStore?
    private let engine = TemocEngine()
    private var modelURL: URL?
    private var generationTask: Task<Void, Never>?
    private var modelTask: Task<Void, Never>?
    private var generationID = UUID()
    private var checkedModel = false

    init() {
        do {
            let storage = try TemocHistoryStore(); store = storage
            archive = try storage.load(); historyReady = true
            if archive.chats.isEmpty { var chat = TemocConversation(); chat.updatedAt = Date(); archive.chats = [chat]; archive.selectedID = chat.id }
            if archive.selectedID == nil { archive.selectedID = archive.chats.last?.id }
            _ = persist()
        } catch { errorMessage = error.localizedDescription }
    }
    var current: TemocConversation? { archive.chats.first { $0.id == archive.selectedID } }
    var sortedChats: [TemocConversation] { archive.chats.sorted { $0.updatedAt > $1.updatedAt } }
    var canSend: Bool { historyReady && !generating && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func checkModel() {
        guard !checkedModel, !installingModel else { return }; checkedModel = true
        installingModel = true; modelStatus = "Verifying offline model…"
        modelTask = Task { [weak self] in
            guard let self else { return }
            do {
                let verified = try await Self.fileWork { try TemocModelFiles.candidate().map { try TemocModelFiles.verify($0) } }
                try Task.checkCancellation()
                self.modelURL = verified; self.modelReady = verified != nil
                self.modelStatus = verified == nil ? "Model not installed" : "Ready offline · Qwen 1.5B"
            } catch is CancellationError { self.checkedModel = false; self.modelStatus = self.modelReady ? "Ready offline · Qwen 1.5B" : "Model check paused" }
            catch { self.modelStatus = "Model needs attention"; self.errorMessage = error.localizedDescription }
            self.installingModel = false; self.modelTask = nil
        }
    }

    func importModel(_ url: URL) {
        guard !installingModel else { return }
        stopAndUnload(); installingModel = true; modelStatus = "Verifying selected model…"; downloadProgress = nil
        modelTask = Task { [weak self] in
            guard let self else { return }
            let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let installed = try await Self.fileWork { try TemocModelFiles.install(url) }
                try Task.checkCancellation(); self.modelURL = installed; self.modelReady = true; self.modelStatus = "Ready offline · Qwen 1.5B"
            } catch is CancellationError { self.modelStatus = self.modelReady ? "Ready offline · Qwen 1.5B" : "Model setup paused" }
            catch { self.modelStatus = "Model setup failed"; self.errorMessage = error.localizedDescription }
            self.installingModel = false; self.modelTask = nil
        }
    }

    /// An explicit user action, Wi-Fi only. No prompt, chat, location or profile
    /// is part of this one-time, checksum-pinned public model download.
    func downloadModel() {
        guard !installingModel else { return }
        stopAndUnload(); installingModel = true; modelStatus = "Downloading model over Wi-Fi…"; downloadProgress = 0
        modelTask = Task { [weak self] in
            guard let self else { return }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.allowsCellularAccess = false; configuration.timeoutIntervalForResource = 3600
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            do {
                var request = URLRequest(url: TemocModelFiles.downloadURL); request.timeoutInterval = 60
                let observer = TemocDownloadProgress { [weak self] fraction in Task { @MainActor in self?.downloadProgress = fraction } }
                let (temporary, response) = try await session.download(for: request, delegate: observer)
                defer { try? FileManager.default.removeItem(at: temporary) }
                guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode) else { throw MeshError.invalid("The model server did not return a successful download.") }
                try Task.checkCancellation(); self.modelStatus = "Verifying downloaded model…"; self.downloadProgress = nil
                let installed = try await Self.fileWork { try TemocModelFiles.install(temporary) }
                try Task.checkCancellation(); self.modelURL = installed; self.modelReady = true; self.modelStatus = "Ready offline · Qwen 1.5B"
            } catch is CancellationError { self.modelStatus = self.modelReady ? "Ready offline · Qwen 1.5B" : "Download paused; start again on Wi-Fi" }
            catch { self.modelStatus = "Download did not finish"; self.errorMessage = error.localizedDescription }
            self.installingModel = false; self.downloadProgress = nil; self.modelTask = nil
        }
    }
    func cancelModelSetup() { modelTask?.cancel() }

    func newChat() {
        guard historyReady else { return }
        stop()
        if current?.messages.isEmpty == true { draft = ""; return }
        guard archive.chats.count < 20 else { errorMessage = "You have 20 local chats. Delete an older chat before making another."; return }
        let previous = archive; let chat = TemocConversation()
        archive.chats.append(chat); archive.selectedID = chat.id; draft = ""
        if !persist() { archive = previous }
    }
    func selectChat(_ id: UUID) {
        guard historyReady, archive.chats.contains(where: { $0.id == id }) else { return }
        stop(); archive.selectedID = id; draft = ""; _ = persist()
    }
    func deleteChat(_ id: UUID) {
        guard historyReady else { return }; stop()
        let previous = archive; archive.chats.removeAll { $0.id == id }
        if archive.chats.isEmpty { archive.chats.append(TemocConversation()) }
        if archive.selectedID == id { archive.selectedID = archive.chats.last?.id }
        if !persist() { archive = previous }
    }

    func send() {
        let input = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend, input.count <= 1200 else { errorMessage = "Keep a message under 1,200 characters so the offline context stays small."; return }
        guard !TemocSafety.containsPrivateKey(input) else { errorMessage = "Keep private profile keys out of chats. Import a profile in Setup instead."; return }
        let direct = TemocSafety.directResponse(for: input)
        guard direct != nil || modelURL != nil else { errorMessage = "Install the offline model first, or open one of the built-in guides. No message was sent anywhere."; return }
        guard let index = archive.chats.firstIndex(where: { $0.id == archive.selectedID }) else { return }
        guard archive.chats[index].messages.count <= 78 else { errorMessage = "This chat has reached its local message limit. Start a new chat to continue."; return }
        let previous = archive
        archive.chats[index].messages.append(TemocMessage(role: .user, text: input))
        if let direct {
            archive.chats[index].messages.append(TemocMessage(role: .assistant, text: direct.text, guideID: direct.id))
            archive.chats[index].updatedAt = Date()
            if persist() { draft = "" } else { archive = previous }
            return
        }
        guard let modelURL else { return }
        let chatID = archive.chats[index].id
        let turns = archive.chats[index].messages.filter { $0.state == .complete }.map { TemocTurn(role: $0.role == .user ? .user : .assistant, text: $0.text) }
        let pending = TemocMessage(role: .assistant, text: "", state: .generating)
        archive.chats[index].messages.append(pending); archive.chats[index].updatedAt = Date()
        guard persist() else { archive = previous; return }
        draft = ""; generating = true; let runID = UUID(); generationID = runID
        generationTask = Task { [weak self] in
            guard let self else { return }
            do {
                let output = try await self.engine.reply(modelPath: modelURL.path, systemPrompt: TemocSafety.systemPrompt, turns: turns, onText: { _ in })
                try Task.checkCancellation()
                guard self.generationID == runID else { return }
                // Generated text is withheld until this screen; token streaming
                // cannot expose an unchecked medication dose or dispatch claim.
                let accepted = TemocSafety.screenGeneratedText(output)
                self.finish(chatID: chatID, messageID: pending.id, text: accepted ? output : "I couldn't produce a reliable answer to that. Check the offline guides or seek a qualified person for advice. I haven't contacted anyone.", state: .complete)
            } catch is CancellationError {
                if self.generationID == runID { self.finish(chatID: chatID, messageID: pending.id, text: "Reply stopped. You can ask again or start a new chat.", state: .interrupted) }
            } catch {
                if self.generationID == runID { self.finish(chatID: chatID, messageID: pending.id, text: "This reply did not finish. Your question is saved on this phone.", state: .interrupted); self.errorMessage = error.localizedDescription }
            }
            if self.generationID == runID { self.generating = false; self.generationTask = nil }
        }
    }

    func stop() {
        engine.cancel(); generationTask?.cancel(); generationTask = nil; generationID = UUID(); generating = false
        for c in archive.chats.indices { for m in archive.chats[c].messages.indices where archive.chats[c].messages[m].state == .generating {
            archive.chats[c].messages[m].state = .interrupted; archive.chats[c].messages[m].text = "Reply stopped. You can ask again or start a new chat."
        } }
        if historyReady { _ = persist() }
    }
    func stopAndUnload() { stop(); Task { await engine.unload() } }
    func becameInactive() { stopAndUnload(); modelTask?.cancel() }

    private func finish(chatID: UUID, messageID: UUID, text: String, state: TemocMessageState) {
        guard let c = archive.chats.firstIndex(where: { $0.id == chatID }), let m = archive.chats[c].messages.firstIndex(where: { $0.id == messageID }) else { return }
        archive.chats[c].messages[m].text = text; archive.chats[c].messages[m].state = state; archive.chats[c].updatedAt = Date(); _ = persist()
    }
    @discardableResult private func persist() -> Bool {
        do { guard historyReady, let store else { return false }; try store.save(archive); return true }
        catch { historyReady = false; errorMessage = error.localizedDescription; return false }
    }
    private nonisolated static func fileWork<T: Sendable>(_ operation: @escaping @Sendable () throws -> T) async throws -> T {
        let job = Task.detached(priority: .utility) { try operation() }
        return try await withTaskCancellationHandler(operation: { try await job.value }, onCancel: { job.cancel() })
    }
}
