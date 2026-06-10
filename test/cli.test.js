const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "..", "index.js");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ondeck-"));
}

function run(cwd, args) {
  return execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function runJson(cwd, args) {
  return JSON.parse(run(cwd, [...args, "--json"]));
}

function initDir() {
  const dir = makeTmp();
  run(dir, ["init"]);
  return dir;
}

test("commands fail with a hint before init", () => {
  const dir = makeTmp();
  assert.throws(
    () => run(dir, ["ls"]),
    (err) => err.status === 1 && err.stderr.includes("ondeck init")
  );
});

test("init creates the store and gitignores it in a git repo", () => {
  const dir = makeTmp();
  fs.mkdirSync(path.join(dir, ".git"));
  run(dir, ["init"]);
  assert.ok(fs.existsSync(path.join(dir, ".ondeck")));
  assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /^\.ondeck\*$/m);
  assert.throws(() => run(dir, ["init"]), (err) => err.stderr.includes("already exists"));
});

test("init does not touch gitignore outside a git repository", () => {
  const dir = makeTmp();
  run(dir, ["init"]);
  assert.ok(fs.existsSync(path.join(dir, ".ondeck")));
  assert.ok(!fs.existsSync(path.join(dir, ".gitignore")));
});

test("init gitignores the store when .git is in a parent directory", () => {
  const dir = makeTmp();
  fs.mkdirSync(path.join(dir, ".git"));
  const sub = path.join(dir, "packages", "app");
  fs.mkdirSync(sub, { recursive: true });
  run(sub, ["init"]);
  assert.match(fs.readFileSync(path.join(sub, ".gitignore"), "utf8"), /^\.ondeck\*$/m);
});

test("init appends to an existing gitignore without duplicating", () => {
  const dir = makeTmp();
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  run(dir, ["init"]);
  const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
  assert.strictEqual(content, "node_modules\n.ondeck*\n");
});

test("store is discovered from a nested subdirectory", () => {
  const dir = initDir();
  const sub = path.join(dir, "src", "deep");
  fs.mkdirSync(sub, { recursive: true });
  run(sub, ["add", "from below"]);
  const tasks = runJson(dir, ["ls"]);
  assert.strictEqual(tasks.length, 1);
  assert.strictEqual(tasks[0].content, "from below");
});

test("ls shows tasks in list order; move and add --top/--after reorder", () => {
  const dir = initDir();
  run(dir, ["add", "a"]);
  run(dir, ["add", "b"]);
  run(dir, ["add", "c"]);
  const order = () => runJson(dir, ["ls"]).map((t) => t.content);
  assert.deepStrictEqual(order(), ["a", "b", "c"]);

  const c = runJson(dir, ["ls"]).find((t) => t.content === "c");
  run(dir, ["move", String(c.id), "--top"]);
  assert.deepStrictEqual(order(), ["c", "a", "b"]);

  run(dir, ["add", "d", "--after", String(c.id)]);
  assert.deepStrictEqual(order(), ["c", "d", "a", "b"]);

  run(dir, ["add", "e", "--top"]);
  assert.deepStrictEqual(order(), ["e", "c", "d", "a", "b"]);
});

test("move requires exactly one placement option", () => {
  const dir = initDir();
  run(dir, ["add", "a"]);
  assert.throws(() => run(dir, ["move", "1"]), (err) => err.stderr.includes("exactly one"));
  assert.throws(
    () => run(dir, ["move", "1", "--top", "--bottom"]),
    (err) => err.stderr.includes("exactly one")
  );
});

test("mark transitions and ls status filters", () => {
  const dir = initDir();
  run(dir, ["add", "a"]);
  run(dir, ["add", "b"]);
  run(dir, ["mark", "1", "wip"]);
  run(dir, ["mark", "2", "done"]);

  assert.deepStrictEqual(runJson(dir, ["ls"]).map((t) => t.content), ["a"]);
  assert.deepStrictEqual(runJson(dir, ["ls", "done"]).map((t) => t.content), ["b"]);
  assert.strictEqual(runJson(dir, ["ls", "--all"]).length, 2);
  assert.strictEqual(runJson(dir, ["ls"])[0].status, "wip");

  assert.throws(() => run(dir, ["mark", "1", "bogus"]), (err) => err.stderr.includes("Invalid status"));
  assert.throws(() => run(dir, ["mark", "1", "dropped"]), (err) => err.stderr.includes("ondeck rm"));
});

test("rm hides a task and restore brings it back as todo", () => {
  const dir = initDir();
  run(dir, ["add", "a"]);
  run(dir, ["rm", "1"]);
  assert.strictEqual(runJson(dir, ["ls"]).length, 0);
  assert.strictEqual(runJson(dir, ["ls", "dropped"]).length, 1);
  run(dir, ["restore", "1"]);
  assert.strictEqual(runJson(dir, ["ls"])[0].status, "todo");
});

