import SwiftUI
import UniformTypeIdentifiers

private let meshOrange = Color(red: 0.77, green: 0.25, blue: 0.02)

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @State private var tab = 0
    @State private var showingDevices = false
    var body: some View {
        TabView(selection: $tab) {
            request.tabItem { Label("Request", systemImage: "cross.case") }.tag(0)
            outbox.tabItem { Label("Outbox", systemImage: "tray") }.tag(1)
            SetupView().tabItem { Label("Setup", systemImage: "gearshape") }.tag(2)
        }
        .tint(meshOrange)
        .sheet(isPresented: $showingDevices) { DevicePicker().environmentObject(model) }
        .alert("Could not complete action", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
    }
    private var prototypeBanner: some View {
        Label("Prototype • No connection to 911", systemImage: "exclamationmark.triangle")
            .font(.subheadline.weight(.semibold)).foregroundStyle(Color.red)
            .frame(maxWidth: .infinity, alignment: .leading).accessibilityAddTraits(.isHeader)
    }
    private var request: some View {
        NavigationStack {
            Form {
                Section { prototypeBanner }
                Section {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "antenna.radiowaves.left.and.right").font(.title2).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Radio device").font(.headline)
                            Text(model.radio.status).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 8)
                        Button(model.radio.ready ? "Manage" : "Connect") { showingDevices = true }.frame(minHeight: 44)
                    }
                }
                Section {
                    Picker("Type", selection: draftBinding(\.category)) {
                        ForEach(EmergencyCategory.allCases) { type in Label(type.title, systemImage: type.symbol).tag(type) }
                    }
                    Picker("Priority you report", selection: draftBinding(\.severity)) {
                        ForEach(ReportedSeverity.allCases) { priority in Text(priority.title).tag(priority) }
                    }
                    Stepper("People: \(model.draft.people)", value: draftBinding(\.people), in: 1...255)
                    Toggle("Breathing concern", isOn: draftBinding(\.breathingConcern))
                    Toggle("Trapped", isOn: draftBinding(\.trapped))
                    Toggle("Severe bleeding", isOn: draftBinding(\.severeBleeding))
                } header: { Text("Emergency information") } footer: { Text("These are your reported details. The app does not assess medical urgency.") }
                Section {
                    TimelineView(.periodic(from: .now, by: 10)) { context in
                        VStack(alignment: .leading, spacing: 6) {
                            if let fix = model.location.fix, fix.isUsable(at: context.date) {
                                Text(model.location.message)
                                Text("Captured \(fix.capturedAt.formatted(date: .omitted, time: .standard))").font(.caption).foregroundStyle(.secondary)
                            } else { Text(model.location.fix == nil ? model.location.message : "Location is over 2 minutes old. Refresh it or send without GPS.") }
                        }
                    }
                    Button(model.location.requesting ? "Finding location…" : "Use current location") { model.location.request() }
                        .disabled(model.location.requesting).frame(minHeight: 44)
                    if model.location.fix != nil { Button("Remove location", role: .destructive) { model.location.clear() }.frame(minHeight: 44) }
                } header: { Text("Location") } footer: { Text("GPS is optional. If unavailable, include a landmark or address in notes. Only a fix less than 2 minutes old is sent.") }
                Section {
                    TextField("What happened? Where can responders find you?", text: draftBinding(\.note), axis: .vertical)
                        .lineLimit(3...6).autocorrectionDisabled(false).accessibilityLabel("Emergency notes")
                    HStack { Spacer(); Text("\(model.draft.byteCount) / 120 bytes").font(.caption.monospacedDigit()).foregroundStyle(model.draft.byteCount > 120 ? Color.red : Color.secondary) }
                } header: { Text("Notes") } footer: { Text("Keep it short. Emoji and accented characters can use several bytes.") }
                Section {
                    Button {
                        let count = model.snapshot.outbox.count; model.queueRequest()
                        if model.snapshot.outbox.count > count && model.storageReady { tab = 1 }
                    } label: {
                        Label("Queue request", systemImage: "paperplane.fill").font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.draft.byteCount > 120 || !model.storageReady || model.profile == nil)
                    if model.profile == nil { Button("Import a regional profile in Setup") { tab = 2 }.frame(minHeight: 44) }
                } footer: { Text("Queued requests stay on this phone until sent. A hub receipt confirms delivery to the local hub. It does not mean emergency services are coming.") }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Request help")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Text("EmergencyMesh").font(.caption.weight(.semibold)).foregroundStyle(.secondary) } }
        }
    }
    private func draftBinding<T>(_ keyPath: WritableKeyPath<RequestDraft, T>) -> Binding<T> {
        Binding(get: { model.draft[keyPath: keyPath] }, set: { value in model.updateDraft { $0[keyPath: keyPath] = value } })
    }
    private var outbox: some View {
        NavigationStack {
            List {
                Section { prototypeBanner }
                if model.outbox.isEmpty {
                    ContentUnavailableView("No requests queued", systemImage: "tray", description: Text("Create a request in the Request tab. Drafts and history are encrypted on this phone."))
                }
                ForEach(model.outbox) { item in
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Label(item.draft.category.title, systemImage: item.draft.category.symbol).font(.headline)
                                Spacer(); Text(item.draft.severity.title).font(.subheadline.weight(.semibold))
                            }
                            Label(item.status.title, systemImage: item.status.confirmed ? "checkmark.circle" : "clock")
                                .font(.headline).foregroundStyle(item.status.confirmed ? Color.green : meshOrange)
                            Text(item.createdAt.formatted(date: .abbreviated, time: .standard)).font(.caption).foregroundStyle(.secondary)
                            Text("\(item.draft.people) people • Request \(item.sequence)").font(.subheadline)
                            if !item.draft.note.isEmpty { Text(item.draft.note).textSelection(.enabled) }
                            if let fix = item.location { Text(String(format: "%.5f, %.5f • ±%.0f m", fix.latitude, fix.longitude, fix.accuracy)).font(.caption) }
                            else { Text("No GPS location attached").font(.caption).foregroundStyle(.secondary) }
                            Text("BLE transfer attempts: \(item.attemptCount)").font(.caption).foregroundStyle(.secondary)
                            if let text = item.receiptText { Text(text).font(.subheadline).textSelection(.enabled) }
                            if let error = item.lastError { Text(error).font(.subheadline).foregroundStyle(Color.red) }
                            if item.status == .unconfirmed {
                                Text("No authenticated hub receipt arrived. Check the mesh and hub, then retry this same request.").font(.subheadline)
                                Button("Retry request") { model.retry(item.id) }.frame(minHeight: 44)
                            }
                            if item.status == .queued && !model.radio.ready { Button("Connect radio device") { showingDevices = true }.frame(minHeight: 44) }
                            if item.status == .operatorReviewed { Text("Reviewed by a demo operator. No emergency-service dispatch is confirmed.").font(.caption).foregroundStyle(.secondary) }
                        }.padding(.vertical, 6)
                    }
                }
            }.navigationTitle("Outbox").privacySensitive()
        }
    }
}

