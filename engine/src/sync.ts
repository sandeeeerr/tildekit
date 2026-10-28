// tilde sync: keeps the home the same on all of the user's machines, through git.
// tilde push-check: the pre-push hook that decides what may leave without the user saying yes.
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { CONF, TILDE, localTime, readJson } from "./config.ts";
import { build, device } from "./rules.ts";
import { linkSkills } from "./setup.ts";
import * as ui from "./ui.ts";

const HELD = join(CONF, "sync-held"); // why the last sync stopped; the session start shows it
const OFFLINE = join(CONF, "sync-offline"); // since when the remote is unreachable; see the session start

/** The local date and time as yyyy-mm-dd hh:mm. */
const now = () => localTime().slice(0, 16);

// --- sync ---

/** Commit everything, rebase on the remote, push. With --auto (launchd, every 15 minutes) it never asks anything. */
export function sync(args: string[]): void {
  const auto = args[0] === "--auto";
  const message = (auto ? args[1] : args[0]) || `Sync from ${device()}`;
  process.chdir(TILDE);
  try {
    run(auto, message);
  } catch (error) {
    // Anything unexpected must not stop the sync in silence: it runs unattended.
    stop(auto, `Sync stopped: ${error instanceof Error ? error.message : error}`);
  }
}

function run(auto: boolean, message: string): void {
  // One line per step for the user at the terminal; --auto runs unattended and says nothing on success.
  const say = auto ? () => {} : ui.ok;
  if (!auto) ui.title("sync", device());

  const changes = capture("status", "--porcelain").split("\n").filter(Boolean).length;
  if (changes > 0) {
    git(["add", "-A"]);
    const committed = git(["commit", "-q", "-m", message]);
    if (!committed) stop(auto, "Commit blocked by the pre-commit scan (secret or invisible characters).");
    say(`Committed ${ui.count(changes, "change")}: ${message}`);
  }

  if (!git(["fetch", "-q"])) {
    // Offline or the remote is unreachable: the next run tries again.
    mkdirSync(CONF, { recursive: true });
    if (!existsSync(OFFLINE)) writeFileSync(OFFLINE, `${now()}\n`); // the first failed attempt
    if (auto) return;
    ui.error("Remote unreachable; committed locally, nothing pushed.");
    process.exit(1);
  }

  const behind = Number(capture("rev-list", "--count", "HEAD..@{u}"));
  if (!git(["rebase", "-q", "@{u}"])) {
    if (auto) git(["rebase", "--abort"]);
    stop(auto, "Conflict while pulling. Run git pull --rebase in ~/tilde, resolve it and run tilde sync.");
  }
  say(behind > 0 ? `Pulled ${ui.count(behind, "commit")} from the remote` : "Up to date with the remote");

  // What came in may have changed the rules or the skills.
  build();
  linkSkills();

  const unpushed = Number(capture("rev-list", "--count", "@{u}..HEAD"));
  if (unpushed > 0) {
    // The pre-push hook runs tilde push-check, which holds back what needs the user's approval.
    const pushed = git(["push", "-q"], { TILDE_SYNC_AUTO: auto ? "1" : "" });
    if (!pushed) stop(auto, "Push awaits approval: run tilde sync in your own terminal.");
    say(`Pushed ${ui.count(unpushed, "commit")}`);
  }
  rmSync(HELD, { force: true });
  rmSync(OFFLINE, { force: true });
  if (!auto) {
    ui.line();
    ui.end(`Tilde at: ${capture("log", "-1", "--format=%h %s")}`);
  }
}

/** Keeps the reason for the session start and tilde doctor: that is where a sync nobody watched reports. */
function stop(auto: boolean, message: string): never {
  mkdirSync(CONF, { recursive: true });
  writeFileSync(HELD, `${now()} · ${message}\n`);
  ui.error(message);
  process.exit(1);
}

/** Runs git and lets it talk to the terminal or the log, hooks included; true when it succeeded. */
function git(args: string[], env: Record<string, string> = {}): boolean {
  return spawnSync("git", args, { stdio: "inherit", env: { ...process.env, ...env } }).status === 0;
}

/** Runs git for its answer. */
function capture(...args: string[]): string {
  const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 } as const;
  return execFileSync("git", args, options).trim();
}

// --- push check ---

type Patterns = { approval: string[]; suspicious: { pattern: string }[]; escalation: { pattern: string }[] };

