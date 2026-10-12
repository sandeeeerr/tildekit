// Checks for the formatter choice of `tilde format`. Run with: node --test engine/test/
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { formatterFor } from "../src/format.ts";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "tilde-format-")));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

/** A project with these files in it; a file in a bin folder is executable. */
function project(name: string, ...files: string[]): void {
  execFileSync("git", ["init", "-q", join(tmp, name)]);
  for (const file of files) touch(join(name, file), file.includes("bin/"));
}

function touch(file: string, executable = false): string {
  const path = join(tmp, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  if (executable) chmodSync(path, 0o755);
  return path;
}

// In real use the file already exists after the edit.
const chosen = (file: string) => basename(formatterFor(touch(file))?.command[0] ?? "none");

test("the formatter is the one the project itself uses", () => {
  project("wp", "vendor/bin/phpcbf", "phpcs.xml.dist", "node_modules/.bin/prettier");
  project("laravel", "vendor/bin/pint");
  project("app", "node_modules/.bin/prettier", ".prettierrc");
  project("bare");

  assert.equal(chosen("wp/functions.php"), "phpcbf");
  assert.equal(chosen("wp/src/js/app.js"), "none", "prettier is there, but without a config the project does not use it");
  assert.equal(chosen("laravel/app/User.php"), "pint");
  assert.equal(chosen("app/src/index.ts"), "prettier");
  assert.equal(chosen("app/node_modules/x/index.js"), "none");
  assert.equal(chosen("bare/index.php"), "none");
});
