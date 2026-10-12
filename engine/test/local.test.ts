// Checks for what a home adds through local/, and for tilde leak-check. Run with: node --test engine/test/
// The setup step and the doctor check of the fixture extension are checked in setup.test.ts.
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { machine, makeHome } from "./home.ts";

const { tmp, home, tilde } = makeHome();
const { run } = machine(tmp, home);

test("a home adds a command and a guard", () => {
  assert.equal(run(["hello"]).stdout, "hello from the home\n");
  assert.equal(run(["hello", "again"]).stdout, "hello from the home again\n", "arguments are passed on");
  const reply = JSON.parse(run(["guard", "hello"], {}).stdout);
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
});

test("a home adds lines to the session start", () => {
  assert.ok(!run(["session-start"]).stdout.includes("hello from the session start"));
  writeFileSync(join(home, ".hello-session"), "");
  assert.ok(run(["session-start"]).stdout.endsWith("hello from the session start\n"));
});

test("what the home does not have fails", () => {
  const unknownGuard = run(["guard", "nope"], {});
  assert.ok(!unknownGuard.ok);
  assert.ok(unknownGuard.output.includes("no guard named nope"));
  const unknownCommand = run(["no-such-command"]);
  assert.ok(!unknownCommand.ok);
  assert.ok(unknownCommand.output.includes('unknown command "no-such-command"'));
});

test("leak-check finds a private value of the home in the engine", () => {
  const secret = `zq${process.pid}x${Date.now()}private`; // made up on the spot, so it cannot already be in the engine
  writeFileSync(join(tilde, "tilde.json"), JSON.stringify({ leak: { terms: [secret] } }));
  assert.ok(run(["leak-check"]).ok, "a clean engine passes");
  appendFileSync(join(tilde, "engine/src/config.ts"), `// ${secret.toUpperCase()}\n`);
  const found = run(["leak-check"]);
  assert.ok(!found.ok, "the check fails");
  assert.match(found.output, /^engine\/src\/config\.ts:\d+:/, "and names the file and the line");
});
