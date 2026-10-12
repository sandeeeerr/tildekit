// Fixture extension: what a home can add to the engine.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "../engine/src/config.ts";
import { type Extension, check } from "../engine/src/local.ts";

export default {
  commands: {
    hello: (args) => console.log(["hello from the home", ...args].join(" ")),
  },
  help: { hello: "Says hello from the home" },
  guards: {
    hello: () => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "fixture" },
    }),
  },
  setup: () => writeFileSync(join(HOME, ".hello-setup"), ""),
  doctor: () => [check(true, "Hello: local check ran", "Hello: local check failed")],
  session: () => (existsSync(join(HOME, ".hello-session")) ? ["hello from the session start"] : []),
} satisfies Extension;
