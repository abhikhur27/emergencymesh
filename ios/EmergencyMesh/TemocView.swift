import SwiftUI
import UniformTypeIdentifiers
import UIKit

private let temocMagenta = Color(red: 226.0 / 255, green: 0, blue: 116.0 / 255)

struct TemocView: View {
    @StateObject private var chat = TemocChatModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showingHistory = false
    @State private var showingModel = false
    @State private var showingGuides = false
    @FocusState private var composing: Bool

    var body: some View {
        VStack(spacing: 0) {
            Text("Technical emergency operations coordinator")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .padding(.horizontal, 20).padding(.bottom, 12)
            HStack(spacing: 7) {
                Image(systemName: chat.modelReady ? "circle.fill" : "arrow.down.circle")
                    .font(.system(size: 7)).accessibilityHidden(true)
                Text(chat.modelReady ? "Offline · On this iPhone" : chat.modelStatus).font(.caption)
                if !chat.modelReady { Button("Set up") { showingModel = true }.font(.caption.weight(.semibold)) }
            }.foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 12)
                .overlay(alignment: .top) { Divider() }
            conversation
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle("Temoc").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { composing = false; showingHistory = true } label: { Image(systemName: "list.bullet") }
                    .accessibilityLabel("Chat history").frame(minWidth: 44, minHeight: 44)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat") { composing = false; chat.newChat() }
                    .disabled(!chat.historyReady).frame(minHeight: 44)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .sheet(isPresented: $showingHistory) { TemocHistorySheet(chat: chat, showingModel: $showingModel) }
        .sheet(isPresented: $showingModel) { TemocModelSheet(chat: chat) }
        .sheet(isPresented: $showingGuides) { TemocGuidesSheet() }
        .alert("Temoc", isPresented: Binding(get: { chat.errorMessage != nil }, set: { if !$0 { chat.errorMessage = nil } })) {
            Button("OK", role: .cancel) { chat.errorMessage = nil }
        } message: { Text(chat.errorMessage ?? "") }
        .onAppear { chat.checkModel() }
        .onDisappear { chat.stopAndUnload() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { chat.becameInactive() } else { chat.checkModel() } }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in chat.becameInactive() }
        .privacySensitive()
        .tint(temocMagenta)
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24) {
                    if chat.current?.messages.isEmpty != false {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("One step at a time").font(.title2.weight(.semibold))
                            Text("Ask about preparing supplies, making a plan or finding a calmer next step. Chats stay on this phone.")
                                .foregroundStyle(.secondary)
                            Button("Open offline guides") { showingGuides = true }.frame(minHeight: 44)
                            if !chat.modelReady {
                                Text("The saved guides work now. Install the model for open-ended conversations.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }.padding(.top, 24)
                    }
                    ForEach(chat.current?.messages ?? []) { message in
                        messageRow(message).id(message.id)
                    }
                    Color.clear.frame(height: 1).id("conversation-end")
                }.padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: chat.current?.messages.count) { _, _ in proxy.scrollTo("conversation-end", anchor: .bottom) }
            .onChange(of: chat.generating) { _, active in if !active { proxy.scrollTo("conversation-end", anchor: .bottom) } }
        }
    }

    @ViewBuilder private func messageRow(_ message: TemocMessage) -> some View {
        if message.role == .user {
            HStack {
                Spacer(minLength: 36)
                Text(message.text).padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
                    .textSelection(.enabled)
            }.accessibilityElement(children: .combine).accessibilityLabel("You: \(message.text)")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if message.state == .generating {
                    HStack(spacing: 10) { ProgressView(); Text("Thinking offline…").font(.subheadline).foregroundStyle(.secondary) }
                        .accessibilityLabel("Temoc is preparing an offline reply")
                } else {
                    Text(message.text).foregroundStyle(message.state == .interrupted ? Color.secondary : Color.primary)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    if message.guideID != nil {
                        Button("Saved offline guidance · Sources") { showingGuides = true }
                            .font(.caption).frame(minHeight: 36)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .contain)
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("General information. Temoc cannot contact help.").font(.caption2).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Button("Guides") { composing = false; showingGuides = true }.font(.caption2)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Ask Temoc…", text: $chat.draft, axis: .vertical)
                    .lineLimit(1...4).focused($composing).accessibilityLabel("Message to Temoc")
                    .padding(.vertical, 10).padding(.leading, 14)
                Button {
                    if chat.generating { chat.stop() } else { chat.send(); composing = false }
                } label: {
                    Image(systemName: chat.generating ? "stop.fill" : "arrow.up")
                        .font(.body.weight(.semibold)).foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(chat.canSend || chat.generating ? temocMagenta : Color.secondary, in: Circle())
                }.disabled(!chat.canSend && !chat.generating)
                    .accessibilityLabel(chat.generating ? "Stop reply" : "Send to offline Temoc")
                    .padding(5)
            }
            .overlay { RoundedRectangle(cornerRadius: 24).strokeBorder(Color(uiColor: .separator)) }
        }.padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
            .background(Color(uiColor: .systemBackground))
    }
}

