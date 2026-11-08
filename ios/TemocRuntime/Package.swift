// swift-tools-version: 5.9
import PackageDescription
import Foundation

// The handoff ZIP includes the verified official binary. Source-only checkouts
// resolve the exact same archive through Swift Package Manager.
let localBinary = "Vendor/llama.xcframework"
let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let binary: Target = FileManager.default.fileExists(atPath: packageDirectory.appendingPathComponent(localBinary).path)
    ? .binaryTarget(name: "llama", path: localBinary)
    : .binaryTarget(name: "llama",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b5046/llama-b5046-xcframework.zip",
        checksum: "c19be78b5f00d8d29a25da41042cb7afa094cbf6280a225abe614b03b20029ab")

let package = Package(
    name: "TemocRuntime",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "TemocRuntime", targets: ["TemocRuntime"]),
               .executable(name: "TemocSmokeCheck", targets: ["TemocSmokeCheck"])],
    targets: [binary, .target(name: "TemocRuntime", dependencies: ["llama"],
        path: "Sources/TemocRuntime",
        linkerSettings: [.linkedFramework("Metal"), .linkedFramework("Accelerate")]),
        .executableTarget(name: "TemocSmokeCheck", dependencies: ["TemocRuntime"], path: "Sources/TemocSmokeCheck")],
    swiftLanguageVersions: [.v5]
)
