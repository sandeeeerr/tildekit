// tilde doctor: is everything in place that tilde setup puts there, and is anything waiting for the user?
// tilde leak-check: the engine is meant to be shared, so it must not contain the home's private values.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CONF, HOME, TILDE, home, readJson, readText, tools } from "./config.ts";
import { jobIsLoaded, jobRunsApprovedEngine } from "./launchd.ts";
import { type Check, check, loadLocal } from "./local.ts";
import { CODEX, CURSOR, codexRules, cursorRules, device } from "./rules.ts";
import { syncStale } from "./session.ts";
import {
  CLAUDE_MD,
  CLAUDE_SETTINGS,
  CODEX_CONFIG,
  CODEX_RULES,
  CODEX_RULES_TEXT,
  CURSOR_HOOKS,
  type ClaudeSettings,
  type CursorHooks,
  SKILL_FOLDERS,
  claudeSettings,
  cursorHooks,
  skillNames,
} from "./setup.ts";
import * as ui from "./ui.ts";

const print = ({ ok, text }: Check) => (ok ? ui.ok : ui.fail)(text);

/** One group of checks under its heading, the heading green or red after them. */
function group(name: string, checks: Check[]): void {
  ui.heading(name, checks.every((result) => result.ok));
  checks.forEach(print);
  ui.line();
}

/** Prints the checks in groups; false when a check failed. With --json: the same checks as data, for the app. */
export async function doctor(args: string[] = []): Promise<boolean> {
  const local = (await loadLocal()).flatMap((extension) => extension.doctor?.() ?? []);
  const groups: [string, Check[]][] = [
    ["Engine", engine()],
    ["Rules", rules()],
    ["Skills", skills()],
    ["Tools", toolChecks()],
    ["Sync", sync()],
  ];
  if (local.length > 0) groups.push(["Home", local]);
  const failed = groups.flatMap(([, checks]) => checks).filter((result) => !result.ok).length;
  const inbox = (readText(join(TILDE, "inbox.md")) ?? "").split("\n").filter((line) => /^- [0-9]/.test(line));
  const changes = git("status", "--porcelain").split("\n").filter(Boolean).length;
  if (args.includes("--json")) {
    const data = { device: device(), groups: groups.map(([name, checks]) => ({ name, checks })), failed, inbox: inbox.length, changes };
    process.stdout.write(`${JSON.stringify(data)}\n`);
    return failed === 0;
  }
  ui.title("doctor", device());
  for (const [name, checks] of groups) group(name, checks);

  const summary = [`Inbox: ${inbox.length} candidates`, `${changes} uncommitted changes (tilde sync)`];
  if (failed > 0) summary.unshift(ui.red(`${ui.count(failed, "check")} failed`));
  ui.end(summary.join(" · "));
  return failed === 0;
}

// --- the engine and this machine ---

function engine(): Check[] {
  const name = device();
  const node = readText(join(CONF, "node"))?.trim() ?? "";
  const forwarder = readText(join(TILDE, "bin/tilde")) ?? "";
  return [
    check(
      name !== "" && existsSync(join(TILDE, "devices", `${name}.md`)),
      `Device: ${name}`,
      "No device set (tilde setup <device>)",
    ),
    check(
      readJson(join(TILDE, "tilde.json")) !== undefined,
      "Config: tilde.json is readable",
      "Config: tilde.json is missing or not valid JSON; the engine runs on its defaults",
    ),
    check(
      forwarder.includes("engine/bin/tilde") && existsSync(join(TILDE, "engine/bin/tilde")),
      "Engine: bin/tilde forwards to engine/",
      "Engine: bin/tilde does not forward to engine/bin/tilde",
    ),
    check(
      leaks().length === 0,
      "Engine: no private values in engine/",
      "Engine: private values found in engine/ (tilde leak-check)",
    ),
    check(
      node !== "" && existsSync(node),
      `Engine: runs on Node (${node.replace(HOME, "~")})`,
      "Engine: no usable Node recorded; hooks and sync look for one on the PATH (install Node 22.18+, then tilde setup)",
    ),
    check(
      jobRunsApprovedEngine(),
      "Tilde: launchd runs the approved engine",
      "Tilde: the sync job still runs the old single-file form (tilde setup)",
    ),
    check(
      readLink(join(HOME, ".local/bin/tilde")) === join(TILDE, "bin/tilde"),
      "Command tilde in ~/.local/bin",
      "Command tilde missing in ~/.local/bin (tilde setup)",
    ),
  ];
}

