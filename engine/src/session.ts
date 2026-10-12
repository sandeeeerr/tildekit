// tilde session-start: what an agent gets at the start of a session. The domain, the project file of this folder,
// and anything that needs the user's attention: a sync on hold, a guard that is not working, a full inbox.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUDGET, logSize } from "./archive.ts";
import { CONF, HOME, TILDE, localTime, readJson, readText } from "./config.ts";
import { domainOf, projectFile, remoteOf } from "./project.ts";

export function sessionStart(cwd: string): string {
  const file = projectFile(cwd);
  const byDefault = !file && remoteOf(cwd) === "" ? " (no git remote found, so by the default rule)" : "";
  const out = [`Tilde: domain is ${domainOf(cwd)}${byDefault}.\n`];
  // The project file goes last: the tool cuts a long start off, and what needs attention has to survive that.
  let handover = "";
  if (file) {
    const text = readFileSync(file, "utf8");
    handover = `\nProject file: ~${file.slice(HOME.length)}\n\n${text}`;
    // paths: are lookup keys for every machine, so say which ones do not exist here before they are read as facts.
    for (const path of pathsIn(text)) {
      if (!existsSync(path.replace(/^~/, HOME))) out.push(`Not on this Mac: ${path}\n`);
    }
    const log = logSize(text);
    if (log > BUDGET) out.push(`The log of this project file is ${Math.round(log / 1000)} KB. Run \`tilde archive\` to move its oldest entries to context/archive/.\n`);
  } else {
    const advice = "Create it once you do real work here (see AGENTS.md).";
    out.push(`There is no project file for this folder yet. ${advice}\n`);
  }
  const held = readText(join(CONF, "sync-held"));
  if (held !== undefined) out.push(`Tilde sync is on hold: ${held.trimEnd()}\n`);
  for (const warning of [guardAlive(), syncStale(), sortHint()]) if (warning) out.push(`${warning}\n`);
  return out.join("") + handover;
}

/** The list under paths: (or paden:) in a project file. */
function pathsIn(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^(paden|paths):/.test(line));
  if (start === -1) return [];
  const paths = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^[ \t]*-[ \t]+/.test(line)) break;
    paths.push(line.replace(/^[ \t]*-[ \t]+/, ""));
  }
  return paths;
}

/** The guard does not fail closed, so say it out loud when it cannot do its job. */
function guardAlive(): string | undefined {
  const command = `${TILDE}/bin/tilde guard claude`;
  type Settings = { hooks?: { PreToolUse?: { hooks?: { command?: string }[] }[] } };
  const settings = readJson<Settings>(join(HOME, ".claude/settings.json"));
  const commands = (settings?.hooks?.PreToolUse ?? []).flatMap((entry) => (entry.hooks ?? []).map((h) => h.command));
  const hooked = commands.includes(command);
  if (!hooked) return "Tilde guard is NOT active: its hook is missing from ~/.claude/settings.json (tilde setup).";

  // Through bin/tilde, the way Claude calls it: this also proves the forwarder and the recorded Node work.
  const call = { tool_name: "Bash", tool_input: { command: "git push --force origin x" }, cwd: "/" };
  const options = { input: JSON.stringify(call), encoding: "utf8" } as const;
  const reply = spawnSync(join(TILDE, "bin/tilde"), ["guard", "claude"], options);
  if (!reply.stdout.includes('"permissionDecision": "deny"')) {
    return "Tilde guard is NOT active: it did not block a test command (tilde doctor).";
  }
}

/** A message once the remote has been unreachable for over an hour; briefly offline stays silent. */
export function syncStale(): string | undefined {
  // ponytail: counts from the first failed attempt, even if the machine slept afterwards.
  const stamp = join(CONF, "sync-offline");
  const since = readText(stamp);
  if (since === undefined || Date.now() - statSync(stamp).mtimeMs <= 60 * 60 * 1000) return;
  const advice = "Check the network, the hostname and whether that machine is on.";
  return `Tilde sync: the remote has been unreachable since ${since.trimEnd()}. ${advice}`;
}

/** A nudge to sort the inbox when it is full or old, at most once a day. */
function sortHint(): string | undefined {
  const stamp = join(CONF, "sort-hint");
  const today = localTime().slice(0, 10);
  if (readText(stamp)?.trim() === today) return;
  const candidates = (readText(join(TILDE, "inbox.md")) ?? "").split("\n").filter((line) => /^- [0-9]/.test(line));
  const oldest = candidates.map((line) => /^- (\d{4}-\d{2}-\d{2})/.exec(line)?.[1]).find(Boolean);
  const days = oldest ? Math.round((Date.parse(today) - Date.parse(oldest)) / 86_400_000) : 0;
  if (candidates.length <= 15 && days <= 14) return;
  mkdirSync(CONF, { recursive: true });
  writeFileSync(stamp, `${today}\n`);
  const count = `the inbox has ${candidates.length} candidates (oldest: ${oldest ?? "none"})`;
  return `\nTilde: ${count}. Suggest sorting to the user (skill curator).`;
}

