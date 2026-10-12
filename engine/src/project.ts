// Which project file and which domain belong to a folder.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HOME, TILDE, home } from "./config.ts";

const PROJECTS = join(TILDE, "context/projects");

function git(dir: string, ...args: string[]): string {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] } as const;
    return execFileSync("git", ["-C", dir, ...args], options).trim();
  } catch {
    return ""; // not a repo, or nothing to report
  }
}

/** The remote as host/owner/repo, or "" without one. An ssh alias from tilde.json counts as the real host. */
export function remoteOf(dir: string): string {
  let remote = git(dir, "remote", "get-url", "origin")
    .replace(/^[a-z+]+:\/\//, "") // https://
    .replace(/^[^@/]*@/, "") // git@
    .replace(":", "/")
    .replace(/\.git$/, "");
  for (const [alias, host] of Object.entries(home.git?.ssh_aliases ?? {})) {
    const safe = /^[A-Za-z0-9._-]+$/.test(alias + host);
    if (safe && remote.startsWith(`${alias}/`)) remote = host + remote.slice(alias.length);
  }
  return remote;
}

/** The project file whose front matter names this repo, by its remote (repos:) or its folder (paths: or paden:). */
export function projectFile(dir: string): string | undefined {
  const remote = remoteOf(dir);
  const top = git(dir, "rev-parse", "--show-toplevel") || dir;
  const folder = `~${top.startsWith(HOME) ? top.slice(HOME.length) : top}`;
  return projectFiles().find((file) => {
    const keys = frontMatter(file).map((line) => line.replace(/^[ \t]*-[ \t]+/, "").replace(/[ \t]+$/, ""));
    return (remote !== "" && keys.includes(remote)) || keys.includes(folder);
  });
}

function projectFiles(): string[] {
  try {
    const names = readdirSync(PROJECTS).filter((name) => name.endsWith(".md"));
    return names.sort().map((name) => join(PROJECTS, name));
  } catch {
    return [];
  }
}

/** The lines between the two --- at the top of a file. */
function frontMatter(file: string): string[] {
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  return lines.slice(1, end === -1 ? undefined : end);
}

/** Strict or free, under the names from tilde.json. The project file decides; otherwise the remote does. */
export function domainOf(dir: string): string {
  const strict = home.domains?.strict?.name ?? "strict";
  const free = home.domains?.free?.name ?? "free";
  const file = projectFile(dir);
  if (file) {
    const line = readFileSync(file, "utf8").split("\n").find((l) => /^(domein|domain):/.test(l));
    const named = line?.split(/: */)[1];
    if (named) return named;
  }
  const remote = remoteOf(dir);
  if (remote === "") return strict; // without a remote the strict level applies
  return (home.domains?.strict?.remotes ?? []).some((start) => remote.startsWith(start)) ? strict : free;
}
