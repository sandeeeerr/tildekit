// Checks for `tilde ssh|scp|rsync`: only own hosts, and no option that picks another route.
import assert from "node:assert/strict";
import { test } from "node:test";
import { refusal } from "../src/remote.ts";
import { copyHome, machine, makeTmp } from "./home.ts";

const own = ["box"];

test("only own hosts", () => {
  assert.equal(refusal("ssh", ["box", "docker ps"], own), undefined);
  assert.equal(refusal("ssh", ["me@box", "ls"], own), undefined);
  assert.ok(refusal("ssh", ["server-prod", "ls"], own));
  assert.ok(refusal("ssh", ["-J", "server-prod", "box"], own), "the host goes first");
  assert.ok(refusal("ssh", ["box"], []), "no own hosts, nothing goes");
  assert.equal(refusal("scp", ["-r", "box:/srv/a", "/tmp/a"], own), undefined);
  assert.equal(refusal("rsync", ["-avz", "--delete", "./site/", "box:~/site/"], own), undefined);
  assert.ok(refusal("rsync", ["-a", "box:a", "server-prod:b"], own));
  assert.ok(refusal("rsync", ["-a", "a", "b"], own), "no remote side");
});

test("no other route", () => {
  assert.ok(refusal("rsync", ["-avze", "ssh -J server-prod", "a", "box:b"], own));
  assert.ok(refusal("rsync", ["--rsync-path=sudo rsync", "a", "box:b"], own));
  assert.ok(refusal("scp", ["-o", "ProxyJump=server-prod", "a", "box:b"], own));
  assert.ok(refusal("scp", ["-rJ", "server-prod", "a", "box:b"], own));
});

test("the command refuses before it connects", () => {
  const tmp = makeTmp();
  copyHome(`${tmp}/h/tilde`);
  const result = machine(tmp, `${tmp}/h`).run(["ssh", "server-prod", "ls"]);
  assert.equal(result.ok, false);
  assert.match(result.output, /one of box/);
});
