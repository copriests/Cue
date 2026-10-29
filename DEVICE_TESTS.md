# Physical iPhone acceptance tests

All native checks below are pending. Record device/iOS version and outcome.

1. Build with Xcode; confirm CueNative is linked, visible preview has video frames.
2. Edit a script; switch scripts immediately; close/relaunch; confirm both edits survive.
3. Deny microphone / deny speech independently. Confirm clear error and timed mode works.
4. Enable voice; read, pause 10 seconds, resume, repeat words; cursor must not run away.
5. Read repeated phrases, punctuation, accented words, numbers; confirm bounded jumps.
6. Reach script end; restart; cancel countdown; background during countdown; no late mic start.
7. Start timed PiP; switch to native Camera; record front/rear video for 2 minutes.
   Check uninterrupted script, usable Camera audio, no script burned into saved video.
8. Start voice PiP; open Camera and record. Document interruption and recovery.
   Do not mark simultaneous use supported unless this succeeds consistently.
9. Start PiP over other target apps. Document compatibility per app/device/version.
10. PiP resize, corner moves, close, return-to-app, pause/play and skip controls.
11. Phone call / Siri / headphones / microphone route changes / screen locking.
12. Voice sessions of 30 seconds, 2 minutes, 5 minutes; no crash or silent frozen state.
13. Airplane-mode voice after language installation; unsupported language resources.
14. Landscape, iPad, accessibility text size, VoiceOver labels, thermal and battery use.
15. Autosave storage failure and app relaunch; errors must not claim a successful save.

Release gate: physical-device tests, Swift compile, microphone privacy review,
accurate store claims, and App Review suitability assessment remain required.
