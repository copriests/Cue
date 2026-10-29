import { test } from "node:test";
import assert from "node:assert/strict";
import { words, duration, parseScripts } from "../src/model.ts";
test("word counts handle pasted whitespace and empty scripts", () => {
  assert.deepEqual(words("  one\n\ntwo\tthree  "), ["one", "two", "three"]);
  assert.deepEqual(words(" \n "), []);
});
test("duration estimates carry into minutes", () => {
  assert.equal(duration(Array(130).fill("word").join(" "), 130), "1:00");
  assert.equal(duration("", 130), "0:00");
});
test("stored scripts reject invalid roots and discard invalid records", () => {
  assert.throws(() => parseScripts("{}"));
  assert.throws(() => parseScripts("{broken"));
  assert.deepEqual(parseScripts(null), []);
  const valid = { id: "1", title: "Title", text: "Hello", updatedAt: 123 };
  assert.deepEqual(parseScripts(JSON.stringify([null, valid, { id: 123 }])), [
    valid,
  ]);
});