// --- the rules each tool reads ---

function rules(): Check[] {
  const agents = readText(join(TILDE, "AGENTS.md")) ?? "";
  const lines = agents.split("\n").length - 1;
  // Trailing newlines do not count: a tool that rewrites the file may drop one.
  const upToDate = (file: string, wanted: () => string) => {
    try {
      return (readText(file) ?? "").trimEnd() === wanted().trimEnd();
    } catch {
      return false; // no AGENTS.md to build from
    }
  };
  return [
    check(
      (readText(CLAUDE_MD) ?? "").includes("@~/tilde/AGENTS.md"),
      "Claude imports AGENTS.md",
      "~/.claude/CLAUDE.md does not import AGENTS.md",
    ),
    check(upToDate(CODEX, codexRules), "Codex rules are up to date", "~/.codex/AGENTS.md is out of date (tilde build)"),
    check(
      upToDate(CURSOR, cursorRules),
      "Cursor rules are up to date",
      "~/.cursor/rules/tilde.mdc is out of date (tilde build)",
    ),
    check(lines <= 80, `AGENTS.md: ${lines} lines`, `AGENTS.md is ${lines} lines, max 80 (curator)`),
  ];
}

/** One line per folder the skills are linked in, naming the skills that are not. */
function skills(): Check[] {
  const names = skillNames();
  return SKILL_FOLDERS.map((folder) => {
    const where = relative(HOME, folder);
    const missing = names.filter((name) => readLink(join(folder, name)) !== join(TILDE, "skills", name));
    return check(
      missing.length === 0,
      `${names.length} skills linked in ${where}`,
      `Skills missing in ${where}: ${missing.join(", ")} (tilde setup)`,
    );
  });
}

// --- each tool's own configuration: is everything there that tilde setup writes? ---

function toolChecks(): Check[] {
  return [claude(), cursor(), codexPrompts(), codexMemories(), gitHooks()];
}

// What tilde setup writes into Claude's settings, by the name a user knows it by.
const CLAUDE_PARTS: [string, (settings: ClaudeSettings) => unknown][] = [
  ["auto memory off", (s) => s.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY],
  ["deny rules (keys, and connector tools that delete)", (s) => s.permissions?.deny],
  ["confirmation rules (push to main, tilde sync, ssh, connector tools that write)", (s) => s.permissions?.ask],
  ["guard hook (shell, Terminal tab, connectors)", (s) => s.hooks?.PreToolUse],
  ["session-start hook", (s) => s.hooks?.SessionStart],
  ["formatter hook", (s) => s.hooks?.PostToolUse],
];

function claude(): Check {
  const actual = readJson<ClaudeSettings>(CLAUDE_SETTINGS);
  if (!actual) return check(false, "", "Claude: ~/.claude/settings.json is missing or not valid JSON (tilde setup)");
  // Setup changes nothing when everything is in place, so any difference is something that is missing.
  const wanted = claudeSettings(actual);
  const missing = CLAUDE_PARTS.filter(([, part]) => !same(part(actual), part(wanted))).map(([name]) => name);
  if (missing.length === 0 && !same(actual, wanted)) missing.push("settings from tilde.json");
  const counts = `${tools("ask").size} connector tools ask, ${tools("deny").size} closed`;
  return check(
    missing.length === 0,
    `Claude: settings.json has everything tilde setup writes (${counts})`,
    `Claude: settings.json is missing or has changed: ${missing.join("; ")} (tilde setup)`,
  );
}

