// tilde format: runs the project's own formatter on a file right after Claude edited it (PostToolUse on Edit or Write).
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readJson } from "./config.ts";

const PRETTIER_FILES = /\.(js|jsx|mjs|cjs|ts|tsx|vue|css|scss|json|md)$/;

export function format(file: string): void {
  if (!existsSync(file)) return;
  const formatter = formatterFor(file);
  if (!formatter) return;
  try {
    execFileSync(formatter.command[0], [...formatter.command.slice(1), file], { cwd: formatter.root, stdio: "ignore" });
  } catch {
    // a failing formatter must never block the edit
  }
}

/** The format command for this file, or nothing when the project has none. */
export function formatterFor(file: string): { root: string; command: string[] } | undefined {
  if (file.includes("/vendor/") || file.includes("/node_modules/")) return;
  const root = repoRoot(dirname(file));
  if (!root) return;
  const has = (start: string) => readdirSync(root).some((name) => name.startsWith(start));

  if (file.endsWith(".php")) {
    const phpcbf = join(root, "vendor/bin/phpcbf");
    const pint = join(root, "vendor/bin/pint");
    if (runnable(phpcbf) && (has("phpcs.xml") || has(".phpcs.xml"))) return { root, command: [phpcbf, "-q"] };
    if (runnable(pint)) return { root, command: [pint, "-q"] };
  }
  if (PRETTIER_FILES.test(file)) {
    // ponytail: Prettier only when the project really uses it; ESLint belongs in the checks, not after every edit.
    const prettier = join(root, "node_modules/.bin/prettier");
    const inPackage = Boolean(readJson<{ prettier?: unknown }>(join(root, "package.json"))?.prettier);
    const configured = has(".prettierrc") || has("prettier.config.") || inPackage;
    if (runnable(prettier) && configured) return { root, command: [prettier, "--write", "--log-level=silent"] };
  }
}

function repoRoot(dir: string): string | undefined {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] } as const;
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], options).trim();
  } catch {
    return undefined;
  }
}

function runnable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
