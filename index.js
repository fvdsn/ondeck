#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { program } = require("commander");
const Database = require("better-sqlite3");

const STORE_NAME = ".ondeck";
const OPEN_STATUSES = ["todo", "wip", "blocked"];
const MARK_STATUSES = ["todo", "wip", "blocked", "done"];
const ALL_STATUSES = ["todo", "wip", "blocked", "done", "dropped"];
const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
const TASK_COLS = "id, created, updated, position, status, content";

function findUp(startDir, name) {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findStore(startDir) {
  return findUp(startDir, STORE_NAME);
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created TEXT NOT NULL DEFAULT (${NOW}),
      updated TEXT,
      position REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL DEFAULT (${NOW}),
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_tags (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (task_id, tag)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(content, content=tasks, content_rowid=id);
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content, content=notes, content_rowid=id);

    CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE OF content ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO tasks_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, content) VALUES (new.id, new.content);
    END;
  `);
  return db;
}

function getDb() {
  const storePath = findStore(process.cwd());
  if (!storePath) {
    console.error("No .ondeck store found. Run 'ondeck init' at your project root.");
    process.exit(1);
  }
  return openDb(storePath);
}

function getTask(db, id) {
  return db.prepare(`SELECT ${TASK_COLS} FROM tasks WHERE id = ?`).get(Number(id));
}

function withTask(id, fn) {
  const db = getDb();
  const task = getTask(db, id);
  if (!task) {
    db.close();
    console.log(`No task found with id ${id}.`);
    return;
  }
  fn(db, task);
}

function getTags(db, taskId) {
  return db
    .prepare("SELECT tag FROM task_tags WHERE task_id = ? ORDER BY tag")
    .all(taskId)
    .map((r) => r.tag);
}

function getNotes(db, taskId) {
  return db
    .prepare("SELECT id, timestamp, content FROM notes WHERE task_id = ? ORDER BY timestamp, id")
    .all(taskId);
}

function formatTagSuffix(tags) {
  return tags && tags.length > 0 ? ` [${tags.join(", ")}]` : "";
}

function jsonTask(db, task, { notes = false } = {}) {
  const out = { ...task, tags: getTags(db, task.id) };
  if (notes) out.notes = getNotes(db, task.id);
  return out;
}

function printTaskLine(db, task) {
  const lines = task.content.split("\n");
  const more = lines.length > 1 ? " [...]" : "";
  console.log(`[${task.id}] [${task.status}]${formatTagSuffix(getTags(db, task.id))} ${lines[0]}${more}`);
}

function printTaskFull(db, task, { notes = true } = {}) {
  const dates = task.updated ? `created ${task.created}, updated ${task.updated}` : `created ${task.created}`;
  console.log(`[${task.id}] [${task.status}]${formatTagSuffix(getTags(db, task.id))} (${dates})`);
  console.log(task.content);
  if (notes) {
    for (const note of getNotes(db, task.id)) {
      console.log(`  note [${note.timestamp}] ${note.content}`);
    }
  }
  console.log();
}

// Position helpers: tasks are ordered by `position` (then id). New positions
// are midpoints so reordering never renumbers other tasks.
function positionEdge(db, top) {
  const fn = top ? "MIN" : "MAX";
  const edge = db.prepare(`SELECT ${fn}(position) AS p FROM tasks`).get().p;
  return edge == null ? 1 : top ? edge - 1 : edge + 1;
}

function positionNextTo(db, refId, before) {
  const ref = db.prepare("SELECT position FROM tasks WHERE id = ?").get(Number(refId));
  if (!ref) {
    console.error(`No task found with id ${refId}.`);
    process.exit(1);
  }
  const cmp = before ? "<" : ">";
  const fn = before ? "MAX" : "MIN";
  const neighbor = db
    .prepare(`SELECT ${fn}(position) AS p FROM tasks WHERE position ${cmp} ?`)
    .get(ref.position).p;
  if (neighbor == null) return before ? ref.position - 1 : ref.position + 1;
  return (ref.position + neighbor) / 2;
}

function resolvePosition(db, { top, bottom, before, after }) {
  if (top) return positionEdge(db, true);
  if (bottom) return positionEdge(db, false);
  if (before != null) return positionNextTo(db, before, true);
  if (after != null) return positionNextTo(db, after, false);
  return positionEdge(db, false);
}

function readInput(textParts, callback) {
  if (textParts.length > 0) {
    return callback(textParts.join(" "));
  }
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => {
    const text = data.trim();
    if (!text) {
      console.error("No input provided.");
      process.exit(1);
    }
    callback(text);
  });
}

function collectTag(val, acc) {
  acc.push(val);
  return acc;
}

function ftsQuery(text) {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}

program.name("ondeck").description("Per-project task management for AI agents");

program
  .command("init")
  .description("Create a .ondeck store in the current directory")
  .action(() => {
    const cwd = process.cwd();
    const target = path.join(cwd, STORE_NAME);
    if (fs.existsSync(target)) {
      console.error(`A ${STORE_NAME} store already exists in this directory.`);
      process.exit(1);
    }
    const ancestor = findStore(path.dirname(cwd));
    if (ancestor) {
      console.error(`Note: a store already exists at ${ancestor}; commands in this directory will now use the new one.`);
    }
    openDb(target).close();
    if (findUp(cwd, ".git")) {
      const gitignore = path.join(cwd, ".gitignore");
      const line = `${STORE_NAME}*`;
      const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
      if (!existing.split("\n").includes(line)) {
        const sep = existing && !existing.endsWith("\n") ? "\n" : "";
        fs.writeFileSync(gitignore, existing + sep + line + "\n");
      }
    }
    console.log(`Initialized empty ondeck store at ${target}`);
  });

program
  .command("add [text...]")
  .description("Add a task at the end of the list (pass text as args or pipe via stdin)")
  .option("-t, --tag <tag>", "Tag(s) to attach (repeatable)", collectTag, [])
  .option("--top", "Insert at the top of the list")
  .option("--after <id>", "Insert after the given task")
  .option("--json", "Output as JSON")
  .action((textParts, options) => {
    readInput(textParts, (text) => {
      const db = getDb();
      const position = resolvePosition(db, options);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO tasks (content, position) VALUES (?, ?)")
        .run(text, position);
      const insertTag = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
      for (const tag of options.tag) {
        insertTag.run(lastInsertRowid, tag);
      }
      const task = getTask(db, lastInsertRowid);
      if (options.json) {
        console.log(JSON.stringify(jsonTask(db, task)));
      } else {
        printTaskLine(db, task);
      }
      db.close();
    });
  });

program
  .command("ls [status]")
  .description(`List tasks in order (default: open tasks). Status: ${ALL_STATUSES.join(", ")}`)
  .option("-t, --tag <tag>", "Filter by tag(s) (repeatable)", collectTag, [])
  .option("-a, --all", "Include done and dropped tasks")
  .option("--limit <n>", "Show first N results", Number)
  .option("--tail <n>", "Show last N results", Number)
  .option("--offset <n>", "Skip first N results", Number)
  .option("--json", "Output as JSON")
  .action((status, options) => {
    if (status && !ALL_STATUSES.includes(status)) {
      console.error(`Invalid status "${status}". Use: ${ALL_STATUSES.join(", ")}`);
      process.exit(1);
    }
    if (options.limit && options.tail) {
      console.error("Error: --limit and --tail are mutually exclusive.");
      process.exit(1);
    }
    const statuses = status ? [status] : options.all ? ALL_STATUSES : OPEN_STATUSES;
    const db = getDb();
    const wheres = [`t.status IN (${statuses.map(() => "?").join(", ")})`];
    const params = [...statuses];
    let join = "";
    if (options.tag.length > 0) {
      join = "JOIN task_tags tt ON t.id = tt.task_id";
      wheres.push(`tt.tag IN (${options.tag.map(() => "?").join(", ")})`);
      params.push(...options.tag);
    }
    const rows = db
      .prepare(`SELECT DISTINCT ${TASK_COLS.replace(/(\w+)/g, "t.$1")} FROM tasks t ${join}
        WHERE ${wheres.join(" AND ")} ORDER BY t.position, t.id`)
      .all(...params);

    const total = rows.length;
    const offset = options.offset || 0;
    let sliced;
    if (options.tail) {
      const end = total - offset;
      sliced = rows.slice(Math.max(0, end - options.tail), Math.max(0, end));
    } else if (options.limit) {
      sliced = rows.slice(offset, offset + options.limit);
    } else {
      sliced = rows.slice(offset);
    }

    if (options.json) {
      console.log(JSON.stringify(sliced.map((task) => jsonTask(db, task))));
    } else {
      for (const task of sliced) {
        printTaskLine(db, task);
      }
      const remaining = total - offset - sliced.length;
      if (remaining > 0) {
        console.log(`(${remaining} more result${remaining === 1 ? "" : "s"} available)`);
      }
    }
    db.close();
  });

program
  .command("get <id>")
  .description("Show a task with its full content and notes")
  .option("--json", "Output as JSON")
  .action((id, options) => {
    withTask(id, (db, task) => {
      if (options.json) {
        console.log(JSON.stringify(jsonTask(db, task, { notes: true })));
      } else {
        printTaskFull(db, task);
      }
      db.close();
    });
  });

program
  .command("next")
  .description("Show the first todo task in list order (advisory; use --claim to take it)")
  .option("--claim", "Atomically set the task to wip (safe with parallel agents)")
  .option("--json", "Output as JSON")
  .action((options) => {
    const db = getDb();
    let task;
    if (options.claim) {
      task = db
        .prepare(`UPDATE tasks SET status = 'wip', updated = ${NOW}
          WHERE id = (SELECT id FROM tasks WHERE status = 'todo' ORDER BY position, id LIMIT 1)
          RETURNING ${TASK_COLS}`)
        .get();
    } else {
      task = db
        .prepare(`SELECT ${TASK_COLS} FROM tasks WHERE status = 'todo' ORDER BY position, id LIMIT 1`)
        .get();
    }
    if (!task) {
      console.log(options.json ? "null" : "No todo tasks.");
      db.close();
      return;
    }
    if (options.json) {
      console.log(JSON.stringify(jsonTask(db, task, { notes: true })));
    } else {
      printTaskFull(db, task);
    }
    db.close();
  });

program
  .command("mark <id> <status>")
  .description(`Set task status: ${MARK_STATUSES.join(", ")}`)
  .action((id, status) => {
    if (!MARK_STATUSES.includes(status)) {
      const hint = status === "dropped" ? " (use 'ondeck rm' to drop a task)" : "";
      console.error(`Invalid status "${status}". Use: ${MARK_STATUSES.join(", ")}${hint}`);
      process.exit(1);
    }
    withTask(id, (db, task) => {
      db.prepare(`UPDATE tasks SET status = ?, updated = ${NOW} WHERE id = ?`).run(status, task.id);
      db.close();
      console.log(`Task ${task.id} is now [${status}]`);
    });
  });

program
  .command("note <id> [text...]")
  .description("Attach a note to a task (progress, findings, blockers)")
  .option("--json", "Output as JSON")
  .action((id, textParts, options) => {
    readInput(textParts, (text) => {
      withTask(id, (db, task) => {
        const { lastInsertRowid } = db
          .prepare("INSERT INTO notes (task_id, content) VALUES (?, ?)")
          .run(task.id, text);
        const note = db.prepare("SELECT id, timestamp, content FROM notes WHERE id = ?").get(lastInsertRowid);
        db.close();
        if (options.json) {
          console.log(JSON.stringify({ ...note, task_id: task.id }));
        } else {
          console.log(`Note added to task ${task.id}.`);
        }
      });
    });
  });

program
  .command("move <id>")
  .description("Reorder a task in the list")
  .option("--top", "Move to the top")
  .option("--bottom", "Move to the bottom")
  .option("--before <id>", "Move before the given task")
  .option("--after <id>", "Move after the given task")
  .action((id, options) => {
    const chosen = ["top", "bottom", "before", "after"].filter((k) => options[k] !== undefined);
    if (chosen.length !== 1) {
      console.error("Specify exactly one of --top, --bottom, --before <id>, --after <id>.");
      process.exit(1);
    }
    withTask(id, (db, task) => {
      const position = resolvePosition(db, options);
      db.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(position, task.id);
      db.close();
      console.log(`Task ${task.id} moved.`);
    });
  });

program
  .command("edit <id> [text...]")
  .description("Replace a task's content")
  .option("--json", "Output as JSON")
  .action((id, textParts, options) => {
    readInput(textParts, (text) => {
      withTask(id, (db, task) => {
        db.prepare(`UPDATE tasks SET content = ?, updated = ${NOW} WHERE id = ?`).run(text, task.id);
        const updated = getTask(db, task.id);
        if (options.json) {
          console.log(JSON.stringify(jsonTask(db, updated)));
        } else {
          printTaskLine(db, updated);
        }
        db.close();
      });
    });
  });

program
  .command("rm <id>")
  .description("Drop a task (soft-delete; restore with 'restore')")
  .action((id) => {
    withTask(id, (db, task) => {
      if (task.status === "dropped") {
        db.close();
        console.log(`Task ${id} is already dropped.`);
        return;
      }
      db.prepare(`UPDATE tasks SET status = 'dropped', updated = ${NOW} WHERE id = ?`).run(task.id);
      db.close();
      console.log(`Task ${id} dropped.`);
    });
  });

program
  .command("restore <id>")
  .description("Restore a dropped task (back to todo)")
  .action((id) => {
    withTask(id, (db, task) => {
      if (task.status !== "dropped") {
        db.close();
        console.log(`Task ${id} is not dropped.`);
        return;
      }
      db.prepare(`UPDATE tasks SET status = 'todo', updated = ${NOW} WHERE id = ?`).run(task.id);
      db.close();
      console.log(`Task ${id} restored.`);
    });
  });

program
  .command("tag <id> <tag>")
  .description("Add a tag to a task")
  .action((id, tag) => {
    withTask(id, (db, task) => {
      db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)").run(task.id, tag);
      const tags = getTags(db, task.id);
      db.close();
      console.log(`Task ${id} [${tags.join(", ")}]`);
    });
  });

program
  .command("untag <id> <tag>")
  .description("Remove a tag from a task")
  .action((id, tag) => {
    withTask(id, (db, task) => {
      const changes = db.prepare("DELETE FROM task_tags WHERE task_id = ? AND tag = ?").run(task.id, tag).changes;
      if (changes === 0) {
        db.close();
        console.log(`Task ${id} does not have tag "${tag}".`);
        return;
      }
      const tags = getTags(db, task.id);
      db.close();
      console.log(`Task ${id}${formatTagSuffix(tags)}`);
    });
  });

program
  .command("find <text>")
  .description("Search tasks and notes by keyword")
  .option("--json", "Output as JSON")
  .action((text, options) => {
    const db = getDb();
    const query = ftsQuery(text);
    const taskHits = db
      .prepare(`SELECT ${TASK_COLS.replace(/(\w+)/g, "t.$1")} FROM tasks t
        JOIN tasks_fts f ON t.id = f.rowid WHERE tasks_fts MATCH ?`)
      .all(query);
    const noteHits = db
      .prepare(`SELECT n.id, n.task_id, n.timestamp, n.content FROM notes n
        JOIN notes_fts f ON n.id = f.rowid WHERE notes_fts MATCH ?`)
      .all(query);

    const byTask = new Map();
    for (const task of taskHits) {
      byTask.set(task.id, { task, notes: [] });
    }
    for (const note of noteHits) {
      if (!byTask.has(note.task_id)) {
        byTask.set(note.task_id, { task: getTask(db, note.task_id), notes: [] });
      }
      byTask.get(note.task_id).notes.push(note);
    }
    const results = [...byTask.values()].sort(
      (a, b) => a.task.position - b.task.position || a.task.id - b.task.id
    );

    if (options.json) {
      console.log(JSON.stringify(results.map(({ task, notes }) => ({
        ...jsonTask(db, task),
        notes: notes.map(({ id, timestamp, content }) => ({ id, timestamp, content })),
      }))));
    } else {
      for (const { task, notes } of results) {
        printTaskLine(db, task);
        for (const note of notes) {
          console.log(`  note [${note.timestamp}] ${note.content}`);
        }
      }
      if (results.length === 0) {
        console.log("No matches.");
      }
    }
    db.close();
  });

program
  .command("status")
  .description("Overview: counts, open tasks in order, recent notes")
  .option("--json", "Output as JSON")
  .action((options) => {
    const db = getDb();
    const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    for (const row of db.prepare("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").all()) {
      counts[row.status] = row.n;
    }
    const open = db
      .prepare(`SELECT ${TASK_COLS} FROM tasks WHERE status IN ('todo', 'wip', 'blocked') ORDER BY position, id`)
      .all();
    const recentNotes = db
      .prepare(`SELECT n.id, n.task_id, n.timestamp, n.content FROM notes n
        ORDER BY n.timestamp DESC, n.id DESC LIMIT 5`)
      .all();

    if (options.json) {
      console.log(JSON.stringify({
        counts,
        open: open.map((task) => jsonTask(db, task)),
        recentNotes,
      }));
      db.close();
      return;
    }

    const openCount = OPEN_STATUSES.reduce((sum, s) => sum + counts[s], 0);
    console.log(`Tasks: ${counts.todo} todo, ${counts.wip} wip, ${counts.blocked} blocked (${openCount} open), ${counts.done} done`);
    for (const task of open) {
      printTaskLine(db, task);
    }
    if (recentNotes.length > 0) {
      console.log("\nRecent notes:");
      for (const note of recentNotes) {
        const firstLine = note.content.split("\n")[0];
        console.log(`  [task ${note.task_id}] [${note.timestamp}] ${firstLine}`);
      }
    }
    db.close();
  });

program.parse();
