// tilde setup: connects this machine to the home. It writes each tool's own configuration (Claude's settings.json,
// Cursor's hooks, the Codex rules, the git config), links the skills and installs the sync job.
// Each step only adds or replaces what is tilde's; the rest of a file stays as it was, and what is overwritten is kept.
// tilde uninstall takes the same things out again.
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join, relative } from "node:path";
import { CONF, HOME, TILDE, connectorIds, home, localTime, readText, tools } from "./config.ts";
import { EXACT_PUSH } from "./guard.ts";
import { installSyncJob, removeSyncJob } from "./launchd.ts";
import { loadLocal } from "./local.ts";
import { CODEX, CURSOR, GENERATED, build } from "./rules.ts";
import * as ui from "./ui.ts";

export const CLAUDE_MD = join(HOME, ".claude/CLAUDE.md");
export const CLAUDE_SETTINGS = join(HOME, ".claude/settings.json");
export const CURSOR_HOOKS = join(HOME, ".cursor/hooks.json");
export const CODEX_RULES = join(HOME, ".codex/rules/tilde.rules");
export const CODEX_CONFIG = join(HOME, ".codex/config.toml");

const GUARD = `${TILDE}/bin/tilde guard`;
const SESSION_START = `${TILDE}/bin/tilde session-start`;
const FORMAT = `${TILDE}/bin/tilde format`;

type Hook = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] };
export type ClaudeSettings = {
  env?: Record<string, string>;
  permissions?: { ask?: string[]; deny?: string[]; [key: string]: unknown };
  hooks?: Record<string, Hook[]>;
  [key: string]: unknown;
};
export type CursorHooks = { version?: number; hooks?: Record<string, { command?: string }[]> };

/** A device name from this Mac's own name: "Studio-MacBook-Pro.local" becomes "studio-macbook-pro". */
export const deviceName = (host = hostname()) =>
  host.replace(/\.local$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mac";

/** `tilde setup [device]`; false when tilde doctor still finds something afterwards. */
export async function setup(name?: string): Promise<boolean> {
  // The device this Mac already is, else the one named, else this Mac's own name: a new home needs no argument.
  const recorded = existsSync(join(CONF, "device")) ? readFileSync(join(CONF, "device"), "utf8").trim() : "";
  const device = name || recorded || deviceName();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(device)) {
    ui.error(`tilde setup: "${device}" is not a device name; use lowercase letters, digits and dashes.`);
    process.exit(1);
  }
  ui.title("setup", device);
  const deviceFile = join(TILDE, "devices", `${device}.md`);
  if (!existsSync(deviceFile)) {
    mkdirSync(dirname(deviceFile), { recursive: true });
    writeFileSync(deviceFile, `# ${device}\n\nWhat is only true on this Mac: where the repos live, which tools are missing.\n`);
    ui.note(`New device: wrote devices/${device}.md`);
  }
  mkdirSync(CONF, { recursive: true });
  writeFileSync(join(CONF, "device"), `${device}\n`);
  // The Node that runs the engine, as a full path: hooks and launchd do not share the terminal's PATH.
  const node = process.env.TILDE_NODE ?? process.execPath;
  writeFileSync(join(CONF, "node"), `${node}\n`);
  ui.ok(`Device ${device}; the engine runs on ${node.replace(HOME, "~")}`);

  // Claude imports the rules directly; Codex and Cursor get a generated copy.
  for (const file of [CLAUDE_MD, CODEX, CURSOR]) backup(file);
  mkdirSync(dirname(CLAUDE_MD), { recursive: true });
  writeFileSync(CLAUDE_MD, `@~/tilde/AGENTS.md\n@~/tilde/devices/${device}.md\n`);
  build();
  ui.ok("Rules: Claude imports AGENTS.md, Codex and Cursor got their copy");
  linkSkills();
  const folders = SKILL_FOLDERS.map((folder) => relative(HOME, folder)).join(" and ");
  ui.ok(`${ui.count(skillNames().length, "skill")} linked in ${folders}`);

  // `tilde` everywhere in the terminal.
  const command = join(HOME, ".local/bin/tilde");
  mkdirSync(dirname(command), { recursive: true });
  rmSync(command, { force: true });
  symlinkSync(join(TILDE, "bin/tilde"), command);
  ui.ok("Command tilde in ~/.local/bin");

  installSyncJob();
  ui.ok("Sync job installed: every 15 minutes");
  setupTools();
  ui.ok("Settings written for Claude, Cursor, Codex and git");
  const extensions = (await loadLocal()).filter((extension) => extension.setup);
  for (const extension of extensions) extension.setup?.();
  if (extensions.length > 0) ui.ok(`${ui.count(extensions.length, "step")} of this home's local/ ran`);
  if (existsSync(BACKUP)) ui.note(`Backups of overwritten files: ${BACKUP}`);
  ui.line();
  ui.end("Done; now the doctor.");
  return (await import("./doctor.ts")).doctor();
}

