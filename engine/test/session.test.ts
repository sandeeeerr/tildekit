// Checks for `tilde session-start`. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeHome } from "./home.ts";

const { tmp, home, tilde, run, git, repo } = makeHome();
repo("work", "main", "git@git.example.com:acme/demo.git"); // named in the project file demo.md
repo("own", "develop", "git@gh-own:someone/demo.git"); // gh-own is an ssh alias for github.com
mkdirSync(join(tmp, "loose"));
git("-C", tilde, "init", "-q", "-b", "main"); // the home itself: found by its folder, in home.md

const CONF = join(home, ".config/tilde");
const start = (dir: string) => run(["session-start"], { cwd: dir });
// The inbox hint comes once a day, so most checks start on a fresh day.
const fresh = (dir: string) => (rmSync(join(CONF, "sort-hint"), { force: true }), start(dir));

test("the domain comes from the project file, else from the remote, else it is the strict one", () => {
  assert.match(fresh(join(tmp, "work")), /^Tilde: domain is work\.\n/);
  assert.match(fresh(join(tmp, "own")), /^Tilde: domain is own\.\n/);
  assert.match(fresh(join(tmp, "loose")), /^Tilde: domain is work \(no git remote found, so by the default rule\)\.\n/);
  assert.match(fresh(tilde), /^Tilde: domain is own\.\n/);
});

test("the project file is handed over, with the paths that are not on this machine", () => {
  const work = fresh(join(tmp, "work"));
  assert.ok(work.includes("Project file: ~/tilde/context/projects/demo.md\n\n---\ndomain: work\n"));
  assert.ok(work.includes("A project file for the engine tests"));
  assert.ok(work.includes("Not on this Mac: ~/demo-site\n"));
  assert.ok(work.indexOf("Not on this Mac") < work.indexOf("Project file:"), "what needs attention comes first");

  const atHome = fresh(tilde);
  assert.ok(atHome.includes("Not on this Mac: ~/missing-folder\n"));
  assert.ok(!atHome.includes("Not on this Mac: ~/tilde\n"));
  assert.ok(fresh(join(tmp, "own")).includes("There is no project file for this folder yet."));
});

test("what needs attention: the guard, the sync and the inbox", () => {
  const dir = join(tmp, "own");
  assert.ok(fresh(dir).includes("Tilde guard is NOT active: its hook is missing from ~/.claude/settings.json"));
  assert.ok(!fresh(dir).includes("Tilde sync"));

  writeFileSync(join(CONF, "sync-held"), "2026-01-01 10:00 · Push awaits approval\n");
  assert.ok(fresh(dir).includes("Tilde sync is on hold: 2026-01-01 10:00 · Push awaits approval\n"));
  rmSync(join(CONF, "sync-held"));

  // Offline for a moment stays silent; after an hour it is said.
  writeFileSync(join(CONF, "sync-offline"), "2026-01-01 09:00\n");
  assert.ok(!fresh(dir).includes("unreachable"));
  utimesSync(join(CONF, "sync-offline"), new Date(0), new Date(0));
  assert.ok(fresh(dir).includes("the remote has been unreachable since 2026-01-01 09:00."));
  rmSync(join(CONF, "sync-offline"));

  // The inbox: a candidate older than two weeks gives a hint, once a day.
  const hint = "\nTilde: the inbox has 1 candidates (oldest: 2026-01-01). Suggest sorting to the user (skill curator).\n";
  assert.ok(fresh(dir).endsWith(hint), "the hint");
  assert.ok(!start(dir).includes("the inbox has"), "not twice on one day");
  const today = new Date().toLocaleDateString("sv"); // yyyy-mm-dd, local time
  writeFileSync(join(tilde, "inbox.md"), `# Inbox\n\n- ${today} · demo · test: fresh\n`);
  assert.ok(!fresh(dir).includes("the inbox has"), "a fresh, short inbox gives no hint");
  appendFileSync(join(tilde, "inbox.md"), `- ${today} · demo · test: more\n`.repeat(15));
  assert.ok(fresh(dir).includes("the inbox has 16 candidates"), "more than fifteen does");
});
