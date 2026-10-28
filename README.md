# Tildekit

Your agents remember what you teach them. Tildekit is a folder of plain text that every coding agent reads when a session starts. A correction you give becomes a proposal, and you decide what becomes a rule.

More on [tildekit.dev](https://tildekit.dev).

## What you get

- **One folder, `~/tilde`**: your rules (`AGENTS.md`), your skills, and a project file per project. Markdown, in git.
- **Capture**: when you correct an agent, it adds one line to `inbox.md`.
- **Sort**: say "sort" and the skill `curator` turns the inbox into proposals: a rule, a project note, a skill, or nothing.
- **Approve**: rules, skills and the engine only reach your other Macs after you say yes in your own terminal.

Claude Code imports the rules and runs the hooks (session start, guard, formatter). Codex and Cursor read a copy of the rules and the same skills; the author tests on Claude Code, so those two come without a promise.

## Install

You need macOS, Node 22.18 or newer, git and [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`).

1. Press **Use this template** and make a **private** repository: your rules and project notes will live in it.
2. Clone it as `~/tilde` and connect this Mac:

   ```sh
   git clone git@github.com:you/tildekit.git ~/tilde
   ~/tilde/bin/tilde setup
   ```

3. Open `~/tilde/AGENTS.md` and fill in the first two lines: who you are and the language you want to be spoken to in. The rest are the author's own rules; keep, change or delete them.

On a second Mac you repeat step 2. Git then keeps them in step every fifteen minutes.

### What setup touches

Setup only adds what is its own and keeps a copy of what it overwrites in `~/.tilde-backup`:

- `~/.claude/CLAUDE.md` (imports your rules), `~/.claude/settings.json` (hooks, and rules that ask or deny)
- `~/.codex/AGENTS.md`, `~/.codex/rules/tilde.rules`, `~/.cursor/rules/tilde.mdc`, `~/.cursor/hooks.json`
- links to your skills in `~/.claude/skills` and `~/.agents/skills`
- for an extra Claude account (`~/.claude_<name>`, used through `CLAUDE_CONFIG_DIR`): `settings.json` as a link to the one in `~/.claude`, and the same skills
- the command `tilde` in `~/.local/bin`, a launchd job for the sync, and `~/.config/tilde`

`tilde uninstall` takes all of that out again. Your home in `~/tilde` stays.

## Every day

| Command | What it does |
| --- | --- |
| `tilde doctor` | Is everything in place, and is anything waiting for you? |
| `tilde sync [message]` | Commit, pull and push the home; a push with rules, skills or code waits for your `y` |
| `tilde archive` | Move the oldest log entries of a heavy project file aside |
| `tilde ssh <host> [command]` | SSH without a prompt, but only to a host in `ssh.own_hosts`; `tilde scp` and `tilde rsync` likewise |
| `tilde help` | Every command |

The sync job pushes notes and logs by itself. A change to `AGENTS.md`, a skill, `tilde.json` or `engine/` is held back, and so is any added line that looks like a prompt injection. You see what is waiting at the start of a session and in `tilde doctor`, and you approve it with `tilde sync` in your own terminal.

## The home

```
AGENTS.md          your rules, read by every tool
CONTEXT.md         the words this home uses
inbox.md           candidates waiting to be sorted
tilde.json         your own values: domains, connectors, protected paths
context/projects/  one file per project, with a log
plans/             a short plan per feature (skill architect)
skills/            your skills; curator and architect come with the kit
devices/           what is only true on one Mac
engine/            the code: TypeScript that runs on Node as it is, no packages
local/             your own commands, checks and guards (optional)
```

In `tilde.json`:

- `domains`: the names of your two domains, and the remotes that count as the strict one. A repo without a remote counts as strict.
- `connectors`: the ID of an MCP connector you want watched, for example `"slack": "mcp__..."`. Reading is free, writing asks for a click, deleting is closed. The lists per connector are in `engine/connectors.json`.
- `guard.protected`: paths the shell must not touch, with the reason.
- `ssh.own_hosts`: your own machines, for `tilde ssh`, `scp` and `rsync`. Any other ssh keeps asking.
- `claude`: settings, deny rules and hooks you want in Claude's `settings.json` on every Mac.

## Updating the engine

Your home is your own repository, so an update is something you take:

```sh
git -C ~/tilde remote add kit https://github.com/sandeeeerr/tildekit.git   # once
git -C ~/tilde fetch kit
git -C ~/tilde checkout kit/main -- engine .githooks bin/tilde
tilde sync "Update the engine"
```

The sync runs the engine's tests and then asks for your `y`, as for any change to code.

## What it is not

- Not a sandbox. The guard stops gross mistakes such as a force push or a skipped hook; it is a seat belt.
- Not a service. Nothing is hosted and nothing phones home; sync is git to a remote you choose.
- Not supported. It is the author's own setup, tested on macOS with Claude Code. Updates come when they come.

The tests are the specification: `~/tilde/engine/test/run.sh`.

## License

MIT. Made by [Sander de Vries](https://sanderr.nl/).
