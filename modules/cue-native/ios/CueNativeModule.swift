import ExpoModulesCore
import AVKit
import Speech

public final class CueNativeModule: Module {
  private let engine = CueEngine()
  public func definition() -> ModuleDefinition {
    Name("CueNative")
    Events("onState")
    OnCreate { [weak self] in
      self?.engine.onState = { [weak self] state in self?.sendEvent("onState", state) }
    }
    OnDestroy { [weak self] in DispatchQueue.main.async { self?.engine.shutdown() } }
    Function("configure") { (text: String, wpm: Double, fontSize: Double, mirror: Bool, voice: Bool) in
      DispatchQueue.main.async { self.engine.configure(text, wpm: wpm, fontSize: fontSize, mirror: mirror, voice: voice) }
    }
    Function("play") { DispatchQueue.main.async { self.engine.play() } }
    Function("pause") { DispatchQueue.main.async { self.engine.pause() } }
    Function("seek") { (index: Int) in DispatchQueue.main.async { self.engine.seek(index) } }
    Function("stopSpeech") { DispatchQueue.main.async { self.engine.stopSpeech() } }
    Function("stopPiP") { DispatchQueue.main.async { self.engine.stopPiP() } }
    AsyncFunction("startSpeech") { (promise: Promise) in
      DispatchQueue.main.async { self.engine.startSpeech(promise) }
    }
    AsyncFunction("startPiP") { (promise: Promise) in
      DispatchQueue.main.async { self.engine.startPiP(promise) }
    }
    View(CuePreviewView.self) {
      OnViewDidUpdateProps { (view: CuePreviewView) in view.attach(self.engine) }
    }
  }
}

final class CuePreviewView: ExpoView {
  private weak var engine: CueEngine?
  func attach(_ engine: CueEngine) {
    self.engine = engine
    engine.attach(to: self)
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    engine?.displayLayer.frame = bounds
  }
}

