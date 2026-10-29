import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Cue, CuePreview, CueState } from "./src/native";
import { duration, parseScripts, SAMPLE, Script, words } from "./src/model";

const KEY = "cue.scripts.v1";
const initial: CueState = {
  index: 0,
  playing: false,
  listening: false,
  pip: false,
  message: "Ready when you are",
};
function Button({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        primary && s.primary,
        (pressed || disabled) && { opacity: 0.5 },
      ]}
    >
      <Text style={[s.buttonText, primary && { color: "#142007" }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export default function App() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState("welcome");
  const [title, setTitle] = useState("A little cue");
  const [text, setText] = useState(SAMPLE);
  const [screen, setScreen] = useState<"write" | "read">("write");
  const [mode, setMode] = useState<"timed" | "voice">("timed");
  const [wpm, setWpm] = useState(130);
  const [font, setFont] = useState(42);
  const [mirror, setMirror] = useState(false);
  const [state, setState] = useState(initial);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const generation = useRef(0);
  const saveChain = useRef(Promise.resolve());
  const scriptsRef = useRef<Script[]>([]);
  const currentRef = useRef({ id: selected, title, text });
  currentRef.current = { id: selected, title, text };
  function saveCurrent() {
    if (!ready) return;
    const updated = { ...currentRef.current, updatedAt: Date.now() };
    const list = scriptsRef.current.some((x) => x.id === updated.id)
      ? scriptsRef.current.map((x) => (x.id === updated.id ? updated : x))
      : [updated, ...scriptsRef.current];
    scriptsRef.current = list;
    setScripts(list);
    saveChain.current = saveChain.current
      .then(() => AsyncStorage.setItem(KEY, JSON.stringify(list)))
      .then(() => setStorageError(""))
      .catch(() =>
        setStorageError(
          "Saving failed. Keep Cue open and copy your script before closing.",
        ),
      );
  }
  const tokens = words(text);
  const locked = state.playing || state.pip || busy || countdown !== null;
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!alive) return;
        const saved = parseScripts(raw);
        const list = saved.length
          ? saved
          : [
              {
                id: "welcome",
                title: "A little cue",
                text: SAMPLE,
                updatedAt: Date.now(),
              },
            ];
        scriptsRef.current = list;
        setScripts(list);
        setSelected(list[0].id);
        setTitle(list[0].title);
        setText(list[0].text);
        setReady(true);
      })
      .catch(() => {
        if (alive) {
          setStorageError(
            "Could not load saved scripts. Restart Cue before editing to protect your saved work.",
          );
        }
      });
    const subscription = Cue?.addListener("onState", setState);
    const app = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        generation.current++;
        setCountdown(null);
      }
    });
    return () => {
      alive = false;
      generation.current++;
      subscription?.remove();
      app.remove();
      Cue?.pause();
      Cue?.stopPiP();
    };
  }, []);
  useEffect(() => {
    Cue?.configure(text, wpm, font, mirror, mode === "voice");
  }, [text, wpm, font, mirror, mode]);
  useEffect(() => {
    if (screen === "read") {
      void activateKeepAwakeAsync("cue").catch(() => {});
    } else {
      void deactivateKeepAwake("cue");
    }
    return () => {
      void deactivateKeepAwake("cue");
    };
  }, [screen]);
  async function start() {
    if (!Cue) {
      Alert.alert(
        "Native build needed",
        "Voice tracking and floating mode need the iOS development build. See README.md in the project.",
      );
      return;
    }
    if (state.playing || busy || countdown !== null) {
      generation.current++;
      setCountdown(null);
      Cue.pause();
      return;
    }
    const run = ++generation.current;
    for (let count = 3; count > 0; count--) {
      if (generation.current !== run) return;
      setCountdown(count);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (generation.current !== run) return;
    setCountdown(null);
    setBusy(true);
    try {
      if (mode === "voice") await Cue.startSpeech();
      else Cue.play();
    } catch (error) {
      Alert.alert("Could not start", String(error));
    } finally {
      setBusy(false);
    }
  }
  async function float() {
    if (!Cue) {
      Alert.alert(
        "Native build needed",
        "Floating mode requires the native iOS build, not Expo Go.",
      );
      return;
    }
    setBusy(true);
    try {
      await Cue.startPiP();
    } catch (error) {
      Alert.alert("Floating window", String(error));
    } finally {
      setBusy(false);
    }
  }
  function choose(script: Script) {
    saveCurrent();
    generation.current++;
    Cue?.pause();
    setSelected(script.id);
    setTitle(script.title);
    setText(script.text);
    setState(initial);
  }
  function newScript() {
    choose({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "Untitled script",
      text: "",
      updatedAt: Date.now(),
    });
    setScreen("write");
  }
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.header}>
          <View>
            <Text style={s.brand}>
              cue<Text style={{ color: "#b9f36b" }}>.</Text>
            </Text>
            <Text style={s.tag}>YOUR WORDS. YOUR PACE.</Text>
          </View>
          <View style={s.pill}>
            <View style={s.dot} />
            <Text style={s.pillText}>ON YOUR DEVICE</Text>
          </View>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          <Text style={s.eyebrow}>A LITTLE HELP. ALL YOU.</Text>
          <Text style={s.heading}>Find your words.{"\n"}Keep your flow.</Text>
          {storageError ? (
            <Text accessibilityRole="alert" style={s.warning}>
              {storageError}
            </Text>
          ) : null}
          {!Cue && (
            <Text style={s.warning}>
              Preview mode · Install the iOS development build for voice
              tracking and the floating window.
            </Text>
          )}
          <View style={s.tabs}>
            <Button
              label="01  Script"
              onPress={() => {
                if (!locked) setScreen("write");
              }}
              primary={screen === "write"}
              disabled={locked}
            />
            <Button
              label="02  Rehearse"
              onPress={() => setScreen("read")}
              primary={screen === "read"}
              disabled={!ready || !tokens.length}
            />
          </View>
          {screen === "write" ? (
            <>
              <View style={s.row}>
                <Text style={s.section}>YOUR SCRIPTS</Text>
                <Button label="+ New" onPress={newScript} disabled={!ready} />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {scripts.map((script) => (
                  <Pressable
                    key={script.id}
                    onPress={() => choose(script)}
                    style={[
                      s.scriptChip,
                      selected === script.id && { borderColor: "#b9f36b" },
                    ]}
                  >
                    <Text style={s.white}>
                      {script.title || "Untitled script"}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={s.card}>
                <TextInput
                  accessibilityLabel="Script title"
                  editable={ready}
                  value={title}
                  onChangeText={(value) => {
                    setTitle(value);
                    currentRef.current.title = value;
                    saveCurrent();
                  }}
                  placeholder="Give your script a title"
                  placeholderTextColor="#798980"
                  style={s.titleInput}
                />
                <View style={s.rule} />
                <TextInput
                  accessibilityLabel="Script text"
                  editable={ready}
                  multiline
                  textAlignVertical="top"
                  value={text}
                  onChangeText={(value) => {
                    setText(value);
                    currentRef.current.text = value;
                    saveCurrent();
                  }}
                  placeholder="Something worth saying…"
                  placeholderTextColor="#798980"
                  style={s.editor}
                />
                <View style={s.row}>
                  <Text style={s.muted}>{tokens.length} words</Text>
                  <Text style={s.muted}>
                    ≈ {duration(text, wpm)} at {wpm} wpm
                  </Text>
                </View>
              </View>
              <Button
                label="Rehearse this script  →"
                primary
                onPress={() => setScreen("read")}
                disabled={!ready || !tokens.length}
              />
            </>
          ) : (
            <>
              <View style={s.row}>
                <Text style={s.section}>{title || "UNTITLED SCRIPT"}</Text>
                <Text style={s.muted}>
                  {Math.min(state.index, tokens.length)} / {tokens.length}
                </Text>
              </View>
              <View style={s.preview}>
                {CuePreview ? (
                  <CuePreview style={s.nativePreview} />
                ) : (
                  <Text
                    style={[
                      s.fallback,
                      mirror && { transform: [{ scaleX: -1 }] },
                    ]}
                  >
                    {tokens.slice(state.index, state.index + 40).join(" ")}
                  </Text>
                )}
                {countdown !== null && (
                  <View style={s.countdown}>
                    <Text style={s.countText}>{countdown}</Text>
                  </View>
                )}
              </View>
              <View style={s.progress}>
                <View
                  style={[
                    s.progressFill,
                    {
                      width: `${tokens.length ? (state.index / tokens.length) * 100 : 0}%`,
                    },
                  ]}
                />
              </View>
              <Text accessibilityLiveRegion="polite" style={s.status}>
                {state.listening ? "● " : ""}
                {state.message}
              </Text>
              <View style={s.tabs}>
                <Button
                  label="Timed"
                  primary={mode === "timed"}
                  onPress={() => setMode("timed")}
                  disabled={locked}
                />
                <Button
                  label="Follow my voice"
                  primary={mode === "voice"}
                  onPress={() => setMode("voice")}
                  disabled={locked}
                />
              </View>
              <View style={s.card}>
                <Text style={s.section}>MAKE IT COMFORTABLE</Text>
                <View style={s.setting}>
                  <Text style={s.white}>Reading pace</Text>
                  <View style={s.stepper}>
                    <Button
                      label="−"
                      onPress={() => setWpm(Math.max(40, wpm - 10))}
                      disabled={locked}
                    />
                    <Text style={s.value}>{wpm} wpm</Text>
                    <Button
                      label="+"
                      onPress={() => setWpm(Math.min(300, wpm + 10))}
                      disabled={locked}
                    />
                  </View>
                </View>
                <View style={s.setting}>
                  <Text style={s.white}>Text size</Text>
                  <View style={s.stepper}>
                    <Button
                      label="A−"
                      onPress={() => setFont(Math.max(24, font - 4))}
                      disabled={locked}
                    />
                    <Text style={s.value}>{font}</Text>
                    <Button
                      label="A+"
                      onPress={() => setFont(Math.min(72, font + 4))}
                      disabled={locked}
                    />
                  </View>
                </View>
                <View style={s.setting}>
                  <Text style={s.white}>Mirror text</Text>
                  <Button
                    label={mirror ? "On" : "Off"}
                    onPress={() => setMirror(!mirror)}
                    disabled={locked}
                  />
                </View>
              </View>
              <View style={s.tabs}>
                <Button
                  label={
                    countdown !== null
                      ? "Cancel countdown"
                      : state.playing
                        ? "Pause"
                        : busy
                          ? "Starting…"
                          : "Start · 3s"
                  }
                  primary
                  onPress={() => void start()}
                  disabled={busy}
                />
                <Button
                  label="↺ Restart"
                  onPress={() => Cue?.seek(0)}
                  disabled={busy || state.pip}
                />
              </View>
              <Button
                label={
                  state.pip
                    ? "Close floating window"
                    : "Float script over other apps  ↗"
                }
                onPress={() => (state.pip ? Cue?.stopPiP() : void float())}
                disabled={busy || countdown !== null || !tokens.length}
              />
              <Text style={s.note}>
                Start scrolling, then float your script and open Camera. Voice
                tracking may stop when another app takes the microphone. Timed
                mode is the fallback. Floating mode is experimental until tested
                on your iPhone.
              </Text>
            </>
          )}
          <Text style={s.footer}>
            A breath. A glance. And you're back in flow.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: "#101a16" },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brand: {
    color: "#f2f4ed",
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: -3,
  },
  tag: { color: "#899b90", fontSize: 9, letterSpacing: 1.8 },
  pill: {
    backgroundColor: "#1b2a21",
    borderRadius: 20,
    padding: 10,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: { backgroundColor: "#b9f36b", width: 5, height: 5, borderRadius: 5 },
  pillText: { color: "#b9c9bd", fontSize: 9, letterSpacing: 1 },
  content: { padding: 24, paddingTop: 12, gap: 18, paddingBottom: 48 },
  eyebrow: { color: "#b9f36b", fontSize: 10, letterSpacing: 2 },
  heading: {
    color: "#f1f2e9",
    fontSize: 38,
    lineHeight: 44,
    fontWeight: "600",
    letterSpacing: -1.6,
  },
  tabs: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  button: {
    backgroundColor: "#24352b",
    borderRadius: 13,
    paddingHorizontal: 17,
    minHeight: 46,
    justifyContent: "center",
    alignItems: "center",
  },
  primary: { backgroundColor: "#b9f36b" },
  buttonText: { color: "#edf2e8", fontSize: 14, fontWeight: "600" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  section: {
    color: "#afc0b2",
    fontSize: 10,
    letterSpacing: 1.7,
    flexShrink: 1,
  },
  scriptChip: {
    borderColor: "#35473b",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  white: { color: "#edf2e8", fontSize: 14 },
  card: { backgroundColor: "#19271f", borderRadius: 20, padding: 20, gap: 14 },
  titleInput: {
    color: "#edf2e8",
    fontSize: 21,
    fontWeight: "600",
    minHeight: 42,
  },
  rule: { height: 1, backgroundColor: "#304035" },
  editor: { color: "#d2ddd1", fontSize: 18, lineHeight: 29, minHeight: 240 },
  muted: { color: "#91a395", fontSize: 11 },
  preview: {
    aspectRatio: 16 / 9,
    backgroundColor: "#090d0d",
    borderRadius: 18,
    overflow: "hidden",
  },
  nativePreview: { flex: 1 },
  fallback: { padding: 20, color: "#f5f5ee", fontSize: 21, lineHeight: 30 },
  progress: { height: 3, backgroundColor: "#2b3c30", borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: "#b9f36b" },
  status: { color: "#b9f36b", fontSize: 12 },
  setting: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  value: { color: "#d2ddd1", minWidth: 53, textAlign: "center", fontSize: 12 },
  note: { color: "#91a395", fontSize: 12, lineHeight: 19 },
  warning: {
    color: "#e8cb89",
    backgroundColor: "#302d1f",
    borderRadius: 12,
    padding: 13,
    fontSize: 12,
    lineHeight: 18,
  },
  footer: {
    color: "#718779",
    textAlign: "center",
    fontSize: 11,
    marginTop: 12,
  },
  countdown: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#101a16dd",
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 72, color: "#b9f36b", fontWeight: "700" },
});
