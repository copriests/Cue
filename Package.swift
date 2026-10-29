// swift-tools-version: 5.9
import PackageDescription
let package = Package(
  name: "CueTracking",
  products: [.library(name: "CueTracking", targets: ["CueTracking"])],
  targets: [
    .target(name: "CueTracking", path: "modules/cue-native/ios", exclude: ["CueNativeModule.swift", "CueNative.podspec"], sources: ["ScriptTracker.swift"]),
    .testTarget(name: "CueTrackingTests", dependencies: ["CueTracking"], path: "tests/swift")
  ]
)
