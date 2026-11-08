import SwiftUI
import UniformTypeIdentifiers

private let rescueMagenta = Color(red: 226.0 / 255, green: 0, blue: 116.0 / 255)
private let campusTitle = "UT Dallas · ECSW"

private enum RequestRoute: Hashable {
    case receipt(String)
}

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var tab = 0
    @State private var path: [RequestRoute] = []
    @State private var showingDevices = false
    @State private var submitting = false
    @FocusState private var notesFocused: Bool

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack(path: $path) {
                request
                    .navigationDestination(for: RequestRoute.self) { route in
                        switch route {
                        case .receipt(let id): RequestStatusView(id: id)
                        }
                    }
            }
            .tabItem { Label("Report", systemImage: "cross.case") }.tag(0)
            NavigationStack { RequestHistoryView() }
                .tabItem { Label("My requests", systemImage: "tray") }.tag(1)
            NavigationStack { TemocView() }
                .tabItem { Label("Temoc", systemImage: "bubble.left.and.bubble.right") }.tag(3)
            NavigationStack { SetupView() }
                .tabItem { Label("Setup", systemImage: "gearshape") }.tag(2)
        }
        .tint(rescueMagenta)
        .sheet(isPresented: $showingDevices) { DevicePicker().environmentObject(model) }
        .alert("Could not complete action", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: { Text(model.errorMessage ?? "") }
        .onAppear { updateLocationActivity() }
        .onChange(of: tab) { _, _ in updateLocationActivity() }
        .onChange(of: path) { _, newPath in
            if newPath.isEmpty { submitting = false }
            updateLocationActivity()
        }
        .onChange(of: scenePhase) { _, _ in updateLocationActivity() }
        .onChange(of: showingDevices) { _, _ in updateLocationActivity() }
        .onDisappear { model.location.setReportActive(false) }
    }

    private var request: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                transponderButton
                paired(peopleCard, priorityCard)
                paired(dangerCard, suppliesCard)
                notesCard
                concerns
                gpsStatus
                if model.profile == nil {
                    Button { tab = 2 } label: {
                        Label("Add your private phone profile in Setup to send.", systemImage: "key")
                            .font(.subheadline).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }.buttonStyle(.plain)
                }
                if !model.storageReady {
                    Label("Protected storage is unavailable. Your report cannot be saved yet.", systemImage: "exclamationmark.circle")
                        .font(.subheadline).foregroundStyle(Color.red)
                }
            }.padding(16)
        }
        .background(Color(uiColor: .systemGroupedBackground))
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Report").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Image("RescueMeshLogo").resizable().scaledToFit().frame(width: 148, height: 32)
                    .accessibilityLabel("RescueMesh")
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { notesFocused = false }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            actionArea {
                Button {
                    guard !submitting else { return }; submitting = true
                    notesFocused = false
                    if let id = model.queueRequest() { path = [.receipt(id)] }
                    else { submitting = false }
                } label: {
                    Label("Send request", systemImage: "paperplane.fill").primaryActionLabel()
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(submitting || model.profile == nil || !model.storageReady || model.draft.byteCount > 120)
                if !notesFocused {
                    Text(model.radio.ready ? "Encrypted on your phone. A hub receipt confirms delivery." : "Saved securely; sends when your transponder connects.")
                        .secondaryFootnote()
                    Text("Demonstration · No emergency-service connection.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .privacySensitive()
    }

    private var transponderButton: some View {
        Button { notesFocused = false; showingDevices = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "antenna.radiowaves.left.and.right").font(.title2).foregroundStyle(rescueMagenta)
                    .frame(width: 32).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.radio.ready ? "Transponder connected" : "Connect transponder").font(.headline)
                    Text(model.radio.ready ? "Ready to carry your request." : "Prepare your report while offline.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Image(systemName: model.radio.ready ? "checkmark.circle.fill" : "chevron.right")
                    .foregroundStyle(rescueMagenta).accessibilityHidden(true)
            }.foregroundStyle(.primary).frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .padding(14)
                .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                .overlay { RoundedRectangle(cornerRadius: 16).strokeBorder(rescueMagenta.opacity(0.35)) }
        }.buttonStyle(.plain)
    }

    private var peopleCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("People with you").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            HStack(spacing: 2) {
                Button { model.updateDraft { $0.people = max(1, $0.people - 1) } } label: {
                    Image(systemName: "minus").frame(minWidth: 44, maxWidth: .infinity, minHeight: 44)
                }
                .disabled(model.draft.people <= 1).accessibilityLabel("Fewer people")
                Text("\(model.draft.people)").font(.title2.weight(.semibold)).monospacedDigit()
                    .frame(minWidth: 44, maxWidth: .infinity, minHeight: 44)
                    .accessibilityLabel("\(model.draft.people) \(model.draft.people == 1 ? "person" : "people"), including you")
                Button { model.updateDraft { $0.people = min(255, $0.people + 1) } } label: {
                    Image(systemName: "plus").frame(minWidth: 44, maxWidth: .infinity, minHeight: 44)
                }
                .disabled(model.draft.people >= 255).accessibilityLabel("More people")
            }.buttonStyle(.plain)
            Text("Including you").font(.caption).foregroundStyle(.secondary)
        }.reportCard()
    }

    private var priorityCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Priority").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            HStack(spacing: 2) {
                ForEach([ReportedSeverity.assistance, .serious, .urgent]) { severity in
                    let selected = model.draft.severity == severity
                    Button { model.updateDraft { $0.severity = severity } } label: {
                        Text(priorityMark(severity)).font(.title3.weight(.bold))
                            .frame(minWidth: 44, maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(selected ? rescueMagenta : Color.primary)
                            .background(selected ? rescueMagenta.opacity(0.10) : Color(uiColor: .tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(selected ? rescueMagenta : Color.clear) }
                    }
                    .buttonStyle(.plain).accessibilityLabel(severity.title)
                    .accessibilityHint("Priority you report")
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            Text(model.draft.severity.title).font(.caption.weight(.medium)).foregroundStyle(.secondary)
        }.reportCard()
    }

    private var dangerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Type of danger").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(minimum: 44), spacing: 2), count: 3), spacing: 4) {
                ForEach([EmergencyCategory.medical, .fire, .flood, .earthquake, .rescue, .safety]) { category in
                    let selected = model.draft.category == category
                    Button { model.updateDraft { $0.category = category } } label: {
                        Image(systemName: category.symbol).font(.title3)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .foregroundStyle(selected ? rescueMagenta : Color.primary)
                            .background(selected ? rescueMagenta.opacity(0.10) : Color(uiColor: .tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(selected ? rescueMagenta : Color.clear) }
                    }
                    .buttonStyle(.plain).accessibilityLabel(category.title)
                    .accessibilityAddTraits(selected ? [.isSelected] : [])
                }
            }
            Menu {
                ForEach(EmergencyCategory.allCases) { category in
                    Button { model.updateDraft { $0.category = category } } label: {
                        Label(category.title, systemImage: category.symbol)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(model.draft.category.title).font(.subheadline.weight(.medium))
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down").font(.caption.weight(.semibold)).accessibilityHidden(true)
                }.frame(maxWidth: .infinity, minHeight: 44)
            }
            .accessibilityLabel("Type of danger").accessibilityValue(model.draft.category.title)
        }.reportCard()
    }

    private var suppliesCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Supplies needed").font(.subheadline.weight(.semibold)).padding(.bottom, 6).accessibilityAddTraits(.isHeader)
            ForEach(SupplyNeed.allCases) { supply in
                let selected = model.draft.supplies.contains(supply)
                Button {
                    model.updateDraft { draft in
                        if selected { draft.supplies.remove(supply) } else { draft.supplies.insert(supply) }
                    }
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: supply.symbol).frame(width: 18).accessibilityHidden(true)
                        Text(supply.title).font(.subheadline)
                        Spacer(minLength: 0)
                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected ? rescueMagenta : Color.secondary).accessibilityHidden(true)
                    }
                    .foregroundStyle(.primary).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain).accessibilityLabel(supply.title)
                .accessibilityValue(selected ? "Selected" : "Not selected")
                .accessibilityHint("Select all supplies you need")
                .accessibilityAddTraits(selected ? [.isSelected] : [])
            }
        }.reportCard()
    }

    private var notesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Additional notes").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            TextField("Add details, a building or nearby landmark…", text: draftBinding(\.note), axis: .vertical)
                .lineLimit(3...6).font(.body).focused($notesFocused)
                .accessibilityLabel("Additional notes and landmark")
            noteLimit
        }.reportCard()
    }

    @ViewBuilder private var noteLimit: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.draft.byteCount > 120 ? "Please shorten your notes" : "A landmark helps rescuers find you")
                Text("\(model.draft.byteCount)/120 bytes").monospacedDigit()
            }.font(.caption).foregroundStyle(model.draft.byteCount > 120 ? Color.red : Color.secondary)
        } else {
            HStack(alignment: .firstTextBaseline) {
                Text(model.draft.byteCount > 120 ? "Please shorten your notes" : "A landmark helps rescuers find you")
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Text("\(model.draft.byteCount)/120 bytes").monospacedDigit().fixedSize()
            }.font(.caption).foregroundStyle(model.draft.byteCount > 120 ? Color.red : Color.secondary)
        }
    }

    private var concerns: some View {
        DisclosureGroup("Additional concerns") {
            VStack(spacing: 0) {
                Toggle("Breathing concern", isOn: draftBinding(\.breathingConcern)).frame(minHeight: 44)
                Toggle("Trapped", isOn: draftBinding(\.trapped)).frame(minHeight: 44)
                Toggle("Severe bleeding", isOn: draftBinding(\.severeBleeding)).frame(minHeight: 44)
            }.font(.subheadline).padding(.top, 8)
        }.font(.subheadline).frame(minHeight: 44).padding(12)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var gpsStatus: some View {
        TimelineView(.periodic(from: .now, by: 10)) { context in
            let available = model.location.currentFix(at: context.date)
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: available == nil ? "location" : "location.fill")
                    .font(.title3).foregroundStyle(available == nil ? Color.secondary : rescueMagenta)
                    .frame(width: 24).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(available != nil ? "GPS data ready" : (model.location.requesting ? "Finding GPS…" : "GPS unavailable"))
                        .font(.subheadline.weight(.semibold))
                    if let available {
                        Text("About \(Int(available.accuracy.rounded(.up))) m accuracy · attaches automatically")
                            .font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text(model.location.message).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 4)
        }
    }

    @ViewBuilder private func paired<Left: View, Right: View>(_ left: Left, _ right: Right) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 12) { left; right }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    left.frame(minWidth: 160)
                    right.frame(minWidth: 160)
                }
                VStack(alignment: .leading, spacing: 12) { left; right }
            }
        }
    }

    private func priorityMark(_ severity: ReportedSeverity) -> String {
        switch severity { case .assistance: return "!"; case .serious: return "!!"; case .urgent: return "!!!" }
    }
    private func draftBinding<T>(_ keyPath: WritableKeyPath<RequestDraft, T>) -> Binding<T> {
        Binding(get: { model.draft[keyPath: keyPath] }, set: { value in model.updateDraft { $0[keyPath: keyPath] = value } })
    }
    private func updateLocationActivity() {
        model.location.setReportActive(tab == 0 && path.isEmpty && !showingDevices && scenePhase == .active)
    }
}

