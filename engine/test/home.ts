// Shared setup for the engine tests on Node: throwaway HOMEs with a small home in them, built from engine/test/home.
// The engine under test is the one this file lives in.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENGINE = join(import.meta.dirname, "..");
const ROOT = join(ENGINE, ".."); // the home around this engine: its bin/tilde and .githooks serve as the template

// The tests may be started from a git hook (the push check runs them): drop everything that points at the real home
// or the real repo, so every command lands in the throwaway directory.
const gitVars = execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" }).split("\n");
const dropped = new Set([...gitVars, "TILDE_HOME", "TILDE_SYNC_AUTO", "TILDE_SKIP_TESTS", "CLAUDE_SETTINGS"]);
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !dropped.has(key)));
const GIT_USER = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** A throwaway directory, removed when the test process ends. */
export function makeTmp(): string {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "tilde-test-"))); // git returns the physical path
  process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
  // No real launchd job and no notifications during a test.
  mkdirSync(join(tmp, "stub"));
  for (const name of ["launchctl", "osascript"]) {
    writeFileSync(join(tmp, "stub", name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return tmp;
}

/** Makes a directory a home: the fixture plus this engine, the forwarder and the git hooks. */
export function copyHome(tilde: string): void {
  mkdirSync(join(tilde, "engine"), { recursive: true });
  cpSync(join(ENGINE, "test/home"), tilde, { recursive: true });
  cpSync(join(ROOT, "bin/tilde"), join(tilde, "bin/tilde"));
  cpSync(join(ROOT, ".githooks"), join(tilde, ".githooks"), { recursive: true });
  for (const part of ["bin", "src", "connectors.json", "push-check.json"]) {
    cpSync(join(ENGINE, part), join(tilde, "engine", part), { recursive: true });
  }
}

/** One fake machine: a HOME in `tmp` with the home in ~/tilde. `run` and `git` use that HOME. */
export function machine(tmp: string, home: string) {
  const tilde = join(home, "tilde");
  const env = { ...cleanEnv, ...GIT_USER, HOME: home, PATH: `${join(tmp, "stub")}:${process.env.PATH}` };
  // What tilde setup records: the Node that runs the engine.
  mkdirSync(join(home, ".config/tilde"), { recursive: true });
  writeFileSync(join(home, ".config/tilde/node"), `${process.execPath}\n`);

  /** Runs `tilde <args>`; `output` is everything it printed. */
  function run(args: string[], input: unknown = "", extraEnv: Record<string, string> = {}) {
    const options = { input: JSON.stringify(input), encoding: "utf8", env: { ...env, ...extraEnv } } as const;
    const result = spawnSync(join(tilde, "bin/tilde"), args, options);
    return { ok: result.status === 0, stdout: result.stdout, output: result.stdout + result.stderr };
  }

  /** Runs git with this machine's HOME; returns what it printed. */
  function git(...args: string[]): string {
    return execFileSync("git", args, { env, encoding: "utf8" }).trim();
  }

  /** Runs a shell command line in the home, the way launchd or a git hook would; returns what it printed. */
  function shell(command: string): string {
    const result = spawnSync("/bin/bash", ["-c", command], { cwd: tilde, env, encoding: "utf8", input: "" });
    return result.stdout + result.stderr;
  }

  return { home, tilde, run, git, shell };
}

/** One throwaway HOME with the fixture home in it, for the tests that need a single machine. */
export function makeHome() {
  const tmp = makeTmp();
  const home = join(tmp, "h");
  copyHome(join(home, "tilde"));
  const it = machine(tmp, home);

  /** Runs `tilde <args>`; returns what it printed on standard output. */
  function run(args: string[], input: unknown = "", extraEnv: Record<string, string> = {}): string {
    return it.run(args, input, extraEnv).stdout;
  }

  function repo(name: string, branch: string, remote: string): void {
    it.git("init", "-q", "-b", branch, join(tmp, name));
    it.git("-C", join(tmp, name), "remote", "add", "origin", remote);
  }

  return { tmp, home, tilde: it.tilde, run, git: it.git, repo };
}
