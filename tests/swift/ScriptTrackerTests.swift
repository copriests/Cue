import XCTest
@testable import CueTracking
final class ScriptTrackerTests: XCTestCase {
  func testPartialTranscriptRevisionsDoNotAdvanceTwice() {
    var tracker = ScriptTracker(); tracker.load("go go slow and breathe")
    tracker.follow("go"); XCTAssertEqual(tracker.index, 1)
    tracker.follow("go"); XCTAssertEqual(tracker.index, 1)
    tracker.follow("go go"); XCTAssertEqual(tracker.index, 2)
    tracker.follow("go go slow"); XCTAssertEqual(tracker.index, 3)
  }
  func testUnknownWordsDoNotRunAway() {
    var tracker = ScriptTracker(); tracker.load("one two three four")
    tracker.follow("something entirely unrelated")
    XCTAssertEqual(tracker.index, 0)
  }
  func testNormalizationAndBoundedPhraseSkip() {
    var tracker = ScriptTracker(); tracker.load("Hello, café! Take a breath.")
    tracker.follow("hello cafe"); XCTAssertEqual(tracker.index, 2)
    tracker.follow("take a breath"); XCTAssertEqual(tracker.index, 5)
  }
  func testDoesNotJumpToDistantRepeatedPhrase() {
    var tracker = ScriptTracker()
    tracker.load("start " + Array(repeating: "filler", count: 40).joined(separator: " ") + " distant phrase")
    tracker.follow("distant phrase"); XCTAssertEqual(tracker.index, 0)
  }
  func testEmptyAndReload() {
    var tracker = ScriptTracker(); tracker.load(""); tracker.follow("hello")
    XCTAssertEqual(tracker.index, 0)
    tracker.load("hello there"); tracker.follow("hello"); XCTAssertEqual(tracker.index, 1)
    tracker.load("hello again"); tracker.follow("hello"); XCTAssertEqual(tracker.index, 1)
  }
}
