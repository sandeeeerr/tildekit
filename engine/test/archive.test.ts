// Checks for `tilde archive`. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { logSize, splitLog } from "../src/archive.ts";

const LINK = "Older entries: [archive](../archive/demo.md)";
const entry = (day: number, size = 40) => `- 2026-10-${String(day).padStart(2, "0")} · ${"x".repeat(size)}`;
const file = (...entries: string[]) => `---\ndomain: free\n---\n# Demo\n\nWhat it is.\n\n## Log\n\n${entries.join("\n")}\n`;

test("the oldest entries move, the newest stay, and nothing else changes", () => {
  const text = file(entry(1), entry(2), entry(3), entry(4));
  const split = splitLog(text, LINK, 120);
  assert.deepEqual(split?.moved, [entry(1), entry(2)]);
  assert.equal(split?.kept, `---\ndomain: free\n---\n# Demo\n\nWhat it is.\n\n## Log\n\n${LINK}\n\n${entry(3)}\n${entry(4)}\n`);
  assert.equal(logSize(text), logSize(split?.kept ?? "") + logSize(file(...(split?.moved ?? []))));
});

test("a second run adds no second link, and a section after the log stays in place", () => {
  const text = `${file(entry(1), entry(2), entry(3))}\n## Notes\n\nKeep me.\n`;
  const once = splitLog(text, LINK, 60)?.kept ?? "";
  const twice = splitLog(`${once.replace("\n## Notes", `${entry(4)}\n${entry(5)}\n\n## Notes`)}`, LINK, 60)?.kept ?? "";
  assert.equal(twice.split(LINK).length, 2, "one link");
  assert.match(twice, /\n## Notes\n\nKeep me\.\n$/);
});

test("the newest entry stays however long it is, and a small log is left alone", () => {
  assert.deepEqual(splitLog(file(entry(1), entry(2, 500)), LINK, 100)?.moved, [entry(1)]);
  assert.equal(splitLog(file(entry(1), entry(2)), LINK, 5000), undefined);
  assert.equal(splitLog("# No log here\n", LINK), undefined);
});
