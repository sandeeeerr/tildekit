// tilde archive: keeps project files light. The session start loads the whole project file, so once its log
// passes the budget the oldest entries move to context/archive/<project>.md. Nothing is deleted.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { TILDE } from "./config.ts";
import * as ui from "./ui.ts";

/** Bytes of log a project file may carry before the session start asks for `tilde archive`. */
export const BUDGET = 10_000;
/** Bytes of log that stay, the newest entries, so one run lasts a while. */
const KEEP = 5_000;

const HEADING = /^## (Logboek|Logbook|Log)[ \t]*$/;

type Log = { before: string[]; entries: string[]; after: string[] };

/** The log section of a project file: an entry is a line that starts with "- ", with the lines that follow it. */
function parse(text: string): Log | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) return undefined;
  const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const end = next === -1 ? lines.length : next;
  const first = lines.findIndex((line, i) => i > start && i < end && line.startsWith("- "));
  if (first === -1) return undefined;
  const entries: string[] = [];
  for (const line of lines.slice(first, end)) {
    if (line.startsWith("- ")) entries.push(line);
    else entries[entries.length - 1] += `\n${line}`;
  }
  const tidy = entries.map((entry) => entry.replace(/\n+$/, "")); // blank lines between and after entries go
  return { before: lines.slice(0, first), entries: tidy, after: lines.slice(end) };
}

const bytes = (text: string) => Buffer.byteLength(text);

/** How many bytes of log entries a project file has. */
export function logSize(text: string): number {
  return (parse(text)?.entries ?? []).reduce((sum, entry) => sum + bytes(entry), 0);
}

/**
 * The project file with only its newest entries, up to `keep` bytes, and the older ones to archive.
 * Nothing to move gives undefined. `link` is the line under the heading that points to the archive.
 */
export function splitLog(text: string, link: string, keep = KEEP): { kept: string; moved: string[] } | undefined {
  const log = parse(text);
  if (!log) return undefined;
  let size = 0;
  let from = log.entries.length;
  // The newest entry always stays, however long it is.
  while (from > 0 && (from === log.entries.length || size + bytes(log.entries[from - 1]) <= keep)) {
    size += bytes(log.entries[--from]);
  }
  if (from === 0) return undefined;
  const before = log.before.includes(link) ? log.before : [...log.before, link, ""];
  const kept = [...before, ...log.entries.slice(from), ...(log.after.length ? ["", ...log.after] : [""])];
  return { kept: kept.join("\n"), moved: log.entries.slice(0, from) };
}

/** Archives every project file whose log is over the budget. */
export function archive(): void {
  const projects = join(TILDE, "context/projects");
  const folder = join(TILDE, "context/archive");
  let done = 0;
  ui.title("archive");
  for (const name of readdirSync(projects).filter((file) => file.endsWith(".md")).sort()) {
    const file = join(projects, name);
    const text = readFileSync(file, "utf8");
    if (logSize(text) <= BUDGET) continue;
    const link = `Older entries: [\`context/archive/${name}\`](../archive/${name})`;
    const split = splitLog(text, link);
    if (!split) continue;
    mkdirSync(folder, { recursive: true });
    const target = join(folder, name);
    if (!existsSync(target)) writeFileSync(target, `# ${basename(name, ".md")}: archived log\n\n`);
    appendFileSync(target, `${split.moved.join("\n")}\n`);
    writeFileSync(file, split.kept);
    const kb = (size: number) => `${Math.round(size / 1000)} KB`;
    ui.ok(`${name}: ${split.moved.length} entries to context/archive/${name} (${kb(bytes(text))} -> ${kb(bytes(split.kept))})`);
    done++;
  }
  if (done > 0) ui.line();
  ui.end(done === 0 ? "Every log is within the budget." : `${ui.count(done, "project file")} lightened.`);
}
