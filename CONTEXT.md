# Tilde

Your home for coding agents: one repo with rules, context and skills that Claude Code, Codex and Cursor load on every Mac.

## Language

**Tilde**:
The home: one repo with rules, context and skills.

**Domain**:
Whether a project is work or own. The names and the remotes that count as work are in `tilde.json`.
_Avoid_: type, role

**Project**:
One assignment or product with one goal. Can span several repos.
_Avoid_: site, repo, customer

**Repo**:
One git repository. Belongs to at most one project.
_Avoid_: project, site

**Project file**:
The file in Tilde with the domain, the repos and the context of one project.
_Avoid_: project note, README

**Log**:
The part of a project file with decisions, the state of affairs, pitfalls and loose ends.
_Avoid_: notes, session report, changelog

**Plan**:
The short developer's plan of one feature: scope, decisions with the why, open questions and phases. Lives in `plans/<project>/<feature>/plan.md`.
_Avoid_: PRD, spec, brief

**Source**:
A document, mail, notes or sketch as the user got it or said it. Stays unchanged in `sources/` next to the plan.
_Avoid_: input, briefing

**Inbox**:
The list of candidates that an agent or the user wrote down and that wait to be sorted.
_Avoid_: memory, scratchpad

**Rule**:
An instruction that always holds for the agent. Only the user makes something a rule.
_Avoid_: feedback, preference, memory

**Sorting**:
Going through the inbox now and then and deciding per candidate: rule, project file, skill or drop (skill `curator`).
_Avoid_: cleaning up, promoting
