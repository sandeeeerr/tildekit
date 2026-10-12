// Checks for a new Mac and for the way back, in a throwaway HOME: `tilde setup` without a device name, and
// `tilde uninstall` leaving the user's own settings as they were. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { deviceName } from "../src/setup.ts";
import { makeHome } from "./home.ts";

const { home, tilde, run, git } = makeHome();
git("-C", tilde, "init", "-q", "-b", "main");

const SETTINGS = join(home, ".claude/settings.json");
const CURSOR = join(home, ".cursor/hooks.json");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

// What the user had before tilde: a rule, a hook and a setting of their own.
const ownHook = { matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-hook", timeout: 5 }] };
const before = {
  model: "some-model",
  permissions: { allow: ["Bash(npm test)"], deny: ["Read(~/mine/**)"] },
  hooks: { PreToolUse: [ownHook] },
};
const cursorBefore = { version: 1, hooks: { beforeShellExecution: [{ command: "/usr/local/bin/my-cursor-hook" }] } };
mkdirSync(join(home, ".claude"), { recursive: true });
mkdirSync(join(home, ".cursor"), { recursive: true });
writeFileSync(SETTINGS, JSON.stringify(before));
writeFileSync(CURSOR, JSON.stringify(cursorBefore));

test("a device name comes from the Mac's own name", () => {
  assert.equal(deviceName("Studio-MacBook-Pro.local"), "studio-macbook-pro");
  assert.equal(deviceName("mini"), "mini");
  assert.equal(deviceName("..."), "mac");
});

test("setup without a name takes this Mac's name and writes its device file", () => {
  const output = run(["setup"]);
  const device = readFileSync(join(home, ".config/tilde/device"), "utf8").trim();
  assert.equal(device, deviceName());
  assert.ok(existsSync(join(tilde, "devices", `${device}.md`)), "the device file");
  assert.ok(output.includes(`New device: wrote devices/${device}.md`));
  assert.ok(readFileSync(join(home, ".claude/CLAUDE.md"), "utf8").includes(`@~/tilde/devices/${device}.md`));
  assert.ok(json(SETTINGS).hooks.SessionStart, "setup went on to write the settings");
});

test("uninstall leaves the user's settings as they were, and nothing of tilde on this Mac", () => {
  run(["uninstall"]);
  assert.deepEqual(json(SETTINGS), before);
  assert.deepEqual(json(CURSOR), cursorBefore);
  const gone = [
    ".claude/CLAUDE.md",
    ".codex/AGENTS.md",
    ".codex/rules/tilde.rules",
    ".cursor/rules/tilde.mdc",
    ".local/bin/tilde",
    ".config/tilde",
    "Library/LaunchAgents/test.tilde.sync.plist",
  ];
  for (const path of gone) assert.ok(!existsSync(join(home, path)), `${path} is gone`);
  assert.deepEqual(readdirSync(join(home, ".claude/skills")), [], "no skill links left");
  // git exits with 1 when no key matches.
  assert.throws(() => git("config", "--global", "--get-regexp", "^includeif\\."), "no git identity include left");
  assert.ok(existsSync(join(tilde, "AGENTS.md")), "the home itself stays");
});

test("a Mac that only ever had tilde's settings ends without those files", () => {
  run(["setup"]);
  writeFileSync(SETTINGS, JSON.stringify({ hooks: { SessionStart: json(SETTINGS).hooks.SessionStart } }));
  writeFileSync(CURSOR, JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: `${tilde}/bin/tilde guard cursor` }] } }));
  run(["uninstall"]);
  assert.ok(!existsSync(SETTINGS), "an empty settings.json is removed");
  assert.ok(!existsSync(CURSOR), "an empty hooks.json is removed");
});