private struct RequestSummary: View {
    let draft: RequestDraft
    let location: LocationFix?
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: draft.category.symbol).font(.title2).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(draft.category.title) requested").font(.title3.bold())
                    Text("\(draft.people) \(draft.people == 1 ? "person" : "people") · \(draft.severity.title)").foregroundStyle(.secondary)
                }
            }
            HStack(alignment: .top, spacing: 16) {
                Image(systemName: location == nil ? "mappin" : "location.fill").font(.title2).foregroundStyle(rescueMagenta).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 5) {
                    Text(location == nil ? "No GPS location attached" : "GPS location attached")
                    if let location { Text(String(format: "%.5f, %.5f", location.latitude, location.longitude)).font(.subheadline).foregroundStyle(.secondary) }
                    else { Text("Include a landmark in your message.").font(.subheadline).foregroundStyle(.secondary) }
                }
            }
            if draft.breathingConcern || draft.trapped || draft.severeBleeding {
                VStack(alignment: .leading, spacing: 6) {
                    if draft.breathingConcern { Label("Breathing concern", systemImage: "exclamationmark.circle") }
                    if draft.trapped { Label("Trapped", systemImage: "exclamationmark.circle") }
                    if draft.severeBleeding { Label("Severe bleeding", systemImage: "exclamationmark.circle") }
                }.font(.subheadline)
            }
            if !draft.supplies.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Supplies needed").font(.subheadline.weight(.semibold))
                    ForEach(SupplyNeed.allCases.filter { draft.supplies.contains($0) }) { supply in
                        Label(supply.title, systemImage: supply.symbol).font(.subheadline)
                    }
                }
            }
            Divider()
            Text(draft.note.isEmpty ? "No additional details." : draft.note).font(.body).textSelection(.enabled)
        }
    }
}

