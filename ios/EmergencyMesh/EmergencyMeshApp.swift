import SwiftUI

@main
struct EmergencyMeshApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(model)
                .overlay {
                    if scenePhase != .active {
                        Color(uiColor: .systemBackground).ignoresSafeArea().overlay {
                            Label("EmergencyMesh", systemImage: "antenna.radiowaves.left.and.right").font(.title2.weight(.semibold))
                        }
                    }
                }
                .onChange(of: scenePhase) { _, phase in if phase == .active { model.pump() } }
        }
    }
}