final class CueEngine: NSObject, AVPictureInPictureControllerDelegate, AVPictureInPictureSampleBufferPlaybackDelegate {
  let displayLayer = AVSampleBufferDisplayLayer()
  var onState: (([String: Any]) -> Void)?
  private var tracker = ScriptTracker()
  private var script = ""
  private var wpm = 130.0
  private var fontSize = 42.0
  private var mirror = false
  private var voice = false
  private var playing = false
  private var listening = false
  private var message = "Ready when you are"
  private var timer: Timer?
  private var lastTick = CACurrentMediaTime()
  private var progress = 0.0
  private var lastEmit = 0.0
  private var pip: AVPictureInPictureController?
  private var pendingPiP: Promise?
  private var pipTimeout: DispatchWorkItem?
  private var pipObservation: NSKeyValueObservation?
  private let audioEngine = AVAudioEngine()
  private var recognizer: SFSpeechRecognizer?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var tapInstalled = false
  private var speechGeneration = 0
  private var speechStarting = false
  private var interruptionObserver: NSObjectProtocol?
  private var backgroundObserver: NSObjectProtocol?
  private var foregroundObserver: NSObjectProtocol?
  override init() {
    super.init()
    displayLayer.videoGravity = .resizeAspect
    interruptionObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.stopSpeech()
      self.playing = false
      self.message = "Microphone interrupted. Return to Cue to restart voice tracking or use timed scrolling."
      self.emit()
    }
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self, self.pip?.isPictureInPictureActive != true else { return }
      self.pause()
    }
    foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in self?.emit() }
    timer = Timer(timeInterval: 1.0 / 15.0, repeats: true) { [weak self] _ in self?.tick() }
    RunLoop.main.add(timer!, forMode: .common)
  }
  func attach(to view: UIView) {
    if displayLayer.superlayer !== view.layer {
      displayLayer.removeFromSuperlayer()
      view.layer.addSublayer(displayLayer)
    }
    displayLayer.frame = view.bounds
    if pip == nil, AVPictureInPictureController.isPictureInPictureSupported() {
      let source = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: displayLayer, playbackDelegate: self)
      pip = AVPictureInPictureController(contentSource: source)
      pip?.delegate = self
      pip?.canStartPictureInPictureAutomaticallyFromInline = false
      pipObservation = pip?.observe(\.isPictureInPicturePossible, options: [.new]) { [weak self] controller, _ in
        DispatchQueue.main.async {
          if self?.pendingPiP != nil, controller.isPictureInPicturePossible { controller.startPictureInPicture() }
        }
      }
    }
    render()
  }
  func configure(_ text: String, wpm: Double, fontSize: Double, mirror: Bool, voice: Bool) {
    if script != text { script = text; tracker.load(text); progress = 0 }
    self.wpm = min(300, max(40, wpm)); self.fontSize = min(72, max(24, fontSize)); self.mirror = mirror
    if self.voice != voice { pause(); self.voice = voice }
    render(); emit()
  }
  func play() {
    guard !tracker.words.isEmpty else { return }
    if tracker.index >= tracker.words.count { seek(0) }
    if voice && !listening { message = "Tap Start to enable voice tracking"; emit(); return }
    playing = true; lastTick = CACurrentMediaTime(); message = voice ? "Listening · follow your script" : "Timed scrolling"; emit()
  }
  func pause() { playing = false; stopSpeech(); pip?.invalidatePlaybackState(); emit() }
  func seek(_ index: Int) { tracker.index = max(0, min(index, tracker.words.count)); progress = Double(tracker.index); tracker.resetTranscript(); render(); emit() }
  private func tick() {
    let now = CACurrentMediaTime(); let elapsed = min(now - lastTick, 0.25); lastTick = now
    if playing && !voice {
      progress += elapsed * wpm / 60
      tracker.index = min(tracker.words.count, Int(progress))
    }
    if playing && tracker.index >= tracker.words.count { pause(); message = "Script complete"; emit() }
    if UIApplication.shared.applicationState == .active || pip?.isPictureInPictureActive == true || pendingPiP != nil { render() }
    if now - lastEmit > 0.2 { emit(); lastEmit = now }
  }
  private func emit() {
    onState?(["index": tracker.index, "playing": playing, "listening": listening,
              "pip": pip?.isPictureInPictureActive ?? false, "message": message])
  }
  func startSpeech(_ promise: Promise) {
    guard !speechStarting else { promise.reject("SPEECH_BUSY", "Speech permission request is already in progress."); return }
    stopSpeech(); speechStarting = true
    let generation = speechGeneration
    SFSpeechRecognizer.requestAuthorization { status in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        DispatchQueue.main.async {
          guard generation == self.speechGeneration else { promise.reject("CANCELLED", "Voice tracking was cancelled."); return }
          self.speechStarting = false
          guard status == .authorized, granted else { promise.reject("PERMISSION", "Enable Microphone and Speech Recognition in iOS Settings."); return }
          do { try self.beginRecognition(generation); promise.resolve(nil) }
          catch { self.stopSpeech(); promise.reject("SPEECH", error.localizedDescription) }
        }
      }
    }
  }
  private func beginRecognition(_ generation: Int) throws {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-GB")), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
      throw NSError(domain: "Cue", code: 1, userInfo: [NSLocalizedDescriptionKey: "On-device English speech recognition is unavailable. Check iOS language downloads or use timed mode."])
    }
    guard UIApplication.shared.applicationState == .active else { throw NSError(domain: "Cue", code: 3, userInfo: [NSLocalizedDescriptionKey: "Return to Cue before starting voice tracking."]) }
    tracker.resetTranscript()
    self.recognizer = recognizer
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker])
    try session.setActive(true)
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    self.request = request
    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw NSError(domain: "Cue", code: 2, userInfo: [NSLocalizedDescriptionKey: "No microphone input is available."]) }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in request?.append(buffer) }
    tapInstalled = true
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      DispatchQueue.main.async {
        guard let self, generation == self.speechGeneration else { return }
        if let result, self.playing {
          self.tracker.follow(result.bestTranscription.formattedString)
          self.progress = Double(self.tracker.index)
          self.render(); self.emit()
        }
        if error != nil || result?.isFinal == true {
          self.stopSpeech(); self.playing = false
          self.message = error == nil ? "Voice session ended. Tap Start to continue." : "Voice tracking stopped. Tap Start to retry or use timed mode."
          self.emit()
        }
      }
    }
    audioEngine.prepare(); try audioEngine.start()
    listening = true; playing = true; message = "Listening · follow your script"; emit()
  }
  func stopSpeech() {
    speechGeneration += 1; speechStarting = false
    audioEngine.stop()
    if tapInstalled { audioEngine.inputNode.removeTap(onBus: 0); tapInstalled = false }
    request?.endAudio(); task?.cancel(); task = nil; request = nil; recognizer = nil
    listening = false
    if pip?.isPictureInPictureActive != true { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    emit()
  }
  func startPiP(_ promise: Promise) {
    guard let pip else { promise.reject("PIP_UNAVAILABLE", "Picture in Picture is unavailable. Use a supported physical iPhone and a development build."); return }
    guard pendingPiP == nil else { promise.reject("PIP_BUSY", "Picture in Picture is already starting."); return }
    if pip.isPictureInPictureActive { promise.resolve(nil); return }
    do {
      if !listening {
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playback, mode: .moviePlayback, options: [.mixWithOthers])
        try audio.setActive(true)
      }
      pendingPiP = promise
      render()
      if pip.isPictureInPicturePossible { pip.startPictureInPicture() }
      let timeout = DispatchWorkItem { [weak self] in
        self?.pendingPiP?.reject("PIP_TIMEOUT", "iOS could not start the floating window. Keep the preview visible and try again.")
        self?.pendingPiP = nil
      }
      pipTimeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: timeout)
    } catch { promise.reject("PIP_AUDIO", error.localizedDescription) }
  }
  func stopPiP() { pip?.stopPictureInPicture() }
  func shutdown() {
    timer?.invalidate(); timer = nil; stopSpeech(); stopPiP()
    pendingPiP?.reject("CANCELLED", "Cue closed."); pendingPiP = nil; pipTimeout?.cancel()
    for observer in [interruptionObserver, backgroundObserver, foregroundObserver] { if let observer { NotificationCenter.default.removeObserver(observer) } }
  }
  func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
    pipTimeout?.cancel(); pendingPiP?.resolve(nil); pendingPiP = nil; emit()
  }
  func pictureInPictureController(_ controller: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
    pipTimeout?.cancel(); pendingPiP?.reject("PIP_FAILED", error.localizedDescription); pendingPiP = nil; emit()
  }
  func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
    pause()
  }
  func pictureInPictureController(_ controller: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) { completionHandler(true) }
  func pictureInPictureController(_ controller: AVPictureInPictureController, setPlaying playing: Bool) { playing ? play() : pause() }
  func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool { !playing }
  func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange { CMTimeRange(start: .zero, duration: .positiveInfinity) }
  func pictureInPictureController(_ controller: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}
  func pictureInPictureController(_ controller: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion completionHandler: @escaping () -> Void) { seek(tracker.index + Int(skipInterval.seconds * wpm / 60)); completionHandler() }

  // Actual video frames, not an unsupported arbitrary UI overlay or video-call API.
  private func render() {
    guard displayLayer.isReadyForMoreMediaData || displayLayer.status == .failed else { return }
    if displayLayer.status == .failed { displayLayer.flush() }
    let width = 960, height = 540
    var pixel: CVPixelBuffer?
    guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
      [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &pixel) == kCVReturnSuccess,
      let pixel else { return }
    CVPixelBufferLockBaseAddress(pixel, [])
    defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
    guard let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height,
      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else { return }
    context.setFillColor(UIColor(red: 0.035, green: 0.05, blue: 0.05, alpha: 1).cgColor)
    context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    context.translateBy(x: 0, y: CGFloat(height)); context.scaleBy(x: 1, y: -1)
    if mirror { context.translateBy(x: CGFloat(width), y: 0); context.scaleBy(x: -1, y: 1) }
    UIGraphicsPushContext(context)
    let start = max(0, min(tracker.index, tracker.words.count))
    let end = min(tracker.words.count, start + 40)
    let text = start < end ? tracker.words[start..<end].joined(separator: " ") : "Take a breath. You're done."
    let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 14
    let attributed = NSMutableAttributedString(string: text, attributes: [.font: UIFont.systemFont(ofSize: CGFloat(fontSize), weight: .semibold), .foregroundColor: UIColor.white, .paragraphStyle: paragraph])
    if start < end { attributed.addAttribute(.foregroundColor, value: UIColor(red: 0.71, green: 0.96, blue: 0.38, alpha: 1), range: NSRange(location: 0, length: (tracker.words[start] as NSString).length)) }
    attributed.draw(with: CGRect(x: 48, y: 72, width: 864, height: 420), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
    let label = voice ? (listening ? "CUE  /  VOICE FOLLOW" : "CUE  /  VOICE PAUSED") : "CUE  /  TIMED"
    (label as NSString).draw(at: CGPoint(x: 48, y: 26), withAttributes: [.font: UIFont.monospacedSystemFont(ofSize: 18, weight: .medium), .foregroundColor: UIColor.lightGray])
    UIGraphicsPopContext()
    var description: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel, formatDescriptionOut: &description) == noErr, let description else { return }
    var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 15), presentationTimeStamp: CMTime(seconds: CACurrentMediaTime(), preferredTimescale: 600), decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixel, formatDescription: description, sampleTiming: &timing, sampleBufferOut: &sample) == noErr, let sample else { return }
    if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true) as? [NSMutableDictionary], let first = attachments.first { first[kCMSampleAttachmentKey_DisplayImmediately] = true }
    displayLayer.enqueue(sample)
  }
}
