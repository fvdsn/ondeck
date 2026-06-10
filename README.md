# smolbrain

Per-project task management for AI agents. A persistent, concurrent-safe task backlog backed by SQLite.

Session task lists die with the session, and `tasks.md` breaks under parallel agents and long autonomous runs. smolbrain gives agents a backlog that survives context compaction, supports atomic task claiming across parallel workers, and keeps progress notes attached to the work.

## Install

```bash
npm install -g smolbrain
```

## Setup

Each project gets its own store — a `.smolbrain` SQLite file at the project root, discovered git-style by walking up from the current directory.

```bash
cd my-project
smolbrain init   # creates .smolbrain and adds it to .gitignore
```

## Usage

### Tasks

```bash
# Add tasks (they go to the end of the list)
smolbrain add "migrate database to v3"
smolbrain add -t backend "add retry logic to the API client"
echo "longer task description" | smolbrain add

# Insert at a specific spot
smolbrain add "urgent fix" --top
smolbrain add "follow-up" --after 3

# List open tasks (todo, wip, blocked) in order
smolbrain ls
smolbrain ls done
smolbrain ls -t backend
smolbrain ls --all

# Full task with notes
smolbrain get 3
```

### The work loop

```bash
# What's the suggested next task? (first todo in list order — advisory only)
smolbrain next

# Claim it atomically (sets wip; safe with parallel agents)
smolbrain next --claim

# Record progress, findings, blockers as you work
smolbrain note 3 "the v2 schema has a circular FK, migrating users table first"

# Update status
smolbrain mark 3 done
smolbrain mark 4 blocked

# Overview: counts, open tasks, recent notes
smolbrain status
```

### Ordering

Task order is the priority — like the implicit ordering of a `tasks.md`, but explicit and reorderable. There is no separate priority field to go stale.

```bash
smolbrain move 5 --top
smolbrain move 5 --before 2
smolbrain move 5 --after 2
smolbrain move 5 --bottom
```

### Everything else

```bash
smolbrain edit 3 "rewritten task description"
smolbrain rm 3                  # soft-delete (status: dropped)
smolbrain restore 3             # back to todo
smolbrain tag 3 backend
smolbrain untag 3 backend
smolbrain find "migration"      # FTS5 search over tasks and notes
```

All listing commands support `--json` for structured output.

## Commands

| Command | Description |
|---|---|
| `init` | Create a `.smolbrain` store in the current directory |
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

A `SKILL.md` is included so Claude Code can use smolbrain automatically. Copy it to your skills directory:

```bash
mkdir -p ~/.claude/skills/smolbrain
cp $(npm root -g)/smolbrain/SKILL.md ~/.claude/skills/smolbrain/SKILL.md
```

## Design

- **Per-project store.** One `.smolbrain` SQLite file at the project root, found by walking up from cwd. No global state; tasks from different projects never mix.
- **Position is priority.** Tasks are ordered by a fractional position; reordering never renumbers other tasks. `next` suggests the first open todo, but agents are free to scan `ls` and pick.
- **Concurrent-safe claiming.** `next --claim` is a single atomic `UPDATE ... RETURNING`, so parallel agents (e.g. multiple worktrees) never grab the same task.
- **Notes are the history.** Progress, findings, and blockers attach to tasks and survive context compaction. `edit` replaces content in place.
- **Soft-delete.** `rm` sets status to `dropped`; `restore` brings it back. Nothing is lost.
- **SQLite + FTS5.** Local-first, no services, no model downloads. Easy to back up or inspect.

## License

ISC
