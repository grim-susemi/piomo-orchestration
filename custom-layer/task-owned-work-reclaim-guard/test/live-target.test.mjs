import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { ROOT, TARGET, BACKUP, STAGED, prepareLive, main } from "../live-target.mjs";
import { BASELINE_SHA256, VERSION, sha256, transformText } from "../patch.mjs";
import { AFTER_SHA256 } from "../installer.mjs";

// The sole real filesystem operation is reading the qualified source input.
// Every execution-option operation below uses only this injected byte map.
const original = await readFile(TARGET);
const patched = Buffer.from(transformText(original.toString("utf8")));
const normalize = (path) => win32.normalize(path).toLowerCase();

function fixture() {
  const files = new Map();
  const writes = [];
  const aliases = new Map();
  const links = new Set();
  const goFile = "fixture-go.json";
  const checkpointFile = "fixture-checkpoints.json";
  const checkpointPath = "fixture-session-checkpoint.md";
  const put = (path, bytes) => files.set(normalize(path), Buffer.from(bytes));
  const get = (path) => files.get(normalize(path));
  const error = (code) => Object.assign(new Error(code), { code });
  put(`${ROOT}/package.json`, JSON.stringify({ version: VERSION }));
  put(TARGET, original);
  put(checkpointPath, "fixture session is checkpointed; this is not a real GO");
  put(goFile, JSON.stringify({
    decision: "GO_APPLY_TASK_OWNED_WORK_PINNED_OVERLAY", target: TARGET,
    beforeSha256: BASELINE_SHA256, afterSha256: AFTER_SHA256, checkpointId: "fixture-only",
  }));
  put(checkpointFile, JSON.stringify({
    schema: "task-owned-work-live-checkpoints-v1", checkpointId: "fixture-only", target: TARGET,
    hostQuiescent: true, allAffectedSessionsCheckpointed: true,
    sessions: [{ sessionId: "fixture-session", checkpointPath, sha256: sha256(get(checkpointPath)) }],
  }));
  const io = {
    onRead: (_path) => {},
    onWrite: (_path) => {},
    onRename: () => {},
    readFile: async (path) => {
      io.onRead?.(path);
      if (!get(path)) throw error("ENOENT");
      return Buffer.from(get(path));
    },
    realpath: async (path) => {
      if (normalize(path) !== normalize(ROOT) && !get(path)) throw error("ENOENT");
      return aliases.get(normalize(path)) ?? path;
    },
    lstat: async (path) => {
      if (!get(path)) throw error("ENOENT");
      return { isFile: () => true, isSymbolicLink: () => links.has(normalize(path)) };
    },
    writeFile: async (path, bytes, options) => {
      assert.ok([BACKUP, STAGED].includes(path), `Unexpected write: ${path}`);
      assert.deepEqual(options, { flag: "wx", flush: true });
      if (get(path)) throw error("EEXIST");
      writes.push(["write", path]);
      put(path, bytes);
      io.onWrite?.(path);
    },
    rename: async (from, to) => {
      assert.equal(from, STAGED);
      assert.equal(to, TARGET);
      assert.ok(get(from));
      writes.push(["rename", from, to]);
      put(to, get(from));
      files.delete(normalize(from));
      io.onRename?.();
    },
    unlink: async (path) => {
      assert.equal(path, STAGED);
      writes.push(["unlink", path]);
      files.delete(normalize(path));
    },
  };
  return { io, files, writes, aliases, links, put, get, goFile, checkpointFile,
    execute: () => prepareLive({ execute: true, commanderGo: goFile, checkpoints: checkpointFile }, io) };
}

test("pinned live check-only and dry-run write nothing and qualify exact output", async () => {
  const f = fixture();
  for (const argv of [[], ["--check-only"], ["--dry-run"]]) {
    const result = await main(argv, f.io);
    assert.equal(result.checkOnly, true);
    assert.equal(result.afterSha256, AFTER_SHA256);
  }
  assert.deepEqual(f.writes, []);
  assert.equal(sha256(f.get(TARGET)), BASELINE_SHA256);
});

test("pinned live execution applies only by same-directory rename with exact backup and is idempotent", async () => {
  const f = fixture();
  const result = await main(["--execute-live", "--commander-go", f.goFile, "--checkpoints", f.checkpointFile], f.io);
  assert.equal(result.changed, true);
  assert.equal(sha256(f.get(TARGET)), AFTER_SHA256);
  assert.equal(f.get(BACKUP).equals(original), true);
  assert.equal(f.get(STAGED), undefined);
  assert.deepEqual(f.writes, [["write", BACKUP], ["write", STAGED], ["rename", STAGED, TARGET]]);
  const writes = f.writes.length;
  assert.equal((await f.execute()).changed, false);
  assert.equal(f.writes.length, writes);
});

