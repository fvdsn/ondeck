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
ondeck init   # creates .ondeck (and adds it to .gitignore if in a git repo)
```

## Usage

### Tasks

```bash
# Add tasks (they go to the end of the list)
ondeck add "migrate database to v3"
ondeck add -t auth-refactor "add retry logic to the token client"
echo "longer task description" | ondeck add

# Insert at a specific spot
ondeck add "urgent fix" --top
ondeck add "follow-up" --after 3

# List open tasks (todo, wip, blocked) in order
ondeck ls
ondeck ls done
ondeck ls -t auth-refactor
ondeck ls --all

# Full task with notes
ondeck get 3
```

### The work loop

```bash
# What's the suggested next task? (first todo in list order — advisory only)
ondeck next
ondeck next -t auth-refactor

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

### Topics

Tasks can belong to a topic — a stream of work like a feature or refactor. Each task has at most one topic, so a topic is a clean partition of the backlog: easy to switch between, easy to clean up wholesale.

```bash
ondeck add -t auth-refactor "rotate signing keys"   # add into a topic
ondeck topic 7 auth-refactor                        # assign later
ondeck topic 7 --clear                              # remove from its topic

ondeck topics            # all topics with counts per status
ondeck ls -t auth-refactor
ondeck next -t auth-refactor --claim

ondeck rm -t auth-refactor   # abandon a topic: drop all its open tasks at once
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
ondeck find "migration"      # FTS5 search over tasks and notes
```

All listing commands support `--json` for structured output.

## Commands

| Command | Description |
|---|---|
| `init` | Create a `.ondeck` store in the current directory |
| `add [text...]` | Add a task (args or stdin); `-t <topic>`, `--top`, `--after <id>` |
| `ls [status]` | List tasks in order (default: open). Status: todo, wip, blocked, done, dropped; `-t <topic>` |
| `get <id>` | Show a task with full content and notes |
| `next` | First todo in list order; `-t <topic>` to scope, `--claim` atomically sets it wip |
| `mark <id> <status>` | Set status: todo, wip, blocked, done |
| `note <id> [text...]` | Attach a note to a task |
| `move <id>` | Reorder: `--top`, `--bottom`, `--before <id>`, `--after <id>` |
| `edit <id> [text...]` | Replace task content |
| `rm [id]` / `restore <id>` | Soft-delete / restore; `rm -t <topic>` drops all open tasks in a topic |
| `topic <id> [name]` | Set a task's topic (`--clear` to remove) |
| `topics` | List topics with task counts per status |
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
- **Topics, not tags.** A task belongs to at most one topic. Topics partition the backlog into streams of work that can be switched between, scoped with `next -t`, and abandoned in one command — no generic label mechanism.
- **Concurrent-safe claiming.** `next --claim` is a single atomic `UPDATE ... RETURNING`, so parallel agents (e.g. multiple worktrees) never grab the same task.
- **Notes are the history.** Progress, findings, and blockers attach to tasks and survive context compaction. `edit` replaces content in place.
- **Soft-delete.** `rm` sets status to `dropped`; `restore` brings it back. Nothing is lost.
- **SQLite + FTS5.** Local-first, no services, no model downloads. Easy to back up or inspect.

## License

ISC
