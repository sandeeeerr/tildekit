// How tilde talks in the terminal: one place for the colors and the symbols, so every command looks the same.
// The shape is the one of clack (create-astro, sv): a title, a gutter down the left, headings, and a closing line.
//
//   ┌  tilde doctor · macbook-pro
//   │
//   ◆  Engine
//   │  ✓ Device: macbook-pro
//   │
//   └  Inbox: 3 candidates
//
// util.styleText does the checks of the CLI guidelines on its own: color only when the stream is a terminal, off
// with NO_COLOR or TERM=dumb, forced with FORCE_COLOR. Errors go to stderr without the gutter, so they read on their
// own in a log. ponytail: no ASCII fallback for the symbols, every terminal on macOS is UTF-8.
import { styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];
type Stream = NodeJS.WriteStream;

/** Colored when this stream is a terminal; plain when it is a pipe or a log. */
const paint = (format: Format, text: string, stream: Stream = process.stdout) => styleText(format, text, { stream });
export const bold = (text: string, stream?: Stream) => paint("bold", text, stream);
export const dim = (text: string, stream?: Stream) => paint("dim", text, stream);
export const red = (text: string, stream?: Stream) => paint("red", text, stream);

const print = (text: string, stream: Stream = process.stdout) => stream.write(`${text}\n`);

/** The first line of a command: `┌  tilde doctor · macbook-pro`. */
export function title(command: string, detail = ""): void {
  const name = bold(["tilde", command].filter(Boolean).join(" "));
  print(`${dim("┌")}  ${name}${detail && dim(` · ${detail}`)}`);
  line();
}

/** A heading: `◆  Rules`, green when all under it is well, red when something failed, `●` when it is just a name. */
export function heading(text: string, ok?: boolean): void {
  const symbol = ok === undefined ? "●" : paint(ok ? "green" : "red", ok ? "◆" : "■");
  print(`${symbol}  ${bold(text)}`);
}

/** A line in the gutter; without text an empty one. A git hook writes to stderr: that is where git looks. */
export function line(text = "", stream: Stream = process.stdout): void {
  print(text ? `${dim("│", stream)}  ${text}` : dim("│", stream), stream);
}

export const ok = (text: string, stream?: Stream) => line(`${paint("green", "✓", stream)} ${text}`, stream);
export const fail = (text: string, stream?: Stream) => line(`${paint("red", "✗", stream)} ${text}`, stream);
export const warn = (text: string, stream?: Stream) => line(`${paint("yellow", "▲", stream)} ${text}`, stream);
export const note = (text: string, stream?: Stream) => line(dim(text, stream), stream);

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

/**
 * A line that moves while `work` runs, `│  ⠹ Running the engine tests 12s`, and wipes itself when the work is done:
 * the caller says how it ended. ponytail: it moves only where the colors are on; a pipe, NO_COLOR and the app's text
 * box get one still line. Its own switch when someone wants color without movement.
 */
export async function spin<T>(text: string, work: Promise<T>, stream: Stream = process.stdout): Promise<T> {
  if (dim("x", stream) === "x") {
    line(`${text}…`, stream);
    return work;
  }
  const started = Date.now();
  let frame = 0;
  const draw = () => {
    const seconds = dim(`${Math.floor((Date.now() - started) / 1000)}s`, stream);
    stream.write(`\r${dim("│", stream)}  ${FRAMES[frame++ % FRAMES.length]} ${text} ${seconds}`);
  };
  draw();
  const timer = setInterval(draw, 80);
  try {
    return await work;
  } finally {
    clearInterval(timer);
    stream.write("\r\x1b[2K"); // back to the start of the line and erase it
  }
}

/** Names with their explanation in two columns, for the help. */
export function table(rows: [string, string][]): void {
  const width = Math.max(...rows.map(([name]) => name.length));
  for (const [name, text] of rows) line(`${name.padEnd(width)}   ${dim(text)}`);
}

/** The closing line: `└  Inbox: 3 candidates`. */
export function end(text = ""): void {
  print(`${dim("└")}  ${text}`.trimEnd());
}

/** An error: red, on stderr, without the gutter. */
export function error(text: string): void {
  print(red(text, process.stderr), process.stderr);
}

/** `1 change`, `2 changes`. */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