private struct TemocHistorySheet: View {
    @ObservedObject var chat: TemocChatModel
    @Binding var showingModel: Bool
    @Environment(\.dismiss) private var dismiss
    @State private var deleting: UUID?
    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(chat.sortedChats) { item in
                        Button { chat.selectChat(item.id); dismiss() } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(item.title).foregroundStyle(.primary).lineLimit(2)
                                Text(item.updatedAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                            }.frame(minHeight: 44)
                        }.swipeActions { Button("Delete", role: .destructive) { deleting = item.id } }
                    }
                } footer: { Text("Saved only on this iPhone, encrypted and excluded from app backups. New chat starts a separate context and preserves earlier conversations.") }
                Section {
                    Button("Offline model") { dismiss(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { showingModel = true } }.frame(minHeight: 44)
                }
            }
            .navigationTitle("Your chats").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("New chat") { chat.newChat(); dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .confirmationDialog("Delete this chat from this phone?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete chat", role: .destructive) { if let deleting { chat.deleteChat(deleting) }; deleting = nil }
                Button("Cancel", role: .cancel) { deleting = nil }
            }
        }.tint(temocMagenta)
    }
}

private struct TemocModelSheet: View {
    @ObservedObject var chat: TemocChatModel
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(TemocModelFiles.description).font(.headline)
                    Text(chat.modelStatus).foregroundStyle(.secondary)
                    if let progress = chat.downloadProgress { ProgressView(value: progress).accessibilityLabel("Model download progress") }
                    else if chat.installingModel { ProgressView().accessibilityLabel("Verifying model") }
                    if chat.installingModel { Button("Cancel setup", role: .cancel) { chat.cancelModelSetup() }.frame(minHeight: 44) }
                    else if !chat.modelReady {
                        Button("Download model over Wi-Fi") { chat.downloadModel() }.frame(minHeight: 44)
                        Button("Import model file") { importing = true }.frame(minHeight: 44)
                    }
                } header: { Text("On-device model") } footer: {
                    Text("Download the model once over Wi-Fi (about 1.12 GB), then chat offline. Verification checks the pinned official file before loading it. Chat text, GPS and phone keys are never sent with a model download.")
                }
                Section {
                    Text("Temoc runs locally with a 2,048-token context and short replies. Older messages remain in history, but only recent context fits in each reply.")
                    Text("A small language model can be wrong. High-risk medical prompts use saved first-aid guidance instead of generated diagnoses or medication instructions.")
                    Button("Unload model from memory") { chat.stopAndUnload() }.frame(minHeight: 44)
                    Link("Qwen model and Apache 2.0 license", destination: URL(string: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF")!)
                    Link("llama.cpp runtime and MIT license", destination: URL(string: "https://github.com/ggml-org/llama.cpp/releases/tag/b5046")!)
                } header: { Text("How it works") }
            }
            .navigationTitle("Offline model").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [UTType(filenameExtension: "gguf") ?? .data], allowsMultipleSelection: false) { result in
                do { if let file = try result.get().first { chat.importModel(file) } }
                catch { chat.errorMessage = error.localizedDescription }
            }
        }.tint(temocMagenta)
    }
}

private struct TemocGuidesSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(TemocSafety.emergency.text).font(.subheadline)
                } header: { Text("Immediate danger") }
                Section {
                    ForEach(TemocSafety.guides) { guide in
                        NavigationLink { TemocGuideDetail(guide: guide) } label: { Label(guide.title, systemImage: guide.symbol).frame(minHeight: 44) }
                    }
                } footer: { Text("These short summaries are bundled in the app and work without a model or connection. Sources checked \(TemocSafety.reviewedAt). They are general guidance, not a substitute for trained help.") }
            }
            .navigationTitle("Offline guides").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }.tint(temocMagenta)
    }
}
private struct TemocGuideDetail: View {
    let guide: TemocGuide
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(guide.text).font(.body)
                if guide.urgent { Text("Seek urgent human help by any available method. Temoc has not contacted anyone.").font(.subheadline.weight(.semibold)) }
                Link("Source: \(guide.sourceName)", destination: guide.sourceURL)
                Text("The summary above is saved offline. Opening the full source requires a connection.").font(.footnote).foregroundStyle(.secondary)
            }.padding(24)
        }.navigationTitle(guide.title).navigationBarTitleDisplayMode(.inline)
    }
}
