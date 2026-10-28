// The launchd job that runs `tilde sync --auto` every 15 minutes.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONF, HOME, TILDE, home, readText } from "./config.ts";

const LABEL = home.sync?.label ?? "local.tilde.sync";
const PLIST = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const DOMAIN = `gui/${process.getuid?.()}`;
// launchd starts with almost no PATH; git and gitleaks live here.
export const PATH ="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * What launchd runs: the approved engine/ from the remote, unpacked in a temp dir, not the local working copy.
 * So a local change to the engine cannot switch the push check off before the user has approved it.
 * ponytail: without an upstream, or with a remote that has no engine/ yet, nothing runs (closed); the session start
 * and tilde doctor show that.
 */
export function syncCommand(): string {
  const unpack = `d="$(mktemp -d)" && git archive "@{u}" engine | tar -x -C "$d"`;
  const run = `TILDE_HOME="${TILDE}" "$d/engine/bin/tilde" sync --auto`;
  return `cd "${TILDE}" && ${unpack} && ${run}; s=$?; rm -rf "$d"; exit $s`;
}

export function installSyncJob(): void {
  const log = join(CONF, "sync.log");
  const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const args = `<string>/bin/bash</string><string>-c</string><string>${xml(syncCommand())}</string>`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args}</array>
  <key>StartInterval</key><integer>900</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATH}</string></dict>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
  mkdirSync(dirname(PLIST), { recursive: true });
  mkdirSync(CONF, { recursive: true });
  writeFileSync(PLIST, plist);
  spawnSync("launchctl", ["bootout", `${DOMAIN}/${LABEL}`], { stdio: "ignore" }); // the old job, when there is one
  spawnSync("launchctl", ["bootstrap", DOMAIN, PLIST], { stdio: "inherit" });
}

/** Stops the job and removes its plist. */
export function removeSyncJob(): void {
  spawnSync("launchctl", ["bootout", `${DOMAIN}/${LABEL}`], { stdio: "ignore" });
  rmSync(PLIST, { force: true });
}

/** Does the installed job run the approved engine? */
export const jobRunsApprovedEngine = () => (readText(PLIST) ?? "").includes("git archive");

export function jobIsLoaded(): boolean {
  return spawnSync("launchctl", ["print", `${DOMAIN}/${LABEL}`], { stdio: "ignore" }).status === 0;
}
