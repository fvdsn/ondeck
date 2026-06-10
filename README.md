# ondeck

Per-project task management for AI agents. A persistent, concurrent-safe task backlog backed by SQLite.

Session task lists die with the session, and `tasks.md` breaks under parallel agents and long autonomous runs. ondeck gives agents a backlog that survives context compaction, supports atomic task claiming across parallel workers, and keeps progress notes attached to the work.

## Install

```bash
npm install -g ondeck
```

## Setup

Each project gets its own store — a `.ondeck` SQLite file at the project root, discovered git-style by walking up from the current directory.

```bash
cd my-project
ondeck init   # creates .ondeck and adds it to .gitignore
```

## Usage

### Tasks

```bash
# Add tasks (they go to the end of the list)
ondeck add "migrate database to v3"
ondeck add -t backend "add retry logic to the API client"
echo "longer task description" | ondeck add

# Insert at a specific spot
ondeck add "urgent fix" --top
ondeck add "follow-up" --after 3

# List open tasks (todo, wip, blocked) in order
ondeck ls
ondeck ls done
ondeck ls -t backend
ondeck ls --all

# Full task with notes
ondeck get 3
```

### The work loop

```bash
# What's the suggested next task? (first todo in list order — advisory only)
ondeck next

# Claim it atomically (sets wip; safe with parallel agents)
ondeck next --claim

# Record progress, findings, blockers as you work
ondeck note 3 "the v2 schema has a circular FK, migrating users table first"

# Update status
ondeck mark 3 done
ondeck mark 4 blocked

# Overview: counts, open tasks, recent notes
ondeck status
```

### Ordering

Task order is the priority — like the implicit ordering of a `tasks.md`, but explicit and reorderable. There is no separate priority field to go stale.

```bash
ondeck move 5 --top
ondeck move 5 --before 2
ondeck move 5 --after 2
ondeck move 5 --bottom
```

### Everything else

```bash
ondeck edit 3 "rewritten task description"
ondeck rm 3                  # soft-delete (status: dropped)
ondeck restore 3             # back to todo
ondeck tag 3 backend
ondeck untag 3 backend
ondeck find "migration"      # FTS5 search over tasks and notes
```

All listing commands support `--json` for structured output.

## Commands

| Command | Description |
|---|---|
| `init` | Create a `.ondeck` store in the current directory |
| `add [text...]` | Add a task (args or stdin); `--top`, `--after <id>` |
| `ls [status]` | List tasks in order (default: open). Status: todo, wip, blocked, done, dropped |
| `get <id>` | Show a task with full content and notes |
| `next` | First todo in list order; `--claim` atomically sets it wip |
| `mark <id> <status>` | Set status: todo, wip, blocked, done |
| `note <id> [text...]` | Attach a note to a task |
| `move <id>` | Reorder: `--top`, `--bottom`, `--before <id>`, `--after <id>` |
| `edit <id> [text...]` | Replace task content |
| `rm <id>` / `restore <id>` | Soft-delete / restore |
| `tag <id> <tag>` / `untag <id> <tag>` | Tag management |
| `find <text>` | Keyword search (FTS5) over tasks and notes |
| `status` | Overview: counts, open tasks, recent notes |

## Claude Code skill

A `SKILL.md` is included so Claude Code can use ondeck automatically. Copy it to your skills directory:

```bash
mkdir -p ~/.claude/skills/ondeck
cp $(npm root -g)/ondeck/SKILL.md ~/.claude/skills/ondeck/SKILL.md
```

## Design

- **Per-project store.** One `.ondeck` SQLite file at the project root, found by walking up from cwd. No global state; tasks from different projects never mix.
- **Position is priority.** Tasks are ordered by a fractional position; reordering never renumbers other tasks. `next` suggests the first open todo, but agents are free to scan `ls` and pick.
- **Concurrent-safe claiming.** `next --claim` is a single atomic `UPDATE ... RETURNING`, so parallel agents (e.g. multiple worktrees) never grab the same task.
- **Notes are the history.** Progress, findings, and blockers attach to tasks and survive context compaction. `edit` replaces content in place.
- **Soft-delete.** `rm` sets status to `dropped`; `restore` brings it back. Nothing is lost.
- **SQLite + FTS5.** Local-first, no services, no model downloads. Easy to back up or inspect.

## License

ISC
