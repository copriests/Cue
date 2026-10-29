export type Script = {
  id: string;
  title: string;
  text: string;
  updatedAt: number;
};
export const SAMPLE = `You don't need to remember every word.\n\nYou just need a little cue.\n\nTake a breath. Look at the lens. Speak like you're talking to one person.\n\nPause when you need to. Your script will be right here.\n\nThe best version of your story sounds like you.`;
export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}
export function parseScripts(raw: string | null): Script[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("Invalid script library");
  return value.filter(
    (s): s is Script =>
      !!s &&
      typeof s.id === "string" &&
      typeof s.title === "string" &&
      typeof s.text === "string" &&
      typeof s.updatedAt === "number",
  );
}
export function duration(text: string, wpm: number): string {
  const seconds = Math.ceil((words(text).length / Math.max(wpm, 1)) * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