test("next is advisory; --claim sets wip and drains the list", () => {
  const dir = initDir();
  run(dir, ["add", "first"]);
  run(dir, ["add", "second"]);

  const peek = runJson(dir, ["next"]);
  assert.strictEqual(peek.content, "first");
  assert.strictEqual(runJson(dir, ["get", String(peek.id)]).status, "todo");

  const claimed = runJson(dir, ["next", "--claim"]);
  assert.strictEqual(claimed.content, "first");
  assert.strictEqual(runJson(dir, ["get", String(claimed.id)]).status, "wip");

  assert.strictEqual(runJson(dir, ["next", "--claim"]).content, "second");
  assert.strictEqual(runJson(dir, ["next", "--claim"]), null);
});

test("parallel claims grab different tasks", async () => {
  const dir = initDir();
  run(dir, ["add", "one"]);
  run(dir, ["add", "two"]);
  const claim = () =>
    new Promise((resolve, reject) =>
      execFile(
        process.execPath,
        [CLI, "next", "--claim", "--json"],
        { cwd: dir, encoding: "utf8" },
        (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout)))
      )
    );
  const [a, b] = await Promise.all([claim(), claim()]);
  assert.notStrictEqual(a.id, b.id);
});

test("notes attach to tasks and show in get", () => {
  const dir = initDir();
  run(dir, ["add", "a task"]);
  run(dir, ["note", "1", "found a gotcha"]);
  run(dir, ["note", "1", "fixed it"]);
  const task = runJson(dir, ["get", "1"]);
  assert.deepStrictEqual(task.notes.map((n) => n.content), ["found a gotcha", "fixed it"]);
  assert.match(run(dir, ["get", "1"]), /found a gotcha/);
});

test("find matches task content and note content", () => {
  const dir = initDir();
  run(dir, ["add", "implement parser"]);
  run(dir, ["add", "write docs"]);
  run(dir, ["note", "2", "the parser section needs examples"]);

  const byTask = runJson(dir, ["find", "parser"]);
  assert.strictEqual(byTask.length, 2);
  const noteHit = byTask.find((r) => r.content === "write docs");
  assert.strictEqual(noteHit.notes.length, 1);

  assert.strictEqual(runJson(dir, ["find", "nonexistent"]).length, 0);
});

test("edit replaces content and stays findable", () => {
  const dir = initDir();
  run(dir, ["add", "old wording"]);
  run(dir, ["edit", "1", "new wording"]);
  assert.strictEqual(runJson(dir, ["get", "1"]).content, "new wording");
  assert.strictEqual(runJson(dir, ["find", "wording"]).length, 1);
  assert.strictEqual(runJson(dir, ["find", "old"]).length, 0);
});

test("tags can be added, filtered on, and removed", () => {
  const dir = initDir();
  run(dir, ["add", "a", "-t", "frontend"]);
  run(dir, ["add", "b"]);
  run(dir, ["tag", "2", "frontend"]);
  assert.strictEqual(runJson(dir, ["ls", "-t", "frontend"]).length, 2);
  run(dir, ["untag", "2", "frontend"]);
  assert.strictEqual(runJson(dir, ["ls", "-t", "frontend"]).length, 1);
});

test("status reports counts, open tasks, and recent notes", () => {
  const dir = initDir();
  run(dir, ["add", "a"]);
  run(dir, ["add", "b"]);
  run(dir, ["mark", "1", "done"]);
  run(dir, ["note", "2", "in progress note"]);
  const status = runJson(dir, ["status"]);
  assert.strictEqual(status.counts.done, 1);
  assert.strictEqual(status.counts.todo, 1);
  assert.strictEqual(status.open.length, 1);
  assert.strictEqual(status.recentNotes[0].content, "in progress note");
});

test("ls pagination with --limit, --offset, --tail", () => {
  const dir = initDir();
  for (const name of ["a", "b", "c", "d"]) run(dir, ["add", name]);
  assert.deepStrictEqual(runJson(dir, ["ls", "--limit", "2"]).map((t) => t.content), ["a", "b"]);
  assert.deepStrictEqual(runJson(dir, ["ls", "--limit", "2", "--offset", "1"]).map((t) => t.content), ["b", "c"]);
  assert.deepStrictEqual(runJson(dir, ["ls", "--tail", "2"]).map((t) => t.content), ["c", "d"]);
  assert.match(run(dir, ["ls", "--limit", "2"]), /2 more results available/);
});

test("add accepts stdin input", () => {
  const dir = initDir();
  execFileSync(process.execPath, [CLI, "add"], { cwd: dir, encoding: "utf8", input: "piped task\nwith detail" });
  const task = runJson(dir, ["get", "1"]);
  assert.strictEqual(task.content, "piped task\nwith detail");
});
