// tilde guard: decides on one tool call, before it runs.
// Input is the hook JSON from Claude (PreToolUse: Bash, the Terminal tab or a connector) or from Cursor
// (beforeShellExecution). No verdict means: leave it to the tool's own rules.
// The guard does not fail closed; the session start says so when it is not working.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { HOME, connectorIds, protectedPaths, readJson, tools } from "./config.ts";

type Tool = "claude" | "cursor";
type Verdict = { decision: "deny" | "ask"; why: string };
type HookInput = {
  tool_name?: string;
  tool_input?: { command?: string; cwd?: string; name?: string };
  command?: string;
  cwd?: string;
};

const deny = (why: string): Verdict => ({ decision: "deny", why });
const ask = (why: string): Verdict => ({ decision: "ask", why });

// What the agent and the user read when the guard steps in.
const WHY = {
  protected: "This path is protected (tilde.json, guard.protected).",
  skipHooks:
    "Skipping git hooks or changing the hooks path is not allowed: " +
    "the pre-commit scan and the push check must always run.",
  sync:
    "tilde sync commits and pushes Tilde to main. Only through Bash with exactly 'tilde sync' or " +
    "'tilde sync \"<message>\"'; the user then gets a confirmation prompt.",
  forcePush: "Force-push is not allowed: merge instead.",
  pushToMain:
    "A push to main or master only goes through Bash with exactly 'git push origin main' (or master). " +
    "The user then gets a confirmation prompt.",
  pushToMainCursor: "Push to main or master: the user confirms first.",
  remoteShell: "SSH, scp and rsync only go through Bash; the user then gets a confirmation prompt.",
  remoteShellCursor: "SSH, scp or rsync: the user confirms first.",
  writeOperation:
    "executeRead only allows operations starting with get, list, search, lookup, fetch, read or find; " +
    "this looks like a write.",
  closed: (name: string) =>
    `${name} deletes something or is unknown to the guard; that stays closed, even with confirmation.`,
  noAskRule: (name: string) =>
    `${name} changes or sends something and its confirmation rule is missing from settings.json. Run 'tilde setup'.`,
};

export function guard(input: HookInput, tool: Tool): object | undefined {
  const verdict = decide(input, tool);
  if (!verdict) return undefined;
  const { decision, why } = verdict;
  if (tool === "cursor") return { permission: decision, user_message: why, agent_message: why };
  return {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: why },
  };
}

function decide(input: HookInput, tool: Tool): Verdict | undefined {
  const name = input.tool_name ?? "";
  if (Object.values(connectorIds).some((id) => name.startsWith(`${id}__`))) return connector(name, input);
  const cmd = input.tool_input?.command ?? input.command ?? "";
  const cwd = (input.tool_input?.cwd ?? input.cwd ?? "").replace(/^~/, HOME) || process.cwd();
  return shell(cmd, cwd, tool, name === "Bash");
}

// --- connectors: reading is free, writing asks for a click, deleting is closed ---

/** An operation name that only reads. */
export const READ_OPERATION = /^(get|list|search|lookup|fetch|read|find)[A-Z]/;

function connector(name: string, input: HookInput): Verdict | undefined {
  // The Atlassian server also runs write operations through executeRead, so the operation name counts too.
  const isExecuteRead = name === `${connectorIds.atlassian}__executeRead`;
  if (isExecuteRead && !READ_OPERATION.test(input.tool_input?.name ?? "")) return deny(WHY.writeOperation);

  if (tools("read").has(name)) return undefined;
  if (!tools("ask").has(name)) return deny(WHY.closed(name));

  // Writing is allowed after a click: the ask rule in settings.json always asks, also in bypass mode.
  // Without that rule it stays closed.
  const settingsFile = process.env.CLAUDE_SETTINGS ?? join(HOME, ".claude/settings.json");
  const askRules = readJson<{ permissions?: { ask?: string[] } }>(settingsFile)?.permissions?.ask ?? [];
  return askRules.includes(name) ? undefined : deny(WHY.noAskRule(name));
}

// --- shell commands ---

// ponytail: patterns on the command text, not a shell parser. Quotes, variables and aliases are not resolved, so
// `git push origin "main"` or a push inside a script is not seen. Upgrade: a real tokenizer once that bites.

