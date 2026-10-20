// Unit tests for the ledger checker's pure parts. No installed file or repository is
// modified; temp files live under os.tmpdir() and are removed by the test.
//
//   node --test custom-layer/test/check-patches.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  aggregate,
  checkInstalled,
  classifyState,
  formatRow,
  makeRows,
  parseRevCount,
  sha256File,
} from "../check-patches.mjs";

test("parseRevCount reads behind/ahead from rev-list --left-right --count", () => {
  assert.deepEqual(parseRevCount("0\t3"), { behind: 0, ahead: 3 });
  assert.deepEqual(parseRevCount(" 2   0 \n"), { behind: 2, ahead: 0 });
  assert.equal(parseRevCount(""), null);
  assert.equal(parseRevCount("not a count"), null);
});

test("classifyState never returns untracked", () => {
  assert.equal(classifyState({ hint: "local-commit", upstream: "origin/main", ahead: 0 }), "local-commit");
  assert.equal(classifyState({ hint: "tracked", upstream: null, ahead: null }), "local-commit");
  assert.equal(classifyState({ hint: "tracked", upstream: "origin/main", ahead: 2 }), "local-commit");
  assert.equal(classifyState({ hint: "tracked", upstream: "origin/main", ahead: 0 }), "tracked");
  // A dirty worktree is reported separately and does not change the source state.
  assert.equal(classifyState({ hint: "tracked", upstream: "origin/main", ahead: 0, dirty: true }), "tracked");
});

test("aggregate reports missing before drift", () => {
  assert.equal(aggregate([]), "ok");
  assert.equal(aggregate(["ok", "ok"]), "ok");
  assert.equal(aggregate(["ok", "drift"]), "drift");
  assert.equal(aggregate(["drift", "missing"]), "missing");
  assert.equal(aggregate(["ok", null]), "ok");
});

test("sha256File hashes bytes and checkInstalled classifies ok/drift/missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-patches-test-"));
  try {
    const file = path.join(dir, "a.js");
    fs.writeFileSync(file, "export default 1;\n");
    const good = sha256File(file);

    assert.equal(good, "96909e1dce85ca534fd8881f6c8369a8a87e06df5a4bf81ef44a72db195b0704");
    assert.equal(checkInstalled(file, good).status, "ok");
    assert.equal(checkInstalled(file, ["0".repeat(64), good]).status, "ok");
    assert.equal(checkInstalled(file, "0".repeat(64)).status, "drift");
    assert.equal(checkInstalled(path.join(dir, "missing.js"), good).status, "missing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every ledger row has a source location and a valid state hint", () => {
  const rows = makeRows();
  assert.equal(rows.length, 9);
  assert.equal(new Set(rows.map((r) => r.name)).size, 9);
  for (const row of rows) {
    assert.ok(row.location && row.location.length > 0, `${row.name} lacks a location`);
    assert.ok(["tracked", "local-commit"].includes(row.hint), `${row.name} has an invalid hint`);
    assert.ok(Array.isArray(row.installed), `${row.name} lacks an installed list`);
  }
});

test("formatRow prints one line with state, source, repo and installed counts", () => {
  const line = formatRow({
    name: "demo",
    state: "tracked",
    location: "custom-layer/demo",
    sourceCheck: "ok",
    repo: {
      name: "demo-repo",
      remote: "https://example.invalid/demo.git",
      upstream: "origin/main",
      head: "0123456789abcdef",
      ahead: 0,
      behind: 0,
      dirty: false,
    },
    installed: [
      { status: "ok", label: "a" },
      { status: "ok", label: "b" },
    ],
    extras: ["patch-check=patched"],
  });

  assert.match(line, /^PATCH demo state=tracked source=custom-layer\/demo sourceCheck=ok /);
  assert.match(line, /repo=demo-repo /);
  assert.match(line, /head=0123456 upstream=origin\/main ahead=0 behind=0 dirty=no /);
  assert.match(line, /installed=ok\(2\/2\)/);
  assert.match(line, /patch-check=patched$/);
  assert.doesNotMatch(line, /untracked/);
});