private struct RequestHistoryView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        List {
            if model.outbox.isEmpty {
                ContentUnavailableView("No requests yet", systemImage: "tray", description: Text("Prepare a request in the Report tab. Your history stays on this phone."))
            }
            ForEach(model.outbox) { item in
                NavigationLink { RequestStatusView(id: item.id) } label: {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: item.draft.category.symbol).font(.title3).frame(width: 26).padding(.top, 2).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(item.draft.category.title).font(.headline)
                            Text(item.status.title).font(.subheadline)
                            Text(item.createdAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 8)
                }
            }
        }
        .navigationTitle("My requests").privacySensitive()
    }
}

private struct RequestStatusView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showingDevices = false
    let id: String

    var body: some View {
        ScrollView {
            if let item = model.outbox.first(where: { $0.id == id }) {
                VStack(alignment: .leading, spacing: 28) {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: item.status.confirmed ? "checkmark.circle.fill" : (item.status == .unconfirmed ? "exclamationmark.circle" : "clock"))
                            .font(.largeTitle).foregroundStyle(rescueMagenta).accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(item.status.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                            Text((item.receiptAt ?? item.createdAt).formatted(date: .omitted, time: .shortened)).foregroundStyle(.secondary)
                        }
                    }
                    Text(statusExplanation(item.status)).font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                        .background(rescueMagenta.opacity(0.09), in: RoundedRectangle(cornerRadius: 10))
                    RequestSummary(draft: item.draft, location: item.location)
                    if let error = item.lastError { Text(error).font(.subheadline).foregroundStyle(Color.red) }
                    if item.status == .unconfirmed {
                        Button("Retry this request") { model.retry(item.id) }.buttonStyle(.borderedProminent).frame(minHeight: 44)
                    }
                    if !item.status.confirmed && !model.radio.ready {
                        Button("Connect companion") { showingDevices = true }.buttonStyle(.bordered).frame(minHeight: 44)
                    }
                    Divider()
                    DisclosureGroup("Delivery details") {
                        VStack(alignment: .leading, spacing: 12) {
                            LabeledContent("Request", value: String(item.sequence))
                            LabeledContent("Radio transfer attempts", value: String(item.attemptCount))
                            Text("Saved \(item.createdAt.formatted(date: .abbreviated, time: .shortened))")
                            if let text = item.receiptText { Text(text).textSelection(.enabled) }
                            if item.status.confirmed { Label("Receipt authenticated with your phone’s key", systemImage: "lock.shield") }
                            Text("Retries reuse this saved request. They do not create a new incident.").foregroundStyle(.secondary)
                        }.font(.subheadline).padding(.top, 12)
                    }
                    Text("This does not confirm emergency-service dispatch.").font(.footnote).foregroundStyle(.secondary)
                }.padding(24)
            } else {
                ContentUnavailableView("Request no longer on this phone", systemImage: "tray", description: Text("Local history may have been cleared. Reports already received remain at the hub."))
            }
        }
        .navigationTitle("My request").privacySensitive()
        .sheet(isPresented: $showingDevices) { DevicePicker().environmentObject(model) }
    }

    private func statusExplanation(_ status: DeliveryStatus) -> String {
        switch status {
        case .queued: return model.radio.ready ? "Saved on your phone. Waiting to transfer to your companion." : "Saved on your phone. Connect your companion to send it."
        case .submitted: return "Your companion has the request. Waiting for the local hub to confirm receipt."
        case .unconfirmed: return "A hub receipt hasn’t arrived. Check your companion and try this request again."
        case .hubReceived: return "Your local hub received the request. An operator has not marked it reviewed."
        case .operatorReviewed: return "An operator marked this request reviewed at the hub."
        }
    }
}