private struct DevicePicker: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section { Text(model.radio.status) }
                Section {
                    Button(model.radio.scanning ? "Stop scan" : "Find nearby radios") { model.radio.scanning ? model.radio.stopScan() : model.radio.scan() }.frame(minHeight: 44)
                    ForEach(model.radio.devices) { device in
                        Button {
                            model.radio.connect(device)
                        } label: {
                            HStack { VStack(alignment: .leading) { Text(device.name); Text(device.id.uuidString.suffix(8)).font(.caption).foregroundStyle(.secondary) }; Spacer(); Text("\(device.rssi) dBm").font(.caption.monospacedDigit()) }
                                .frame(minHeight: 44)
                        }
                    }
                } footer: { Text("Connect only to your team's device. BLE names are not authenticated identities. The regional key protects request contents.") }
                if model.radio.ready { Button("Disconnect", role: .destructive) { model.radio.disconnect() }.frame(minHeight: 44) }
            }
            .navigationTitle("Radio device")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .onDisappear { model.radio.stopScan() }
        }
    }
}

private struct SetupView: View {
    @EnvironmentObject private var model: AppModel
    @State private var profileText = ""
    @State private var importing = false
    @State private var clearing = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("EmergencyMesh is a hackathon prototype. It has no connection to 911 or an emergency-service dispatcher.").font(.subheadline).foregroundStyle(Color.red)
                    if let profile = model.profile {
                        LabeledContent("Region", value: String(profile.region))
                        LabeledContent("Key ID", value: String(profile.keyId))
                        LabeledContent("Phone origin", value: String(profile.origin))
                        Text("Regional key stored in this phone's Keychain.").font(.caption).foregroundStyle(.secondary)
                    } else { Text("Import the private profile created by your local hub. Each phone needs a distinct origin.") }
                    Button("Import profile JSON file") { importing = true }.frame(minHeight: 44)
                    DisclosureGroup("Paste profile instead") {
                        SecureField("Private profile JSON", text: $profileText).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("Store profile securely") { model.importProfile(profileText); profileText = "" }.disabled(profileText.isEmpty).frame(minHeight: 44)
                    }
                } header: { Text("Provisioning") } footer: { Text("Do not share the key publicly. This demo uses a shared regional key: anyone with it can impersonate a phone or hub. BLE pairing alone does not identify a dispatcher.") }
                Section {
                    Text("Phone → BLE radio → LoRa relays → USB radio → local laptop hub.")
                    Text("The USB cable supplies power. App data uses Bluetooth. Keep the app open for timed retries. iOS may suspend or terminate background work; reconnecting can resume queued requests.")
                    Text("Attach a matching antenna before transmitting. Confirm the board's frequency and firmware with the hub operator.")
                    Text("Hub received means the hub decoded the request. Operator reviewed means a person reviewed it in the demo console. Neither means emergency services were dispatched.")
                } header: { Text("Using the prototype") }
                Section {
                    Button("Run local codec simulation") { model.runCodecDemo() }.frame(minHeight: 44)
                    if let result = model.demoResult { Text(result).font(.subheadline).textSelection(.enabled) }
                } header: { Text("Simulator / no-radio demo") } footer: { Text("This checks encryption and chunk reassembly using public synthetic test data. It does not simulate a successful real request in Outbox.") }
                Section {
                    Button("Clear local history and key", role: .destructive) { clearing = true }.frame(minHeight: 44)
                    if !model.lastAction.isEmpty { Text(model.lastAction).font(.caption).foregroundStyle(.secondary) }
                } header: { Text("Local data") } footer: { Text("Drafts and requests are encrypted on this device and excluded from app backups. The app sends only the details you queue, without an account or cloud backend.") }
            }
            .navigationTitle("Setup").privacySensitive()
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { return }
                    let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 4096 else { throw MeshError.invalid("Profile exceeds 4 KB.") }
                    let data = try Data(contentsOf: url); guard let json = String(data: data, encoding: .utf8) else { throw MeshError.invalid("Profile must contain UTF-8 JSON.") }
                    model.importProfile(json)
                } catch { model.errorMessage = error.localizedDescription }
            }
            .confirmationDialog("Delete all local requests, draft and regional key?", isPresented: $clearing, titleVisibility: .visible) {
                Button("Delete local data", role: .destructive) { model.clearLocalData() }
            } message: { Text("Requests already received by a hub remain on that hub. Queued requests on this phone will be lost.") }
        }
    }
}
