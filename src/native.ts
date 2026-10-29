import {
  requireOptionalNativeModule,
  requireNativeViewManager,
} from "expo-modules-core";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";
export type CueState = {
  index: number;
  playing: boolean;
  listening: boolean;
  pip: boolean;
  message: string;
};
type Subscription = { remove(): void };
type CueModule = {
  configure(
    text: string,
    wpm: number,
    fontSize: number,
    mirror: boolean,
    voice: boolean,
  ): void;
  play(): void;
  pause(): void;
  seek(index: number): void;
  startSpeech(): Promise<void>;
  stopSpeech(): void;
  startPiP(): Promise<void>;
  stopPiP(): void;
  addListener(name: "onState", fn: (state: CueState) => void): Subscription;
};
export const Cue = requireOptionalNativeModule<CueModule>("CueNative");
export const CuePreview: ComponentType<ViewProps> | null = Cue
  ? requireNativeViewManager("CueNative")
  : null;
