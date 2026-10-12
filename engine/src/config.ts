// What the engine reads: the home's own values (tilde.json) and the connector policy (engine/connectors.json).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.HOME ?? homedir();
// The home: rules, project files and tilde.json. The engine itself may run from elsewhere.
export const TILDE = process.env.TILDE_HOME ?? join(HOME, "tilde");
// What tilde keeps per machine, outside the home: the device name, the Node path, the state of the sync.
export const CONF = join(HOME, ".config/tilde");

/** Reads a JSON file; a missing or broken file gives undefined, so the caller falls back to its defaults. */
export function readJson<T>(path: string | URL): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Reads a text file, or undefined when it is not there. */
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** Local date and time as "yyyy-mm-dd hh:mm:ss"; cut it to the part you need. */
export function localTime(date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

type Home = {
  connectors?: Record<string, string>;
  guard?: { protected?: { pattern?: string; reason?: string }[] };
  // Two fixed levels with their own names. A remote that starts with one of the strict remotes is strict.
  domains?: { strict?: { name?: string; remotes?: string[] }; free?: { name?: string } };
  git?: { identity?: { config?: string; remotes?: string[] }; ssh_aliases?: Record<string, string> };
  sync?: { label?: string }; // the name of the launchd job
  leak?: { terms?: string[] }; // extra words that must never appear in engine/
  // What the home adds to Claude's settings.json; hook commands are relative to the home.
  claude?: {
    settings?: Record<string, unknown>;
    deny?: string[];
    hooks?: { PreToolUse?: { matcher?: string; command: string; timeout?: number }[] };
  };
};
type Kind = "read" | "ask" | "deny";
type Policy = { prefix: string } & Record<Kind, string[]>;

/** The home's own values. A missing or broken tilde.json leaves the defaults. */
export const home = readJson<Home>(join(TILDE, "tilde.json")) ?? {};
const policyFile = new URL("../connectors.json", import.meta.url);
const policies = readJson<{ connectors: Record<string, Policy> }>(policyFile)?.connectors ?? {};

/** Paths the shell must not touch, with the reason shown when one is hit (guard.protected in tilde.json). */
export const protectedPaths = home.guard?.protected ?? [];

/** Account ID per watched connector. A connector without an ID in tilde.json is not watched. */
export const connectorIds: Record<string, string> = Object.fromEntries(
  Object.keys(policies).flatMap((key) => (home.connectors?.[key] ? [[key, home.connectors[key]]] : [])),
);

/** The full tool names of one kind, for every watched connector. */
export function tools(kind: Kind): Set<string> {
  const names = Object.entries(connectorIds).flatMap(([key, id]) => {
    const policy = policies[key];
    return policy[kind].map((tool) => `${id}__${policy.prefix}${tool}`);
  });
  return new Set(names);
}