function cursor(): Check {
  const actual = readJson<CursorHooks>(CURSOR_HOOKS);
  const ok = actual !== undefined && same(actual, cursorHooks(actual));
  return check(ok, "Cursor: guard hook", "Cursor: guard hook missing (tilde setup)");
}

function codexPrompts(): Check {
  const ok = readText(CODEX_RULES) === CODEX_RULES_TEXT;
  const bad = "Codex: ~/.codex/rules/tilde.rules is missing or out of date (tilde setup)";
  return check(ok, "Codex: confirmation rules", bad);
}

function codexMemories(): Check {
  const on = (readText(CODEX_CONFIG) ?? "").split("\n").includes("memories = true");
  return check(!on, "Codex: memories off", "Codex: memories are still on");
}

function gitHooks(): Check {
  const active = git("config", "core.hooksPath") === ".githooks";
  return check(active, "Tilde: pre-commit scan active", "Tilde: pre-commit scan not active");
}

// --- sync ---

function sync(): Check[] {
  const held = readText(join(CONF, "sync-held"))?.trim();
  const stale = syncStale();
  const noGitleaks = "Tilde: gitleaks missing, every commit fails (brew install gitleaks)";
  return [
    check(onPath("gitleaks"), "Tilde: gitleaks installed", noGitleaks),
    check(runnable(join(TILDE, ".githooks/pre-push")), "Tilde: push check active", "Tilde: .githooks/pre-push missing"),
    check(jobIsLoaded(), "Tilde: automatic sync every 15 minutes", "Tilde: sync job not loaded (tilde setup)"),
    check(held === undefined, "Tilde: sync is running", `Tilde sync is on hold: ${held}`),
    check(stale === undefined, "Tilde: remote reachable", stale ?? ""),
  ];
}

// --- leak check ---

/** What must never be in engine/: the home's own values from tilde.json, its git identity and the home path. */
function privateTerms(): string[] {
  const terms = [
    ...Object.values(home.connectors ?? {}),
    home.sync?.label,
    // Not the names of the two domains: "work" is a word the engine uses itself. A name that is private goes in leak.terms.
    ...(home.domains?.strict?.remotes ?? []),
    ...Object.keys(home.git?.ssh_aliases ?? {}),
    ...(home.git?.identity?.remotes ?? []),
    ...(home.leak?.terms ?? []),
    git("config", "user.name"),
    git("config", "user.email"),
    HOME,
  ];
  const usable = terms.filter((term): term is string => typeof term === "string" && term.length >= 4);
  return [...new Set(usable.map((term) => term.toLowerCase()))];
}

/** Every line in engine/ that contains a private value, as `file:line:text`. */
export function leaks(): string[] {
  const terms = privateTerms();
  const root = join(TILDE, "engine");
  const hits: string[] = [];
  for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const file = join(root, name);
    if (!statSync(file).isFile()) continue;
    const content = readFileSync(file);
    if (content.includes(0)) continue; // not a text file
    content.toString("utf8").split("\n").forEach((line, index) => {
      const lower = line.toLowerCase();
      if (terms.some((term) => lower.includes(term))) hits.push(`engine/${name}:${index + 1}:${line}`);
    });
  }
  return hits;
}

// --- helpers ---

function git(...args: string[]): string {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] } as const;
    return execFileSync("git", ["-C", TILDE, ...args], options).trim();
  } catch {
    return "";
  }
}

function readLink(path: string): string | undefined {
  try {
    return readlinkSync(path);
  } catch {
    return undefined;
  }
}

function onPath(command: string): boolean {
  return spawnSync("/bin/sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function runnable(path: string): boolean {
  try {
    return (statSync(path).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Equal as JSON, whatever the order of the keys. */
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  const sortKeys = (_key: string, v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  return JSON.stringify(value, sortKeys);
}
