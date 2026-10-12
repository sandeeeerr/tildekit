// Checks for tilde help and for the colors of the terminal output. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { machine, makeHome } from "./home.ts";

const { tmp, home } = makeHome();
const { run } = machine(tmp, home);
const ESCAPE = "\u001b[";

test("help lists every command with a line of explanation, the home's own included", () => {
  const text = run(["help"]).stdout;
  const names = ["doctor", "sync [message]", "archive", "setup [device]", "uninstall", "build", "leak-check", "guard", "hello"];
  for (const name of names) assert.ok(text.includes(name), name);
  assert.ok(text.includes("Says hello from the home"), "the explanation the extension gives");
  assert.equal(run([]).stdout, text, "a bare tilde shows the same");
  assert.equal(run(["--help"]).stdout, text);
});

test("color only on a terminal: none when piped, all with FORCE_COLOR, none again with --no-color", () => {
  assert.ok(!run(["help"]).stdout.includes(ESCAPE));
  assert.ok(run(["help"], "", { FORCE_COLOR: "1" }).stdout.includes(ESCAPE));
  assert.ok(!run(["help", "--no-color"], "", { FORCE_COLOR: "1" }).stdout.includes(ESCAPE));
});
