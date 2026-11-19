import Foundation

// Bounded, forward-only phrase alignment. Repeated words alone never jump ahead.
struct ScriptTracker {
  private(set) var words: [String] = []
  private var normalized: [String] = []
  var index = 0
  private var lastTranscript = ""
  mutating func resetTranscript() { lastTranscript = "" }
  static func normalize(_ value: String) -> String {
    value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_GB"))
      .components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
  }
  mutating func load(_ text: String) {
    words = text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    normalized = words.map(Self.normalize)
    index = 0; lastTranscript = ""
  }
  mutating func follow(_ transcript: String) {
    guard transcript != lastTranscript else { return }
    lastTranscript = transcript
    let heard = transcript.split(whereSeparator: { $0.isWhitespace }).map { Self.normalize(String($0)) }.filter { !$0.isEmpty }
    guard !words.isEmpty, !heard.isEmpty else { return }
    // Longest suffix first; match revised partial transcripts without advancing twice.
    for length in stride(from: min(6, heard.count), through: 1, by: -1) {
      let suffix = Array(heard.suffix(length))
      let lower = max(0, index - 6)
      let upper = min(words.count - length, index + (length == 1 ? 0 : 18))
      guard lower <= upper else { continue }
      for start in lower...upper where Array(normalized[start..<(start + length)]) == suffix {
        let next = start + length
        if next > index { index = min(words.count, next); return }
      }
    }
  }
}