/** The part of setup that writes each tool's own configuration. */
export function setupTools(): void {
  writeJson(CLAUDE_SETTINGS, claudeSettings(readJsonOr(CLAUDE_SETTINGS, {})));
  writeJson(CURSOR_HOOKS, cursorHooks(readJsonOr(CURSOR_HOOKS, {})));
  codexConfig();
  gitConfig();
}

// --- skills: every skill of the home linked where Claude, Codex and Cursor look for them ---

export const SKILL_FOLDERS = [join(HOME, ".claude/skills"), join(HOME, ".agents/skills")];

/** The skills of the home: every folder in skills/. */
export function skillNames(): string[] {
  const skills = join(TILDE, "skills");
  const all = existsSync(skills) ? readdirSync(skills, { withFileTypes: true }) : [];
  return all.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function linkSkills(): void {
  const skills = join(TILDE, "skills");
  for (const folder of SKILL_FOLDERS) {
    mkdirSync(folder, { recursive: true });
    for (const name of skillNames()) {
      const link = join(folder, name);
      const target = join(skills, name);
      const existing = lstatSync(link, { throwIfNoEntry: false });
      if (existing?.isSymbolicLink() && readlinkSync(link) === target) continue;
      if (existing && !existing.isSymbolicLink()) backup(link); // a real folder with the same name: keep it first
      rmSync(link, { recursive: true, force: true });
      symlinkSync(target, link);
    }
    // Links to skills that were renamed or removed go.
    for (const name of readdirSync(folder)) {
      const link = join(folder, name);
      const dead = lstatSync(link).isSymbolicLink() && !existsSync(link);
      if (dead && readlinkSync(link).startsWith(`${skills}/`)) rmSync(link);
    }
  }
}

// --- Claude: permissions and hooks in ~/.claude/settings.json ---

const ALWAYS_DENY = ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/Library/Keychains/**)"];
// An ask rule shows the user a confirmation prompt, also in bypass mode. The guard lets exactly these forms through.
const ALWAYS_ASK = [
  ...EXACT_PUSH.map((cmd) => `Bash(${cmd})`),
  "Bash(tilde sync:*)",
  "Bash(ssh:*)",
  "Bash(scp:*)",
  "Bash(rsync:*)",
];

/** The settings as tilde setup leaves them. Running it on its own result changes nothing;
 * tilde doctor relies on that. */
export function claudeSettings(current: ClaudeSettings): ClaudeSettings {
  const extra = home.claude ?? {};
  // Connectors: deleting stays closed (deny), the rest of the writing asks for a click (ask).
  const asking = tools("ask");
  const closed = tools("deny");
  const deny = [...(current.permissions?.deny ?? []), ...ALWAYS_DENY, ...(extra.deny ?? [])];
  const ask = [...(current.permissions?.ask ?? []), ...ALWAYS_ASK];

  // The guard sees every shell command and every tool of a watched connector.
  const watched = Object.values(connectorIds).join("|") || "mcp__no-connectors-configured";
  const guard = hook(`${GUARD} claude`, 10, `Bash|mcp__terminal__run_in_terminal|(${watched})__.*`);
  const fromHome = (extra.hooks?.PreToolUse ?? []).map((h) =>
    hook(`${TILDE}/${h.command}`, h.timeout ?? 10, h.matcher ?? "*"),
  );
  const before = current.hooks?.PreToolUse ?? [];
  const replaced = [guard, ...fromHome].map(commandOf);

  const settings: ClaudeSettings = {
    ...current,
    env: { ...current.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    permissions: {
      ...current.permissions,
      // A tool that changed lists moves with it: never on deny and ask at the same time.
      deny: unique([...deny.filter((rule) => !asking.has(rule)), ...closed]),
      ask: unique([...ask.filter((rule) => !closed.has(rule)), ...asking]),
    },
    hooks: {
      ...current.hooks,
      PreToolUse: [...without(before, [...replaced, ...goneFromHome(before)]), guard, ...fromHome],
      SessionStart: [...without(current.hooks?.SessionStart ?? [], [SESSION_START]), hook(SESSION_START, 10)],
      PostToolUse: [...without(current.hooks?.PostToolUse ?? [], [FORMAT]), hook(FORMAT, 30, "Edit|Write")],
    },
  };
  return merge(settings, extra.settings ?? {}) as ClaudeSettings;
}

function hook(command: string, timeout: number, matcher?: string): Hook {
  return { ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout }] };
}

