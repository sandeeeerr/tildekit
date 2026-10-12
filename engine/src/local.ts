// What a home adds to the engine: every local/<name>.ts in the home, with a default export of the shape below.
// Sync and push-check never load them: those run the approved engine from the remote, not the home's own code.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TILDE } from "./config.ts";

/** One line of tilde doctor. */
export type Check = { ok: boolean; text: string };
export const check = (ok: boolean, good: string, bad: string): Check => ({ ok, text: ok ? good : bad });

/** The JSON a tool hook gets from Claude before a tool call. */
export type ToolCall = { tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string };

export type Extension = {
  /** `tilde <name> [arguments]` */
  commands?: Record<string, (args: string[]) => void | Promise<void>>;
  /** One line per command, for tilde help. */
  help?: Record<string, string>;
  /** `tilde guard <name>`: gets the tool call, returns the hook reply to print. Nothing means: allowed. */
  guards?: Record<string, (call: ToolCall) => object | undefined>;
  /** A step at the end of tilde setup. */
  setup?: () => void;
  /** Extra lines for tilde doctor. */
  doctor?: () => Check[];
  /** Extra lines for tilde session-start: what needs the user's attention. Gets the folder of the session. */
  session?: (cwd: string) => string[];
};

export async function loadLocal(): Promise<Extension[]> {
  const dir = join(TILDE, "local");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".ts")).sort();
  } catch {
    // a home without local/ adds nothing
  }
  const modules = await Promise.all(names.map((name) => import(pathToFileURL(join(dir, name)).href)));
  return modules.map((module) => module.default as Extension);
}
