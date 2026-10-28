// Checks for `tilde setup` and `tilde doctor` in a throwaway HOME: settings, hooks, the launchd job and the home's
// own steps. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeHome } from "./home.ts";

const { home, tilde, run, git } = makeHome();
git("-C", tilde, "init", "-q", "-b", "main");

const SETTINGS = join(home, ".claude/settings.json");
const settings = () => JSON.parse(readFileSync(SETTINGS, "utf8"));
const preToolUse = (): string[] => settings().hooks.PreToolUse.flatMap((entry: any) => entry.hooks.map((h: any) => h.command));
const setup = () => run(["setup", "test-mac"]); // ends with tilde doctor, which may be red here
const doctor = () => run(["doctor"]);

// A second Claude account with a settings.json of its own, as Claude makes it on first start.
mkdirSync(join(home, ".claude_work"));
writeFileSync(join(home, ".claude_work/settings.json"), "{}");

const firstRun = setup();

test("an extra Claude account shares the settings and skills", () => {
  assert.equal(readlinkSync(join(home, ".claude_work/settings.json")), SETTINGS);
  assert.ok(lstatSync(join(home, ".claude_work/skills/demo")).isSymbolicLink());
  assert.ok(doctor().includes("✓ Claude account .claude_work: shares settings.json"));
});

test("setup writes Claude's settings", () => {
  assert.ok(preToolUse().includes(`${tilde}/bin/tilde guard claude`), "the guard hook");
  assert.ok(preToolUse().includes(`${tilde}/bin/extra-hook`), "the extra hook from tilde.json");
  const { deny, ask } = settings().permissions;
  assert.ok(deny.includes("Read(~/.ssh/**)"), "fixed deny rules");
  assert.ok(deny.includes("Read(~/protected-area/**)"), "deny rules from tilde.json");
  assert.ok(ask.includes("Bash(git push origin main)"), "a push to main asks for confirmation");
  assert.ok(ask.some((rule: string) => rule.startsWith("mcp__00000000-0000-0000-0000-000000000001__")), "connector write tools ask");
  assert.equal(settings().effortLevel, "medium", "settings from tilde.json");
});

test("setup does the rest: device, Node, launchd, Codex, skills, git, the home's own step", () => {
  assert.equal(readFileSync(join(home, ".config/tilde/device"), "utf8").trim(), "test-mac");
  assert.ok(existsSync(readFileSync(join(home, ".config/tilde/node"), "utf8").trim()), "the Node for the engine is recorded");
  const plist = readFileSync(join(home, "Library/LaunchAgents/test.tilde.sync.plist"), "utf8");
  assert.ok(plist.includes("git archive"), "the launchd job runs the approved engine");
  assert.ok(readFileSync(join(home, ".codex/AGENTS.md"), "utf8").includes("Fixture home"), "the rules for Codex");
  assert.ok(lstatSync(join(home, ".claude/skills/demo")).isSymbolicLink(), "skills are linked");
  const identities = git("config", "--global", "--get-regexp", "^includeif\\.").trim().split("\n");
  assert.equal(identities.length, 1, "the git identity is included for the named remotes");
  assert.ok(existsSync(join(home, ".hello-setup")), "the home's own setup step ran");
  assert.ok(firstRun.includes("Hello: local check ran"), "the home's own doctor check ran");
});

test("running setup again changes nothing, and removes a hook to a file that left the home", () => {
  const first = settings();
  const gone = `${tilde}/bin/gone-hook`;
  const withGoneHook = structuredClone(first);
  withGoneHook.hooks.PreToolUse.push({ matcher: "*", hooks: [{ type: "command", command: gone }] });
  writeFileSync(SETTINGS, JSON.stringify(withGoneHook));
  setup();
  assert.ok(!preToolUse().includes(gone));
  assert.deepEqual(settings(), first);
});

test("doctor says what is missing from the tools' settings", () => {
  const ok = "✓ Claude: settings.json has everything tilde setup writes";
  assert.ok(doctor().includes(ok));
  for (const line of ["✓ Cursor: guard hook", "✓ Codex: confirmation rules", "✓ Codex: memories off", "✓ Tilde: pre-commit scan active"]) {
    assert.ok(doctor().includes(line), line);
  }

  const complete = settings();
  const broken = structuredClone(complete);
  broken.hooks.PreToolUse = [];
  broken.permissions.ask = broken.permissions.ask.filter((rule: string) => rule !== "Bash(ssh:*)");
  writeFileSync(SETTINGS, JSON.stringify(broken));
  const report = doctor();
  assert.ok(!report.includes(ok));
  assert.match(report, /✗ Claude: settings\.json is missing or has changed: confirmation rules [^;]*; guard hook/);

  // A rule the user added does not count as a difference.
  complete.permissions.allow = ["Bash(npm test)"];
  writeFileSync(SETTINGS, JSON.stringify(complete));
  assert.ok(doctor().includes(ok));
});