const commandOf = (entry: Hook) => entry.hooks?.[0]?.command ?? "";

/** The hook entries that run none of these commands. */
function without(entries: Hook[], commands: string[]): Hook[] {
  return entries.filter((entry) => !(entry.hooks ?? []).some((h) => commands.includes(h.command ?? "")));
}

/** Hooks that point into the home but no longer exist (renamed or removed), so no tool call hits a dead hook. */
function goneFromHome(entries: Hook[]): string[] {
  const commands = entries.flatMap((entry) => (entry.hooks ?? []).map((h) => h.command ?? ""));
  return commands.filter((command) => command.startsWith(`${TILDE}/`) && !existsSync(command.split(" ")[0]));
}

const unique = (values: Iterable<string>) => [...new Set(values)].sort();

/** Settings from tilde.json win; objects are merged key by key. */
function merge(base: unknown, extra: unknown): unknown {
  if (!isObject(base) || !isObject(extra)) return extra;
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) result[key] = key in base ? merge(base[key], value) : value;
  return result;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// --- Cursor: the guard before every shell command ---

export function cursorHooks(current: CursorHooks): CursorHooks {
  const command = `${GUARD} cursor`;
  const before = (current.hooks?.beforeShellExecution ?? []).filter((h) => h.command !== command);
  return {
    ...current,
    version: current.version ?? 1,
    hooks: { ...current.hooks, beforeShellExecution: [...before, { command }] },
  };
}

// --- Codex: rules and memories ---

// ponytail: Codex cannot ask for confirmation through a hook, so every push and ssh asks.
export const CODEX_RULES_TEXT = `# Generated by tilde setup. See the home's AGENTS.md.
prefix_rule(pattern=["git", "push", "--force"], decision="forbidden", justification="Merge instead of force-push")
prefix_rule(pattern=["git", "push", "-f"], decision="forbidden", justification="Merge instead of force-push")
prefix_rule(pattern=["git", "push"], decision="prompt", justification="The user confirms a push")
prefix_rule(pattern=["ssh"], decision="prompt", justification="The user confirms ssh")
prefix_rule(pattern=["scp"], decision="prompt", justification="The user confirms scp")
prefix_rule(pattern=["rsync"], decision="prompt", justification="The user confirms rsync")
`;

