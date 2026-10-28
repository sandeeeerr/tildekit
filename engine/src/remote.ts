// tilde ssh|scp|rsync: the same commands without a confirmation prompt, but only to the hosts in tilde.json
// (ssh.own_hosts). Claude's ask rules and the Codex rules match on the first word (ssh, scp, rsync), so this form does
// not ask; the host check here is the gate. Plain ssh, scp and rsync keep asking, for every host.
// ponytail: tilde.json is the trust anchor and an agent can edit it like any file in the home. Upgrade: an ask rule on
// writes to tilde.json once that matters.
import { spawnSync } from "node:child_process";
import { home } from "./config.ts";

// Options that pick another remote shell or a jump host, so the call would reach a host this check never saw.
const OTHER_ROUTE: Record<string, RegExp> = {
  scp: /^-[^-]*[JoSF]/,
  rsync: /^(-[^-]*e|--rsh|--rsync-path)/,
};

/** Why this call may not go through, or undefined when every remote side is an own host. */
export function refusal(tool: string, args: string[], ownHosts: string[]): string | undefined {
  const own = (host: string) => ownHosts.includes(host.replace(/^[^@]*@/, ""));
  const hosts = ownHosts.join(", ") || "none (ssh.own_hosts in tilde.json)";
  if (tool === "ssh") {
    // The host comes first: everything after it is the remote command, so no option can add a jump host.
    return own(args[0] ?? "") ? undefined : `tilde ssh <host> [command]: the host goes first and is one of ${hosts}.`;
  }
  const route = args.find((arg) => OTHER_ROUTE[tool].test(arg));
  if (route) return `tilde ${tool}: ${route} picks its own route to a host; use plain ${tool}, which asks.`;
  // A host:path names a remote side; a local path with a colon in it counts as one too and gets refused.
  const remotes = args.filter((arg) => !arg.startsWith("-")).flatMap((arg) => /^([^/:]+):/.exec(arg)?.[1] ?? []);
  if (remotes.length === 0) return `tilde ${tool}: no host:path in the arguments.`;
  const other = remotes.find((host) => !own(host));
  return other ? `tilde ${tool}: ${other} is not an own host (${hosts}); use plain ${tool}, which asks.` : undefined;
}

export function remote(tool: string, args: string[]): void {
  const why = refusal(tool, args, home.ssh?.own_hosts ?? []);
  if (why) {
    console.error(why);
    process.exitCode = 1;
    return;
  }
  process.exitCode = spawnSync(tool, args, { stdio: "inherit" }).status ?? 1;
}
