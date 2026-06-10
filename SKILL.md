---
name: ondeck
description: Per-project task backlog for implementation work. Use to track tasks across sessions, pick the next task to work on, and record progress notes, findings, and blockers. Use at session start, when starting/finishing a task, or when discovering something worth keeping.
allowed-tools: Bash(ondeck *)
---

# ondeck - Project task backlog

A per-project, SQLite-backed task list that survives across sessions and context compaction. The store is a `.ondeck` file at the project root, discovered automatically from any subdirectory. If no store exists, run `ondeck init` at the project root (ask the user first).

## The work loop

1. **Session start** — `ondeck status` to see open tasks and recent notes.
2. **Pick work** — `ondeck next` shows the suggested next task (first todo in list order). It is advisory: scan `ondeck ls` and pick a different task if it makes more sense. When running alongside parallel agents, use `ondeck next --claim` to atomically take the task.
3. **While working** — `ondeck note <id> "..."` immediately when you make a decision, discover something, or hit a blocker. If the context were lost right now, would you lose important information? If yes, write a note.
4. **Finish** — `ondeck mark <id> done`. Add any follow-up work you discovered with `ondeck add`.

## Commands

```bash
# Overview: counts, open tasks in order, recent notes
ondeck status

# Add tasks (end of list by default; order = priority)
ondeck add "migrate database to v3"
ondeck add "urgent fix" --top
ondeck add "follow-up" --after 3
echo "longer description" | ondeck add

# List and inspect
ondeck ls               # open tasks (todo, wip, blocked) in order
ondeck ls done
ondeck get 3            # full content + notes

# Work loop
ondeck next             # suggested next task (advisory)
ondeck next --claim     # atomically take it (parallel-safe)
ondeck mark 3 wip
ondeck mark 3 done
ondeck mark 3 blocked
ondeck note 3 "found circular FK; migrating users first"

# Reorder (task order is the priority list)
ondeck move 5 --top
ondeck move 5 --before 2

# Edit, drop, restore, tags
ondeck edit 3 "rewritten description"
ondeck rm 3             # soft-delete
ondeck restore 3
ondeck tag 3 backend
ondeck ls -t backend

# Keyword search over tasks and notes
ondeck find "migration"
```

All listing commands support `--json` for structured output.

## Guidelines

- Run `ondeck status` at the start of each session before deciding what to do.
- Write notes as you go, not at the end — after completing a step, making a decision, discovering how something works, or hitting a blocker. Notes are how the next session (or a compacted you) recovers context.
- Keep task content short and actionable; put details and evolving context in notes.
- List order is the priority. If priorities shift, reorder with `move` rather than adding priority markers to task text.
- Mark a task `wip` when you start it and `done` immediately when it's finished. Use `blocked` with a note explaining the blocker.
- Before adding a task, check `ondeck ls` to avoid duplicates.
- Use `--json` when you need to process output programmatically.