function codexConfig(): void {
  mkdirSync(dirname(CODEX_RULES), { recursive: true });
  writeFileSync(CODEX_RULES, CODEX_RULES_TEXT);
  if (!existsSync(CODEX_CONFIG)) return;
  backup(CODEX_CONFIG);
  // Tilde keeps the memory (project files and the inbox), so Codex's own memories go off: only in [features].
  let inFeatures = false;
  const lines = readFileSync(CODEX_CONFIG, "utf8").split("\n").map((line) => {
    if (line.startsWith("[")) inFeatures = line.startsWith("[features]");
    return inFeatures && line === "memories = true" ? "memories = false" : line;
  });
  writeFileSync(CODEX_CONFIG, lines.join("\n"));
}

// --- git: a separate identity for the remotes named in tilde.json, and the hooks of the home itself ---

function gitConfig(): void {
  const git = (...args: string[]) => execFileSync("git", args, { stdio: "inherit" });
  const identity = home.git?.identity;
  if (identity?.config) {
    const file = join(TILDE, identity.config);
    for (const remote of identity.remotes ?? []) {
      git("config", "--global", `includeIf.hasconfig:remote.*.url:${remote}.path`, file);
    }
    git("-C", TILDE, "config", "include.path", file); // the home itself may have a remote that matches none of them
  }
  git("-C", TILDE, "config", "core.hooksPath", ".githooks");
}

// --- uninstall: take out again what setup wrote, and nothing else ---

/** `tilde uninstall`: this Mac without tilde. The home itself stays, and so do the backups setup made. */
export function uninstall(): void {
  ui.title("uninstall", readText(join(CONF, "device"))?.trim() ?? "");
  removeSyncJob();
  ui.ok("Sync job stopped and removed");

  // Claude's import lines go; what the user wrote in that file stays. The copies for Codex and Cursor are tilde's.
  const lines = (readText(CLAUDE_MD) ?? "").split("\n");
  const own = lines.filter((line) => !line.startsWith("@~/tilde/"));
  if (own.length < lines.length) {
    backup(CLAUDE_MD);
    if (own.join("").trim() === "") rmSync(CLAUDE_MD);
    else writeFileSync(CLAUDE_MD, own.join("\n"));
  }
  for (const file of [CODEX, CURSOR]) if ((readText(file) ?? "").includes(GENERATED)) rmSync(file);
  ui.ok("Rules: Claude no longer imports AGENTS.md, the copies for Codex and Cursor are gone");

  for (const folder of SKILL_FOLDERS.filter((folder) => existsSync(folder))) {
    for (const name of readdirSync(folder)) {
      const link = join(folder, name);
      if (lstatSync(link).isSymbolicLink() && readlinkSync(link).startsWith(`${TILDE}/skills/`)) rmSync(link);
    }
  }
  const command = join(HOME, ".local/bin/tilde");
  if (lstatSync(command, { throwIfNoEntry: false })?.isSymbolicLink() && readlinkSync(command) === join(TILDE, "bin/tilde")) {
    rmSync(command);
  }
  ui.ok("Skill links and the command in ~/.local/bin removed");

  if (existsSync(CLAUDE_SETTINGS)) {
    const settings = claudeWithout(readJsonOr(CLAUDE_SETTINGS, {}));
    writeOrRemove(CLAUDE_SETTINGS, settings, Object.keys(settings).length === 0);
  }
  if (existsSync(CURSOR_HOOKS)) {
    const hooks = cursorWithout(readJsonOr(CURSOR_HOOKS, {}));
    const onlyVersion = Object.keys(hooks).every((key) => key === "version" || key === "hooks");
    writeOrRemove(CURSOR_HOOKS, hooks, onlyVersion && Object.keys(hooks.hooks ?? {}).length === 0);
  }
  if (readText(CODEX_RULES) === CODEX_RULES_TEXT) rmSync(CODEX_RULES);
  for (const remote of home.git?.identity?.remotes ?? []) {
    const key = `includeIf.hasconfig:remote.*.url:${remote}.path`;
    spawnSync("git", ["config", "--global", "--unset", key], { stdio: "ignore" }); // not there: nothing to do
  }
  ui.ok("Settings of Claude, Cursor, Codex and git: tilde's hooks and rules taken out");

  rmSync(CONF, { recursive: true, force: true });
  ui.line();
  ui.note(`Still here: ${TILDE.replace(HOME, "~")} itself, and what setup kept in ~/.tilde-backup.`);
  ui.note("Not turned back: Codex memories, a setting from tilde.json you changed since, steps of the home's local/.");
  ui.end("Done; tilde setup connects this Mac again.");
}