/** The pre-push hook. Input: one line per ref, `<local ref> <local sha> <remote ref> <remote sha>`. */
export async function pushCheck(input: string): Promise<void> {
  const found = input.split("\n").flatMap((line) => {
    const [, localSha, , remoteSha] = line.split(" ");
    return localSha && !/^0+$/.test(localSha) ? findings(base(localSha, remoteSha), localSha) : [];
  });
  if (found.length === 0) return;
  // Git shows a hook's stderr, in the user's terminal or in the log of the sync job.
  for (const finding of found) ui.warn(finding, process.stderr);

  if (process.env.TILDE_SYNC_AUTO) refuse("Not pushed: this needs the user's approval.");
  const tty = openTty();
  if (tty === undefined) refuse("Not pushed: confirm in your own terminal with tilde sync.");
  // The terminal as a stream for ui: it writes to the terminal itself, also when stderr goes to a file, and it is
  // colored when stderr is, so it matches the findings above.
  const write = { value: (text: string) => writeSync(tty, text) };
  const out = Object.create(process.stderr, { write }) as NodeJS.WriteStream;

  // A change to the engine only goes out when its own tests pass. They run here, after the two gates above, so the
  // automatic sync never runs them. TILDE_SKIP_TESTS=1 pushes anyway: the user at the terminal has the last word.
  const tests = join(TILDE, "engine/test/run.sh");
  const engineChanged = found.some((line) => line.includes("changed: engine/"));
  if (engineChanged && !process.env.TILDE_SKIP_TESTS && existsSync(tests)) {
    const running = new Promise<{ passed: boolean; said: string }>((done) => {
      const report = (error: Error | null, stdout: string, stderr: string) => done({ passed: !error, said: stdout + stderr });
      execFile("/bin/bash", [tests], report).stdin?.end(); // nothing to read, as with a closed stdin
    });
    const { passed, said } = await ui.spin("Running the engine tests", running, out);
    if (!passed) {
      for (const line of said.trimEnd().split("\n")) ui.line(line, out);
      refuse("Not pushed: the engine tests fail. Fix them, or push anyway with TILDE_SKIP_TESTS=1 tilde sync.");
    }
    ui.ok("Engine tests pass", out);
  }

  // The app and its expect script wait for the literal `Push? [y/N] ` at the end: keep that text as it is.
  ui.line("", out);
  ui.note("Review with: git -C ~/tilde log -p @{u}..HEAD", out);
  out.write(`${ui.dim("│", out)}  Push? [y/N] `);
  const answer = readLine(tty);
  closeSync(tty);
  if (!["y", "Y", "j", "J"].includes(answer)) refuse("Not pushed."); // j: old habit from the Dutch prompt
}

function refuse(message: string): never {
  ui.error(message);
  process.exit(1);
}

/** Where the comparison starts: what the remote has, or for a new branch the point where it left main. */
function base(localSha: string, remoteSha: string): string {
  if (!/^0+$/.test(remoteSha)) return remoteSha;
  try {
    return capture("merge-base", localSha, "origin/main");
  } catch {
    return capture("hash-object", "-t", "tree", "/dev/null"); // no shared history: compare with nothing
  }
}

/**
 * What the next sync from this folder would hold back for the user's yes, uncommitted work included: a sync commits
 * first. Nothing when there is no upstream.
 */
export function waiting(): string[] {
  try {
    return findings(capture("rev-parse", "@{u}"));
  } catch {
    return [];
  }
}

/**
 * What in this range needs the user's approval: changed instructions or code, and suspicious added lines.
 * Without `to` the range ends at the working tree, new files included by name.
 */
function findings(from: string, to?: string): string[] {
  const patterns = readJson<Patterns>(new URL("../push-check.json", import.meta.url));
  if (!patterns) throw new Error("engine/push-check.json is missing or not valid JSON");
  const anyOf = (list: { pattern: string }[]) => new RegExp(list.map((entry) => entry.pattern).join("|"), "i");
  const suspicious = anyOf(patterns.suspicious);
  const escalation = anyOf(patterns.escalation);
  const range = to === undefined ? [from] : [from, to];

  // -z: names as they are. Without it git puts a name with a quote or an accent in it between quotes, and such a
  // file under skills/ would no longer start with "skills/".
  const changed = capture("diff", "--name-only", "-z", ...range).split("\0");
  if (to === undefined) changed.push(...capture("ls-files", "--others", "--exclude-standard", "-z").split("\0"));
  const found = changed
    .filter((file) => patterns.approval.some((path) => file.startsWith(path)))
    .map((file) => `instructions or code changed: ${file}`);

  let file = "";
  for (const line of capture("diff", "-U0", "--no-color", ...range).split("\n")) {
    const header = /^\+\+\+ b\/(.*)/.exec(line);
    if (header) file = header[1];
    const added = /^\+(?!\+\+)(.*)/.exec(line)?.[1];
    if (header || added === undefined) continue;
    const aboutThese = /^(plans|context)\//.test(file); // the log and the plans may name escalation words
    if (suspicious.test(added) || (!aboutThese && escalation.test(added))) {
      found.push(`suspicious in ${file}: ${added.slice(0, 120)}`);
    }
  }
  return found;
}

/** The user's own terminal, or nothing when there is none (launchd, an agent's shell). */
function openTty(): number | undefined {
  try {
    return openSync("/dev/tty", "r+");
  } catch {
    return undefined;
  }
}

function readLine(fd: number): string {
  const buffer = Buffer.alloc(1024);
  return buffer.toString("utf8", 0, readSync(fd, buffer)).trim();
}