private struct DevicePicker: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section { Label(model.radio.status, systemImage: "antenna.radiowaves.left.and.right") }
                Section {
                    Button(model.radio.scanning ? "Stop looking" : "Find nearby companions") { model.radio.scanning ? model.radio.stopScan() : model.radio.scan() }.frame(minHeight: 44)
                    ForEach(model.radio.devices) { device in
                        Button { model.radio.connect(device) } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(device.name)
                                    Text("Device \(device.id.uuidString.suffix(8))").font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).accessibilityHidden(true)
                            }.frame(minHeight: 44)
                        }
                    }
                } footer: { Text("Choose the companion you’re powering. A Bluetooth name is not an authenticated identity; your phone’s private key protects the message contents.") }
                if model.radio.ready { Button("Disconnect companion", role: .destructive) { model.radio.disconnect() }.frame(minHeight: 44) }
            }
            .navigationTitle("Your companion").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .onDisappear { model.radio.stopScan() }
        }.tint(rescueMagenta)
    }
}

private struct SetupView: View {
    @EnvironmentObject private var model: AppModel
    @State private var profileText = ""
    @State private var importing = false
    @State private var clearing = false
    @State private var showingDevices = false
    var body: some View {
        Form {
            Section {
                Text("RescueMesh").font(.title2.bold())
                Text(campusTitle).foregroundStyle(.secondary)
                Text("A radio mesh for requests when connectivity is limited.").font(.subheadline)
            }
            Section {
                if let profile = model.profile {
                    Label("Phone profile installed", systemImage: "checkmark.shield")
                    Text("Stored in this phone’s Keychain.").font(.subheadline).foregroundStyle(.secondary)
                    DisclosureGroup("Profile identity") {
                        LabeledContent("Region", value: String(profile.region))
                        LabeledContent("Phone ID", value: String(format: "%08X", profile.origin))
                        LabeledContent("Key fingerprint", value: String(profile.keyFingerprint.prefix(16)))
                        Text("The fingerprint identifies the key without revealing it. Newly issued profiles each have a different content key.").font(.caption).foregroundStyle(.secondary)
                    }
                } else { Text("Get your phone’s private profile file from the hub operator to join this region.") }
                Button("Import private profile") { importing = true }.frame(minHeight: 44)
                DisclosureGroup("Paste a profile") {
                    SecureField("Private profile JSON", text: $profileText).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Save profile securely") { model.importProfile(profileText); profileText = "" }.disabled(profileText.isEmpty).frame(minHeight: 44)
                }
            } header: { Text("Your phone") } footer: { Text("Keep this profile private. Other companions can carry an encrypted request without opening it. Ask the operator to replace older shared-key profiles.") }
            Section {
                Button { showingDevices = true } label: {
                    LabeledContent("Companion", value: model.radio.ready ? "Connected" : "Connect")
                }.frame(minHeight: 44)
                Text(model.radio.status).font(.subheadline).foregroundStyle(.secondary)
            } header: { Text("Radio connection") }
            Section {
                DisclosureGroup("How delivery works") {
                    Text("Your phone sends through Bluetooth to your companion. LoRa relays carry the encrypted request to the local hub.")
                    Text("The USB cable supplies power. Keep the app open during sending; iOS may pause background work. Saved requests resume when you reconnect.")
                    Text("A hub receipt confirms delivery to that hub. Operator reviewed means a person marked it reviewed. Neither confirms emergency-service dispatch.")
                    Text("Attach the matching antenna before powering a radio. Confirm its frequency with the hub operator.")
                }
                Text("This demonstration has no connection to emergency services.").font(.subheadline).foregroundStyle(.secondary)
            } header: { Text("About this demonstration") }
            Section {
                DisclosureGroup("Local radio-free check") {
                    Button("Check encryption locally") { model.runCodecDemo() }.frame(minHeight: 44)
                    if let result = model.demoResult { Text(result).font(.subheadline).textSelection(.enabled) }
                    Text("Uses synthetic data only. This does not send a request or change its delivery status.").font(.caption).foregroundStyle(.secondary)
                }
                Button("Clear report history and profile", role: .destructive) { clearing = true }.frame(minHeight: 44)
                if !model.lastAction.isEmpty { Text(model.lastAction).font(.caption).foregroundStyle(.secondary) }
            } header: { Text("Report data") } footer: { Text("Report drafts and history are encrypted and excluded from backups. Clearing them does not delete hub reports or Temoc chats. Manage chats in Temoc’s history.") }
        }
        .navigationTitle("Setup").privacySensitive()
        .sheet(isPresented: $showingDevices) { DevicePicker().environmentObject(model) }
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
        .confirmationDialog("Delete this phone’s requests, draft and profile?", isPresented: $clearing, titleVisibility: .visible) {
            Button("Delete local data", role: .destructive) { model.clearLocalData() }
        } message: { Text("Requests already received remain on the hub. Requests waiting on this phone will be lost.") }
    }
}

private func actionArea<Content: View>(@ViewBuilder content: () -> Content) -> some View {
    VStack(spacing: 12, content: content).padding(.horizontal, 24).padding(.vertical, 16)
        .frame(maxWidth: .infinity).background(Color(uiColor: .systemBackground))
}

private extension View {
    func reportCard() -> some View {
        padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }
    func primaryActionLabel() -> some View { font(.headline).frame(maxWidth: .infinity, minHeight: 38) }
    func secondaryFootnote() -> some View { font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true) }
}