// What may not follow `git`: skipping hooks, or setting or clearing the hooks path, in any repo.
const SKIPS_HOOKS = [
  /--no-verify/,
  /core\.hooksPath(\s*=|\s+\S)/, // sets the path; reading it (git config core.hooksPath) is fine
  /--unset(-all)?\s+core\.hooksPath/,
  /\scommit\s(.*\s)?-[a-zA-Z]*n[a-zA-Z]*(\s|$)/, // commit -n, also inside a group like -anm.
  // A "-n" in a commit message gives a false refusal: rephrase it.
];
const GIT = /(^|\s)git(\s.*)$/;
const GIT_PUSH = /(^|[\s"'])git(\s+-C\s+\S+)?\s+push(\s|$)/; // a quote: the script a shell gets, see unquoted()
const TILDE_SYNC = /(^|[;&|\s/])tilde\s+sync([;&|\s]|$)/;
const REMOTE_SHELL = /(^|[;&|\s])(ssh|scp|rsync)\s/;

// These exact commands are left to the ask rules in settings.json, which show the user a confirmation prompt.
// Claude ignores an "ask" from a hook in bypass mode, but an ask rule always asks (tested 1 Oct 2026).
const EXACT_SYNC = /^tilde sync( "[^"$`\\]*")?$/;
export const EXACT_PUSH = [
  "git push origin main",
  "git push origin master",
  "git push -u origin main",
  "git push -u origin master",
];

// A push or a sync that is only quoted text (an echo, a grep pattern, a commit message) is not a command.
// Quoted text does run when a shell gets it as its script, so behind these words it stays visible.
const RUNS_QUOTED = /(^|[\s;&|(])(sh|bash|zsh|eval|xargs|ssh|watch)(\s|$)/;

/** The command with the content of its quoted strings blanked, except where a shell would run that content. */
export function unquoted(cmd: string): string {
  let out = "";
  let command = ""; // the current command up to here, without its quoted strings
  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (char === "\\") {
      out += cmd.slice(i, i + 2);
      i++;
    } else if (char === '"' || char === "'") {
      let end = i + 1;
      while (end < cmd.length && cmd[end] !== char) end += char === '"' && cmd[end] === "\\" ? 2 : 1;
      if (end >= cmd.length) return out + cmd.slice(i); // no closing quote: leave the rest as it is
      const inner = cmd.slice(i + 1, end);
      out += char + (RUNS_QUOTED.test(command) ? inner : inner.replace(/[^\n]/g, " ")) + char;
      i = end;
    } else {
      command = /[;&|\n]/.test(char) ? "" : command + char;
      out += char;
    }
  }
  return out;
}

function shell(cmd: string, cwd: string, tool: Tool, viaBash: boolean): Verdict | undefined {
  const lines = cmd.split("\n");
  const parts = cmd.split(/[;&|\n]/); // the separate commands in one command line
  const bare = unquoted(cmd);

  // A quoted path is still a path, so this one looks at the whole text.
  const hit = protectedPaths.find((path) => path.pattern && matchesAny(lines, path.pattern));
  if (hit) return deny(hit.reason ?? WHY.protected);

  if (parts.some(skipsHooks)) return deny(WHY.skipHooks);

  if (bare.split("\n").some((line) => TILDE_SYNC.test(line))) {
    if (tool === "cursor") return ask(WHY.sync);
    return viaBash && EXACT_SYNC.test(cmd) ? undefined : deny(WHY.sync);
  }

  const pushes = bare.split(/[;&|\n]/).flatMap(pushArguments);
  if (pushes.some(isForcePush)) return deny(WHY.forcePush);
  if (pushes.some((args) => pushesToMain(args, cwd))) {
    if (tool === "cursor") return ask(WHY.pushToMainCursor);
    return viaBash && EXACT_PUSH.includes(cmd.trim()) ? undefined : deny(WHY.pushToMain);
  }

  // ssh, scp and rsync always ask: in Claude through the ask rules in settings.json, which only know Bash.
  if (lines.some((line) => REMOTE_SHELL.test(line))) {
    if (tool === "cursor") return ask(WHY.remoteShellCursor);
    if (!viaBash) return deny(WHY.remoteShell);
  }
  return undefined;
}

function matchesAny(lines: string[], pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return lines.some((line) => regex.test(line));
  } catch {
    return false; // a broken pattern in tilde.json protects nothing
  }
}

function skipsHooks(part: string): boolean {
  const afterGit = GIT.exec(part)?.[2];
  return afterGit !== undefined && SKIPS_HOOKS.some((pattern) => pattern.test(afterGit));
}

/** The arguments of a `git push` in this part of the command, or nothing when it is not a push. */
function pushArguments(part: string): string[][] {
  const push = GIT_PUSH.exec(part);
  if (!push) return [];
  return [part.slice(push.index + push[0].length).replace(/["']/g, "").split(/\s+/).filter(Boolean)];
}

function isForcePush(args: string[]): boolean {
  // --force and --force-with-lease, -f (also inside a group like -uf) and a +refspec
  return args.some((arg) => arg.startsWith("--force") || /^-[a-zA-Z]*f/.test(arg) || arg.startsWith("+"));
}

function pushesToMain(args: string[], cwd: string): boolean {
  // The first word is the remote, the rest are refspecs. Without a refspec git pushes the current branch.
  // ponytail: `cd x && git push` is judged by the session's directory, not by x.
  const refspecs = args.filter((arg) => !arg.startsWith("-")).slice(1);
  if (refspecs.length === 0) return onMain(cwd);
  return refspecs.some((ref) => /(^|:)(refs\/heads\/)?(main|master)$/.test(ref) || (ref === "HEAD" && onMain(cwd)));
}

function onMain(dir: string): boolean {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] } as const;
    const branch = execFileSync("git", ["-C", dir, "symbolic-ref", "--short", "HEAD"], options).trim();
    return branch === "main" || branch === "master";
  } catch {
    return false; // not a repo, or a detached HEAD
  }
}