test("pinned live refuses arbitrary target/root CLI options and missing commander GO", async () => {
  const f = fixture();
  for (const argv of [["--root", "other"], ["--execute-live"], ["--target", TARGET]]) {
    await assert.rejects(main(argv, f.io), { kind: "argument" });
  }
  await assert.rejects(prepareLive({ execute: true }, f.io), { kind: "authorization" });
  f.put(f.goFile, JSON.stringify({ decision: "PREPARE_EXACT_LIVE_TARGET_INSTALLER_NO_APPLICATION" }));
  await assert.rejects(f.execute(), { kind: "authorization" });
  assert.deepEqual(f.writes, []);
});

test("pinned live requires matching checkpoint identity, quiescence and unchanged evidence bytes", async () => {
  for (const mutate of [
    (d) => { d.checkpointId = "other"; },
    (d) => { d.hostQuiescent = false; },
    (d) => { d.allAffectedSessionsCheckpointed = false; },
    (d) => { d.sessions = []; },
    (d) => { d.sessions.push({ ...d.sessions[0] }); },
  ]) {
    const f = fixture();
    const doc = JSON.parse(f.get(f.checkpointFile));
    mutate(doc);
    f.put(f.checkpointFile, JSON.stringify(doc));
    await assert.rejects(f.execute(), { kind: "authorization" });
    assert.deepEqual(f.writes, []);
  }
  const f = fixture();
  f.put("fixture-session-checkpoint.md", "new checkpoint bytes");
  await assert.rejects(f.execute(), { kind: "checkpoint-drift" });
  assert.deepEqual(f.writes, []);
});

test("pinned live refuses version, realpath, link and whole-file drift without writes", async () => {
  const mutations = [
    [(f) => f.put(`${ROOT}/package.json`, '{"version":"other"}'), "version"],
    [(f) => f.aliases.set(normalize(ROOT), "C:/other"), "realpath"],
    [(f) => f.aliases.set(normalize(TARGET), "C:/other/task.js"), "realpath"],
    [(f) => f.links.add(normalize(TARGET)), "realpath"],
    [(f) => f.put(TARGET, Buffer.concat([original, Buffer.from("// foreign")])), "drift"],
  ];
  for (const [mutate, kind] of mutations) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.execute(), { kind });
    assert.deepEqual(f.writes, []);
  }
});

test("pinned live preserves foreign backups and staging and refuses missing patched backup", async () => {
  for (const [path, kind] of [[BACKUP, "backup-drift"], [STAGED, "staging-exists"]]) {
    const f = fixture();
    f.put(path, "foreign bytes");
    await assert.rejects(f.execute(), { kind });
    assert.equal(f.get(path).toString(), "foreign bytes");
    assert.deepEqual(f.writes, []);
  }
  const f = fixture();
  f.put(TARGET, patched);
  await assert.rejects(f.execute(), { kind: "backup-missing" });
  assert.deepEqual(f.writes, []);
});

test("pinned live rejects staged tampering and pre-replace drift while preserving other writers", async () => {
  const staged = fixture();
  staged.io.onWrite = (path) => { if (path === STAGED) staged.put(path, "tampered staging"); };
  await assert.rejects(staged.execute(), { kind: "staged-drift" });
  assert.equal(staged.get(TARGET).equals(original), true);
  assert.equal(staged.get(BACKUP).equals(original), true);
  assert.equal(staged.get(STAGED), undefined);

  const drift = fixture();
  drift.io.onRead = (path) => {
    if (path === TARGET && drift.get(STAGED)) drift.put(TARGET, "another writer");
  };
  await assert.rejects(drift.execute(), { kind: "drift" });
  assert.equal(drift.get(TARGET).toString(), "another writer");
  assert.equal(drift.writes.some(([op]) => op === "rename"), false);
  assert.equal(drift.get(STAGED), undefined);
});

test("pinned live verifies backup survival and refuses post-write drift without automatic restoration", async () => {
  const missing = fixture();
  missing.io.onWrite = (path) => { if (path === BACKUP) missing.files.delete(normalize(BACKUP)); };
  await assert.rejects(missing.execute(), { kind: "backup-missing" });
  assert.equal(missing.get(TARGET).equals(original), true);
  const after = fixture();
  after.io.onRename = () => after.put(TARGET, "post-rename editor");
  await assert.rejects(after.execute(), { kind: "post-write-drift" });
  assert.equal(after.get(TARGET).toString(), "post-rename editor");
  assert.equal(after.get(BACKUP).equals(original), true);
  assert.equal(after.writes.filter(([op]) => op === "rename").length, 1);
});
