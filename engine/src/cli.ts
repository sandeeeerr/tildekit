// Entry point of the engine: every `tilde <command>` ends up here, through bin/tilde and engine/bin/tilde.
// Each command loads only its own module: the guard runs on every tool call. The table feeds the dispatch and
// `tilde help` both, so they cannot drift apart; a command without a group is a step for the launcher.
import { readFileSync } from "node:fs";

type Command = { group?: string; usage?: string; help?: string; run: (args: string[]) => void | Promise<void> };

const DAILY = "Every day";
const SETUP = "Setting up";
const LOCAL = "From this home's local/";
const HOOKS = "Used by the hooks of Claude, Cursor and git";

const COMMANDS: Record<string, Command> = {
  doctor: {
    group: DAILY,
    help: "Is everything in place, and is anything waiting for you? --json for the app",
    run: async (args) => {
      process.exitCode = (await (await import("./doctor.ts")).doctor(args)) ? 0 : 1;
    },
  },
  sync: {
    group: DAILY,
    usage: "sync [message]",
    help: "Commit, pull and push the home; a push to main waits for your y",
    run: async (args) => (await import("./sync.ts")).sync(args),
  },
  archive: {
    group: DAILY,
    help: "Move the oldest log entries of a heavy project file to context/archive/",
    run: async () => (await import("./archive.ts")).archive(),
  },
  ...Object.fromEntries(
    ["ssh", "scp", "rsync"].map((tool): [string, Command] => [
      tool,
      {
        group: DAILY,
        usage: tool === "ssh" ? "ssh <host> [command]" : `${tool} <args>`,
        help: `${tool} to an own host (ssh.own_hosts in tilde.json), without a confirmation prompt`,
        run: async (args) => (await import("./remote.ts")).remote(tool, args),
      },
    ]),
  ),
  help: { group: DAILY, help: "This list", run: help },
  setup: {
    group: SETUP,
    usage: "setup [device]",
    help: "Connect this Mac: tool settings, skills, the sync job, then doctor",
    run: async (args) => {
      process.exitCode = (await (await import("./setup.ts")).setup(args[0])) ? 0 : 1;
    },
  },
  uninstall: {
    group: SETUP,
    help: "Take out what setup wrote on this Mac; the home itself stays",
    run: async () => (await import("./setup.ts")).uninstall(),
  },
  build: {
    group: SETUP,
    help: "Rebuild the Codex and Cursor copies of AGENTS.md",
    run: async () => {
      try {
        (await import("./rules.ts")).build();
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    },
  },
  "leak-check": {
    group: SETUP,
    help: "Find the home's private values in engine/",
    run: async () => {
      const hits = (await import("./doctor.ts")).leaks();
      if (hits.length > 0) fail(hits.join("\n"));
    },
  },
  guard: {
    group: HOOKS,
    usage: "guard [claude|cursor|<name>]",
    help: "Judge one tool call (JSON on stdin) before it runs",
    run: async (args) => {
      const name = args[0] ?? "claude";
      const call = JSON.parse(readFileSync(0, "utf8"));
      const reply =
        name === "claude" || name === "cursor"
          ? (await import("./guard.ts")).guard(call, name)
          : await localGuard(name, call);
      if (reply) console.log(JSON.stringify(reply, null, 2));
    },
  },
  "session-start": {
    group: HOOKS,
    help: "What an agent reads at the start of a session: domain, project file, warnings",
    run: async () => {
      // Claude passes the session's folder as JSON; in a terminal there is no input and the current folder counts.
      const { sessionStart } = await import("./session.ts");
      const cwd = stdinJson().cwd || process.cwd();
      process.stdout.write(sessionStart(cwd));
      // What the home adds. A broken local/ must not cost the session its project file, so it only gets a line.
      try {
        const extensions = await (await import("./local.ts")).loadLocal();
        for (const line of extensions.flatMap((extension) => extension.session?.(cwd) ?? [])) console.log(line);
      } catch (error) {
        console.log(`Tilde: local/ did not load: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  },
  format: {
    group: HOOKS,
    help: "Run the project's own formatter on a file an agent just edited",
    run: async () => {
      const file = stdinJson().tool_input?.file_path;
      if (file) (await import("./format.ts")).format(file);
    },
  },
  "push-check": {
    group: HOOKS,
    help: "The pre-push hook: hold back what needs your approval",
    run: async () => (await import("./sync.ts")).pushCheck(readFileSync(0, "utf8")),
  },
  // What engine/bin/tilde asks before it trusts a Node from the PATH: can this Node run the engine at all?
  check: { run: () => {} },
};

// --no-color anywhere on the line turns the colors off, like NO_COLOR does; FORCE_COLOR would win from that, so it goes.
const argv = process.argv.slice(2).filter((arg) => arg !== "--no-color");
if (argv.length < process.argv.length - 2) {
  delete process.env.FORCE_COLOR;
  process.env.NO_COLOR = "1";
}
const [first = "help", ...args] = argv;
const command = ["-h", "--help"].includes(first) ? "help" : first;

if (Object.hasOwn(COMMANDS, command)) {
  await COMMANDS[command].run(args);
} else {
  // A command the home adds through local/.
  const extensions = await (await import("./local.ts")).loadLocal();
  const run = extensions.map((extension) => extension.commands?.[command]).find(Boolean);
  if (!run) {
    (await import("./ui.ts")).error(`tilde: unknown command "${command}". Try tilde help.`);
    process.exit(1);
  }
  await run(args);
}

async function help(): Promise<void> {
  const ui = await import("./ui.ts");
  ui.title("", "your rules, skills and project files, shared with Claude Code, Codex and Cursor");
  const rows = (group: string): [string, string][] =>
    Object.entries(COMMANDS)
      .filter(([, one]) => one.group === group)
      .map(([name, one]) => [one.usage ?? name, one.help ?? ""]);
  const extensions = await (await import("./local.ts")).loadLocal();
  const local = extensions.flatMap((extension) =>
    Object.keys(extension.commands ?? {}).map((name): [string, string] => [name, extension.help?.[name] ?? ""]),
  );
  const groups: [string, [string, string][]][] = [
    [DAILY, rows(DAILY)],
    [SETUP, rows(SETUP)],
    [LOCAL, local],
    [HOOKS, rows(HOOKS)],
  ];
  for (const [group, list] of groups) {
    if (list.length === 0) continue;
    ui.heading(group);
    ui.table(list);
    ui.line();
  }
  ui.end("Colors follow your terminal; NO_COLOR or --no-color turns them off.");
}

/** A guard the home adds through local/. */
async function localGuard(name: string, call: object): Promise<object | undefined> {
  const extensions = await (await import("./local.ts")).loadLocal();
  const guard = extensions.map((extension) => extension.guards?.[name]).find(Boolean);
  if (!guard) fail(`tilde: no guard named ${name}`);
  return guard(call);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function stdinJson(): { cwd?: string; tool_input?: { file_path?: string } } {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {}; // no input, or not JSON
  }
}
