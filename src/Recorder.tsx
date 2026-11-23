import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import { shareAsync } from "expo-sharing";

type Phase = "ready" | "countdown" | "recording" | "finishing" | "review";
type Quality = "1080p" | "2160p";

function Control({ title, action, disabled = false }: {
  title: string;
  action: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={action}
      style={[styles.control, disabled && styles.disabled]}>
      <Text style={styles.controlText}>{title}</Text>
    </Pressable>
  );
}

export function Recorder({ words, pace, fontSize, onClose }: {
  words: string[];
  pace: number;
  fontSize: number;
  onClose: () => void;
}) {
  useKeepAwake("cue-recorder");
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [quality, setQuality] = useState<Quality>("1080p");
  const [wpm, setWpm] = useState(pace);
  const [size, setSize] = useState(fontSize);
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const pending = useRef<ReturnType<typeof setInterval> | null>(null);
  const [count, setCount] = useState(3);
  const [index, setIndex] = useState(0);
  const [clip, setClip] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  function transition(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function cancelCountdown() {
    if (pending.current !== null) clearInterval(pending.current);
    pending.current = null;
    transition("ready");
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      if (phaseRef.current === "countdown") {
        if (pending.current !== null) clearInterval(pending.current);
        pending.current = null;
        phaseRef.current = "ready";
        setPhase("ready");
      } else if (state === "background" && phaseRef.current === "recording") {
        phaseRef.current = "finishing";
        setPhase("finishing");
        camera.current?.stopRecording();
      }
    });
    return () => {
      subscription.remove();
      if (pending.current !== null) clearInterval(pending.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const start = performance.now();
    const timer = setInterval(() => {
      setIndex(Math.min(words.length, Math.floor((performance.now() - start) * wpm / 60_000)));
    }, 100);
    return () => clearInterval(timer);
  }, [phase, words.length, wpm]);

  async function record() {
    const activeCamera = camera.current;
    if (!activeCamera || AppState.currentState !== "active") {
      transition("ready");
      return;
    }
    transition("recording");
    try {
      const result = await activeCamera.recordAsync({ codec: "avc1" });
      if (!result?.uri) throw new Error("Cue did not receive a video file.");
      setClip(result.uri);
      transition("review");
    } catch (error) {
      transition("ready");
      Alert.alert("Recording couldn’t finish", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function startCountdown() {
    if (!ready || phaseRef.current !== "ready") return;
    setIndex(0);
    setCount(3);
    transition("countdown");
    let remaining = 3;
    pending.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setCount(remaining);
        return;
      }
      if (pending.current !== null) clearInterval(pending.current);
      pending.current = null;
      void record();
    }, 1000);
  }

  function stop() {
    if (phaseRef.current !== "recording") return;
    transition("finishing");
    camera.current?.stopRecording();
  }

  function discard(action: () => void) {
    Alert.alert("Leave this recording?", "Use Save or share video to keep a copy before leaving.", [
      { text: "Keep here", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: action },
    ]);
  }

  async function share() {
    if (!clip || sharing) return;
    setSharing(true);
    try {
      await shareAsync(clip, { UTI: "public.movie" });
    } catch {
      Alert.alert("Couldn’t share the video", "Your recording is still here. Please try again.");
    } finally {
      setSharing(false);
    }
  }

  async function allowRecording() {
    try {
      if (!cameraPermission?.granted && !(await requestCamera()).granted) return;
      if (!micPermission?.granted) await requestMic();
    } catch {
      Alert.alert("Couldn’t request access", "Check Cue’s permissions in Settings.");
    }
  }

  if (!cameraPermission?.granted || !micPermission?.granted) {
    const blocked = cameraPermission?.canAskAgain === false && !cameraPermission.granted
      || micPermission?.canAskAgain === false && !micPermission.granted;
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.message}>
          <Text accessibilityRole="header" style={styles.heading}>Record in Cue</Text>
          <Text style={styles.controlText}>{blocked
            ? "Allow Camera and Microphone access for Cue in iPhone Settings."
            : "Cue uses the camera and microphone to record your video."}</Text>
          {!blocked && <Control title="Allow camera and microphone" action={() => void allowRecording()}
            disabled={!cameraPermission || !micPermission} />}
          <Control title="Back to script" action={onClose} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "review") {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.message}>
          <Text accessibilityRole="header" style={styles.heading}>Recording ready</Text>
          <Text style={styles.controlText}>Save or share your video before leaving this screen.</Text>
          <Control title="Save or share video" action={() => void share()} disabled={sharing} />
          <Control title="Record another take" disabled={sharing} action={() => discard(() => {
            setClip(null);
            setIndex(0);
            setReady(false);
            transition("ready");
          })} />
          <Control title="Back to script" action={() => discard(onClose)} disabled={sharing} />
        </View>
      </SafeAreaView>
    );
  }

  const idle = phase === "ready";
  const line = words.slice(index, index + 15).join(" ");
  return (
    <View style={styles.screen}>
      <CameraView key={facing} ref={camera} style={StyleSheet.absoluteFill} facing={facing}
        mode="video" videoQuality={quality} onCameraReady={() => setReady(true)}
        onMountError={({ message }) => {
          setReady(false);
          Alert.alert("Camera unavailable", message);
        }} />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.toolbar}>
          <Control title="Back" action={onClose} disabled={!idle} />
          <Control title="Flip camera" action={() => {
            setReady(false);
            setFacing(facing === "front" ? "back" : "front");
          }} disabled={!idle} />
          <Control title={quality === "2160p" ? "4K preferred" : "1080p"} action={() =>
            setQuality(quality === "2160p" ? "1080p" : "2160p")} disabled={!idle} />
        </View>
        <View pointerEvents="none" style={styles.prompt}>
          <Text style={[styles.controlText, { fontSize: Math.min(size, 56) }]}
            numberOfLines={4}>{line || "End of script"}</Text>
        </View>
        <View style={styles.spacer} pointerEvents="none">
          {phase === "countdown" && <Text accessibilityLiveRegion="polite" style={styles.count}>{count}</Text>}
        </View>
        <View style={styles.footer}>
          {idle && <>
            <View style={styles.toolbar}>
              <Control title="Slower" action={() => setWpm(Math.max(40, wpm - 10))} />
              <Text style={styles.controlText}>{wpm} wpm</Text>
              <Control title="Faster" action={() => setWpm(Math.min(300, wpm + 10))} />
            </View>
            <View style={styles.toolbar}>
              <Control title="Smaller text" action={() => setSize(Math.max(18, size - 4))} />
              <Control title="Larger text" action={() => setSize(Math.min(56, size + 4))} />
            </View>
          </>}
          <Control title={idle ? "Start recording" : phase === "countdown" ? "Cancel countdown"
            : phase === "recording" ? "Stop recording" : "Finishing…"}
            action={idle ? startCountdown : phase === "countdown" ? cancelCountdown : stop}
            disabled={phase === "finishing" || (idle && !ready)} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#090f0f" },
  overlay: { flex: 1, justifyContent: "space-between" },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", flexWrap: "wrap", gap: 6, paddingHorizontal: 8 },
  control: { backgroundColor: "#172320", borderColor: "#637867", borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10 },
  disabled: { opacity: 0.55 },
  controlText: { color: "#fff", fontWeight: "600", textAlign: "center" },
  heading: { color: "#b9f36b", fontSize: 28, fontWeight: "700", textAlign: "center" },
  prompt: { backgroundColor: "rgba(8,14,13,0.84)", margin: 12, padding: 14, borderRadius: 16 },
  spacer: { flex: 1, alignItems: "center", justifyContent: "center" },
  count: { color: "#fff", fontSize: 70, fontWeight: "800" },
  footer: { backgroundColor: "rgba(8,14,13,0.84)", padding: 10, gap: 6, alignItems: "center" },
  message: { flex: 1, gap: 18, padding: 24, justifyContent: "center", alignItems: "center" },
});