/** Claude's settings without what tilde setup writes; the user's own rules, hooks and settings stay. */
export function claudeWithout(current: ClaudeSettings): ClaudeSettings {
  const extra = home.claude ?? {};
  const rules = new Set([...ALWAYS_DENY, ...(extra.deny ?? []), ...ALWAYS_ASK, ...tools("deny"), ...tools("ask")]);
  const fromHome = (extra.hooks?.PreToolUse ?? []).map((h) => `${TILDE}/${h.command}`);
  const commands = [`${GUARD} claude`, SESSION_START, FORMAT, ...fromHome];
  const written = { ...extra.settings, env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } };
  const settings = (unmerge(current, written) ?? {}) as ClaudeSettings;

  const permissions = { ...settings.permissions };
  for (const list of ["deny", "ask"] as const) {
    const left = (permissions[list] ?? []).filter((rule) => !rules.has(rule));
    if (left.length > 0) permissions[list] = left;
    else delete permissions[list];
  }
  const hooks = { ...settings.hooks };
  for (const event of ["PreToolUse", "SessionStart", "PostToolUse"]) {
    const left = without(hooks[event] ?? [], commands);
    if (left.length > 0) hooks[event] = left;
    else delete hooks[event];
  }
  const result: ClaudeSettings = { ...settings, permissions, hooks };
  if (Object.keys(permissions).length === 0) delete result.permissions;
  if (Object.keys(hooks).length === 0) delete result.hooks;
  return result;
}

export function cursorWithout(current: CursorHooks): CursorHooks {
  const hooks = { ...current.hooks };
  const left = (hooks.beforeShellExecution ?? []).filter((h) => h.command !== `${GUARD} cursor`);
  if (left.length > 0) hooks.beforeShellExecution = left;
  else delete hooks.beforeShellExecution;
  return { ...current, hooks };
}

/** The opposite of merge: drops every value that still equals what was merged in; one the user changed stays. */
function unmerge(base: unknown, extra: unknown): unknown {
  if (!isObject(base) || !isObject(extra)) return JSON.stringify(base) === JSON.stringify(extra) ? undefined : base;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    const rest = key in extra ? unmerge(value, extra[key]) : value;
    if (rest !== undefined) result[key] = rest;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// --- files ---

/** Writes a JSON file back, or removes it when nothing of the user's is left in it. */
function writeOrRemove(path: string, value: unknown, empty: boolean): void {
  if (!empty) return writeJson(path, value);
  backup(path);
  rmSync(path);
}

function readJsonOr<T>(path: string, fallback: T): T {
  // A missing file starts empty. A broken one stops setup: better than overwriting what the user had.
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

function writeJson(path: string, value: unknown): void {
  backup(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}

// One folder per run, named after the moment.
const stamp = localTime().replace(/[-:]/g, "").replace(" ", "-");
const BACKUP = join(HOME, ".tilde-backup", stamp);

/** Keeps a file or folder before it is overwritten. */
function backup(path: string): void {
  if (!lstatSync(path, { throwIfNoEntry: false })) return;
  mkdirSync(BACKUP, { recursive: true });
  cpSync(path, join(BACKUP, relative(HOME, path).replaceAll("/", "_")), { recursive: true, verbatimSymlinks: true });
}
