---
name: curator
description: Sort the Tilde inbox: a proposal per candidate (rule, project file, skill or drop), and only apply what the user approves. Use for "sort", "curator", "clean up the inbox", or when the session start says it is time to sort.
---

# Sorting

Goal: the inbox is empty, or every item that stays has a reason to stay. AGENTS.md stays under 80 lines while you do it.

## Steps

1. Read `~/tilde/inbox.md`.
2. Merge candidates that are doubles or that belong together.
3. Pick one destination per candidate, and be strict:
   - **Rule**: changes behaviour in every project, and the model does not do it by itself already. Name the section in `AGENTS.md` or the skill, with the exact new text.
   - **Project file**: holds for one project. Name the file and the text.
   - **Skill**: a way of working that comes back and is too long for a rule. Name the skill (new or existing).
   - **Drop**: one-off, already covered, outdated or trivial. Give the reason in a few words.

   If a candidate repeats a rule that is already in `AGENTS.md` or a skill, mark it as a **repeat** and name that rule: the rule does not work then and has to be sharper; it does not need a second rule.
4. Show all proposals as a numbered list with the diff per proposal. Wait for the user's yes: per number, or "all".
5. Apply only what was approved. Take the processed lines out of the inbox. Then write one line in the log of `context/projects/tilde.md`: `- YYYY-MM-DD · Curator: <n> candidates: <n> rule, <n> project file, <n> skill, <n> code, <n> dropped, <n> stay; repeats: <which rules, or none>.`
6. If a project file's log has grown heavy, run `~/tilde/bin/tilde archive`.
7. Run `~/tilde/bin/tilde doctor` and say what is still red.
