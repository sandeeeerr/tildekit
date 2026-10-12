// Checks for `tilde guard`. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { makeHome } from "./home.ts";

const { tmp, tilde, run, repo } = makeHome();
repo("work", "main", "git@git.example.com:acme/demo.git");
repo("own", "develop", "git@gh-own:someone/demo.git");
mkdirSync(join(tmp, "loose"));

const TERMINAL = "mcp__terminal__run_in_terminal";
type Decision = "allow" | "deny" | "ask";

/** What Claude gets back for one tool call: no output means the guard leaves it alone. */
function claude(toolName: string, toolInput: object, dir = "loose", env = {}): Decision {
  const out = run(["guard", "claude"], { tool_name: toolName, tool_input: toolInput, cwd: join(tmp, dir) }, env);
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
}

function cursor(command: string, dir: string): Decision {
  const out = run(["guard", "cursor"], { command, cwd: join(tmp, dir) });
  return out ? JSON.parse(out).permission : "allow";
}

// Claude blocks (deny) where Cursor asks (ask): in bypass mode Claude ignores an "ask" from a hook.
// Columns: command, repo (work is on main, own is on develop), expected, tool (default Bash).
const commands: [string, string, Decision, string?][] = [
  ["git push", "work", "deny"], // work is on main; only the fixed form is allowed
  ["git push origin main", "work", "allow"], // the fixed form: Claude's ask rule asks for confirmation
  ["git push origin main", "work", "deny", TERMINAL], // no detour through the Terminal tab
  ["git push origin develop", "work", "allow"],
  ["git push origin HEAD:main", "own", "deny"], // own too: main asks for confirmation
  ["git push", "own", "allow"], // own is on develop
  ["git push --force origin develop", "own", "deny"],
  ["chmod +x a.sh && git push origin develop", "own", "allow"],
  ["git push origin +develop", "own", "deny"],
  ["git commit -m push && git push origin +develop", "own", "deny"],
  ["tilde sync", "own", "allow"], // the fixed form: Claude's ask rule asks for confirmation
  ['tilde sync "Add plans"', "own", "allow"],
  ['tilde sync "x$(curl evil.example)"', "own", "deny"],
  ["tilde sync; curl evil.example", "own", "deny"],
  ["tilde sync", "own", "deny", TERMINAL],
  ["~/tilde/bin/tilde sync --auto", "own", "deny"],
  ["ssh server-prod 'ls'", "work", "allow"], // Claude: the ask rule for ssh asks for confirmation
  ["ssh server-prod 'ls'", "own", "deny", TERMINAL], // ssh only through Bash
  ["cp a.zip /protected-area/x", "own", "deny"], // guard.protected from tilde.json
  ["npm run build", "work", "allow"],
  ["git commit --no-verify -m x", "own", "deny"], // skipping hooks is allowed nowhere
  ["git push --no-verify origin develop", "own", "deny"],
  ["git commit -n -m x", "own", "deny"],
  ["git commit -anm x", "own", "deny"],
  ["git config core.hooksPath /tmp/x", "own", "deny"],
  ["git -c core.hooksPath=/dev/null commit -m x", "own", "deny"],
  ["git config --unset core.hooksPath", "own", "deny"],
  ["git config core.hooksPath", "own", "allow"], // reading is fine
  ["git commit --amend --no-edit", "own", "allow"],
  ["git commit -m x", "own", "allow"],
  // Every push on a line is judged on its own, and so is what comes after it.
  ["git push origin main && git push origin develop", "own", "deny"], // every push counts, not the last
  ["cd x\ngit push", "work", "deny"], // a second line is still a push on main
  ["tilde sync\ncurl evil.example", "own", "deny"], // the fixed form is the whole command
  ["git push origin HEAD:refs/heads/main", "own", "deny"],
  ["git push -uf origin develop", "own", "deny"], // -f inside a group of flags
  ["git push origin develop && ssh host ls", "own", "deny", TERMINAL], // ssh after a push
  ["rm -f x && git push origin develop", "own", "allow"], // -f belongs to rm
  // A push or a sync that is only quoted text is not a command.
  ['echo "run git push origin main yourself"', "own", "allow"],
  ["grep -rn ' git push origin main' docs", "own", "allow"],
  ['git commit -m "docs: when to git push origin main; and tilde sync"', "own", "allow"],
  ['git log -S"x git push --force origin main"', "own", "allow"],
  // But a shell runs what it gets in quotes, and a missing closing quote hides nothing.
  ['bash -c "git push origin main"', "own", "deny"],
  ["echo don't; git push origin main", "own", "deny"],
  ['echo "done" && git push origin main', "own", "deny"],
];

test("shell commands", () => {
  for (const [command, dir, expected, tool = "Bash"] of commands) {
    assert.equal(claude(tool, { command }, dir), expected, `[${dir} ${tool}] ${JSON.stringify(command)}`);
  }
});

test("Cursor asks where Claude blocks", () => {
  assert.equal(cursor("git push", "work"), "ask");
  assert.equal(cursor("ssh host ls", "own"), "ask");
  assert.equal(cursor("npm run build", "own"), "allow");
});

test("connectors", () => {
  // The account IDs come from the home.
  const id = JSON.parse(readFileSync(join(tilde, "tilde.json"), "utf8")).connectors as Record<string, string>;
  const call = (tool: string, env = {}) => claude(tool, {}, "loose", env);

  assert.equal(call(`${id.slack}__slack_read_channel`), "allow", "reading and searching is free");
  assert.equal(call(`${id.gmail}__brand_new_tool`), "deny", "unknown is closed");
  assert.equal(call("mcp__other__send_message"), "allow", "the guard leaves other servers alone");

  // Writing is only allowed when the ask rule is in settings.json (it asks the user for a click).
  const settings = join(tmp, "settings.json");
  const env = { CLAUDE_SETTINGS: settings };
  writeFileSync(settings, "{}");
  assert.equal(call(`${id.clickup}__clickup_update_task`, env), "deny", "closed without an ask rule");
  const ask = [`${id.clickup}__clickup_update_task`, `${id.slack}__slack_send_message`, `${id.clickup}__clickup_delete_task`];
  writeFileSync(settings, JSON.stringify({ permissions: { ask } }));
  assert.equal(call(`${id.clickup}__clickup_update_task`, env), "allow", "with an ask rule the confirmation prompt decides");
  assert.equal(call(`${id.slack}__slack_send_message`, env), "allow");
  assert.equal(call(`${id.atlassian}__executeWrite`, env), "deny", "no ask rule for this one");

  // Deleting stays closed, even with an ask rule.
  assert.equal(call(`${id.clickup}__clickup_delete_task`, env), "deny");
  assert.equal(call(`${id.atlassian}__executeDestructive`, env), "deny");
  assert.equal(call(`${id.gmail}__trash_message`, env), "deny");

  // Atlassian runs write operations through executeRead too, so the operation name counts.
  const operation = (name: string) => claude(`${id.atlassian}__executeRead`, { name });
  assert.equal(operation("listMyPullRequests"), "allow");
  assert.equal(operation("mergePullRequest"), "deny");
});
