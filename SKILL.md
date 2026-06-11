---
name: ondeck
description: Per-project task backlog for implementation work. Use to track tasks across sessions, pick the next task to work on, group work into topics, and record progress notes, findings, and blockers. Use at session start, when starting/finishing a task, or when discovering something worth keeping.
allowed-tools: Bash(ondeck *)
---

# ondeck - Project task backlog

A per-project, SQLite-backed task list that survives across sessions and context compaction. The store is a `.ondeck` file at the project root, discovered automatically from any subdirectory. If no store exists, run `ondeck init` at the project root (ask the user first).

## The work loop

1. **Session start** — `ondeck status` for open tasks and recent notes; `ondeck topics` to see the streams of work.
2. **Pick work** — `ondeck next` shows the suggested next task (first todo in list order); scope it with `-t <topic>` when working a topic. It is advisory: scan `ondeck ls` and pick a different task if it makes more sense. When running alongside parallel agents, use `ondeck next --claim` to atomically take the task.
3. **While working** — `ondeck note <id> '...'` immediately when you make a decision, discover something, or hit a blocker. If the context were lost right now, would you lose important information? If yes, write a note.
4. **Finish** — `ondeck mark <id> done`. Add any follow-up work you discovered with `ondeck add`.

## Topics

A topic groups the tasks of one stream of work (a feature, a refactor, an investigation). Each task belongs to at most one topic.

- Starting a multi-task effort? Put its tasks in a topic: `ondeck add -t auth-refactor "..."`.
- Working a topic? Scope your loop: `ondeck next -t auth-refactor`, `ondeck ls -t auth-refactor`.
- Interrupted or switching topics? Note your current task, set it back to `todo` (or `blocked`), and work the other topic. The notes carry the context for resuming.
- Topic abandoned? `ondeck rm -t auth-refactor` drops all its open tasks at once (done tasks are kept).

## Commands

```bash
# Overview
ondeck status              # counts, open tasks in order, recent notes
ondeck topics              # topics with counts per status

# Add tasks (end of list by default; order = priority)
ondeck add "migrate database to v3"
ondeck add -t auth-refactor "rotate signing keys"
ondeck add "urgent fix" --top
ondeck add "follow-up" --after 3
echo "longer description" | ondeck add

# List and inspect
ondeck ls                  # open tasks (todo, wip, blocked) in order
ondeck ls done
ondeck ls -t auth-refactor
ondeck get 3               # full content + notes

# Work loop
ondeck next                # suggested next task (advisory)
ondeck next -t auth-refactor --claim   # atomically take it (parallel-safe)
ondeck mark 3 wip
ondeck mark 3 done
ondeck mark 3 blocked
ondeck note 3 'found circular FK; migrating users first'

# Reorder (task order is the priority list)
ondeck move 5 --top
ondeck move 5 --before 2

# Topics, edit, drop, restore
ondeck topic 7 auth-refactor
ondeck topic 7 --clear
ondeck edit 3 "rewritten description"
ondeck rm 3                # soft-delete one task
ondeck rm -t auth-refactor # drop all open tasks of a topic
ondeck restore 3

# Keyword search over tasks and notes
ondeck find "migration"
```

All listing commands support `--json` for structured output.

## Guidelines

- Run `ondeck status` at the start of each session before deciding what to do.
- Write notes as you go, not at the end — after completing a step, making a decision, discovering how something works, or hitting a blocker. Notes are how the next session (or a compacted you) recovers context.
- Single-quote note and task text. In double quotes the shell command-substitutes backticks and `$()`, so prose mentioning a command in backticks gets that command *executed* and its text silently stripped from the saved note. Use single quotes (write `'\''` for a literal apostrophe), or pipe longer text via stdin: `echo '...' | ondeck add`.
- Keep task content short and actionable; put details and evolving context in notes.
- List order is the priority. If priorities shift, reorder with `move` rather than adding priority markers to task text.
- Mark a task `wip` when you start it and `done` immediately when it's finished. Use `blocked` with a note explaining the blocker.
- Use topics for multi-task efforts so they can be scoped with `next -t` and cleaned up with `rm -t`; leave one-off tasks topicless.
- Before adding a task, check `ondeck ls` to avoid duplicates.
- Use `--json` when you need to process output programmatically.
