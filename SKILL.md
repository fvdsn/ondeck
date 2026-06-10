---
name: smolbrain
description: Per-project task backlog for implementation work. Use to track tasks across sessions, pick the next task to work on, and record progress notes, findings, and blockers. Use at session start, when starting/finishing a task, or when discovering something worth keeping.
allowed-tools: Bash(smolbrain *)
---

# smolbrain - Project task backlog

A per-project, SQLite-backed task list that survives across sessions and context compaction. The store is a `.smolbrain` file at the project root, discovered automatically from any subdirectory. If no store exists, run `smolbrain init` at the project root (ask the user first).

## The work loop

1. **Session start** — `smolbrain status` to see open tasks and recent notes.
2. **Pick work** — `smolbrain next` shows the suggested next task (first todo in list order). It is advisory: scan `smolbrain ls` and pick a different task if it makes more sense. When running alongside parallel agents, use `smolbrain next --claim` to atomically take the task.
3. **While working** — `smolbrain note <id> "..."` immediately when you make a decision, discover something, or hit a blocker. If the context were lost right now, would you lose important information? If yes, write a note.
4. **Finish** — `smolbrain mark <id> done`. Add any follow-up work you discovered with `smolbrain add`.

## Commands

```bash
# Overview: counts, open tasks in order, recent notes
smolbrain status

# Add tasks (end of list by default; order = priority)
smolbrain add "migrate database to v3"
smolbrain add "urgent fix" --top
smolbrain add "follow-up" --after 3
echo "longer description" | smolbrain add

# List and inspect
smolbrain ls               # open tasks (todo, wip, blocked) in order
smolbrain ls done
smolbrain get 3            # full content + notes

# Work loop
smolbrain next             # suggested next task (advisory)
smolbrain next --claim     # atomically take it (parallel-safe)
smolbrain mark 3 wip
smolbrain mark 3 done
smolbrain mark 3 blocked
smolbrain note 3 "found circular FK; migrating users first"

# Reorder (task order is the priority list)
smolbrain move 5 --top
smolbrain move 5 --before 2

# Edit, drop, restore, tags
smolbrain edit 3 "rewritten description"
smolbrain rm 3             # soft-delete
smolbrain restore 3
smolbrain tag 3 backend
smolbrain ls -t backend

# Keyword search over tasks and notes
smolbrain find "migration"
```

All listing commands support `--json` for structured output.

## Guidelines

- Run `smolbrain status` at the start of each session before deciding what to do.
- Write notes as you go, not at the end — after completing a step, making a decision, discovering how something works, or hitting a blocker. Notes are how the next session (or a compacted you) recovers context.
- Keep task content short and actionable; put details and evolving context in notes.
- List order is the priority. If priorities shift, reorder with `move` rather than adding priority markers to task text.
- Mark a task `wip` when you start it and `done` immediately when it's finished. Use `blocked` with a note explaining the blocker.
- Before adding a task, check `smolbrain ls` to avoid duplicates.
- Use `--json` when you need to process output programmatically.
