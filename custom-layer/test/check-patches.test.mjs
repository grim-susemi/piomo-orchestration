// Unit tests for the ledger checker's pure parts. No installed file or repository is
// modified; temp files live under os.tmpdir() and are removed by the test.
//
//   node --test custom-layer/test/check-patches.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  STATES,
  aggregate,
  checkInstalled,
  classifyState,
  compareLedger,
  discoverActive,
  formatRow,
  gitBlobId,
  makeRows,
  parseLedger,
  parseRevCount,
  pinConsistency,
  sha256File,
  strictVerdict,
  treeHash,
} from "../check-patches.mjs";

const CHECKER = fileURLToPath(new URL("../check-patches.mjs", import.meta.url));
const LEDGER_FILE = fileURLToPath(new URL("../PATCHES.md", import.meta.url));

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

test("every checker row is a PATCHES.md row and back, with the same state", () => {
  const rows = makeRows();
  assert.equal(new Set(rows.map((r) => r.name)).size, rows.length);
  for (const row of rows) {
    assert.ok(row.location && row.location.length > 0, `${row.name} lacks a location`);
    assert.ok(STATES.includes(row.hint), `${row.name} has an invalid hint`);
    assert.ok(Array.isArray(row.installed), `${row.name} lacks an installed list`);
  }
  const diff = compareLedger(parseLedger(fs.readFileSync(LEDGER_FILE, "utf8")), rows);
  assert.equal(diff.ids.length, rows.length);
  assert.deepEqual(diff.duplicates, []);
  assert.deepEqual(diff.missingFromChecker, []);
  assert.deepEqual(diff.missingFromLedger, []);
  assert.deepEqual(diff.stateMismatch, []);
});

test("parseLedger reads only tables headed by `name` and skips separators", () => {
  const text = [
    "| entry | reason |",
    "| --- | --- |",
    "| not-a-row | other table |",
    "",
    "| name | target | state | check |",
    "| --- | :---: | --- | --- |",
    "| `alpha` | a | tracked | x |",
    "| beta | b<br>c | local-commit | y |",
    "text between tables",
    "| name | state |",
    "|---|---|",
    "| gamma | private |",
  ].join("\r\n");
  assert.deepEqual(parseLedger(text), [
    { id: "alpha", state: "tracked" },
    { id: "beta", state: "local-commit" },
    { id: "gamma", state: "private" },
  ]);
  assert.deepEqual(parseLedger("no table"), []);
});

test("compareLedger reports both directions, duplicates and state disagreements", () => {
  const diff = compareLedger(
    [
      { id: "a", state: "tracked" },
      { id: "b", state: "tracked" },
      { id: "b", state: "tracked" },
      { id: "only-ledger", state: "tracked" },
    ],
    [
      { name: "a", hint: "tracked" },
      { name: "b", hint: "local-commit" },
      { name: "only-checker", hint: "tracked" },
    ],
  );
  assert.deepEqual(diff.duplicates, ["b"]);
  assert.deepEqual(diff.missingFromChecker, ["only-ledger"]);
  assert.deepEqual(diff.missingFromLedger, ["only-checker"]);
  assert.deepEqual(diff.stateMismatch, [{ id: "b", ledger: "tracked", checker: "local-commit" }]);
});

test("classifyState keeps private and external rows out of the repository states", () => {
  assert.equal(classifyState({ hint: "private" }), "private");
  assert.equal(classifyState({ hint: "external", upstream: "origin/main", ahead: 0 }), "external");
});

test("strictVerdict: failures win, anything unverified is incomplete, only a clean full run passes", () => {
  const okRow = { name: "a", state: "tracked", sourceCheck: "ok", installed: [{ status: "ok", label: "f" }] };
  const ledger = { ids: ["a"], duplicates: [], missingFromChecker: [], missingFromLedger: [], stateMismatch: [] };
  const discovery = { entries: [], unledgered: [], missing: [], hostShims: [], inert: [], errors: [] };

  const pass = strictVerdict({ results: [okRow], ledger, discovery });
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.exitCode, 0);

  const dirty = strictVerdict({
    results: [{ ...okRow, repo: { name: "r", path: "/r", dirty: true } }],
    ledger,
    discovery,
  });
  assert.equal(dirty.verdict, "pass");
  assert.equal(dirty.warnings.length, 1);

  for (const results of [
    [{ ...okRow, state: "local-commit" }],
    [{ ...okRow, manual: ["look at the page"] }],
    [{ ...okRow, unverified: ["origin not recorded"] }],
  ]) {
    const verdict = strictVerdict({ results, ledger, discovery });
    assert.equal(verdict.verdict, "incomplete");
    assert.equal(verdict.exitCode, 3);
  }
  assert.equal(strictVerdict({ results: [okRow], partial: true }).exitCode, 3);
  assert.equal(strictVerdict({ results: [okRow], ledger }).verdict, "incomplete");

  const failing = [
    { results: [{ ...okRow, sourceCheck: "drift" }], ledger, discovery },
    { results: [{ ...okRow, installed: [{ status: "missing", label: "f" }] }], ledger, discovery },
    { results: [okRow], ledger: { ...ledger, missingFromChecker: ["x"] }, discovery },
    { results: [okRow], ledger: { ...ledger, missingFromLedger: ["x"] }, discovery },
    { results: [okRow], ledger: { ...ledger, stateMismatch: [{ id: "a", ledger: "tracked", checker: "private" }] }, discovery },
    { results: [okRow], ledger: { error: "no ledger table in PATCHES.md" }, discovery },
    { results: [okRow], ledger, discovery: { ...discovery, unledgered: ["/x.js"] } },
    { results: [okRow], ledger, discovery: { ...discovery, missing: ["/gone"] } },
    { results: [{ ...okRow, state: "local-commit", manual: ["m"] }], ledger, discovery: { ...discovery, errors: ["e"] } },
  ];
  for (const input of failing) {
    const verdict = strictVerdict(input);
    assert.equal(verdict.verdict, "fail", JSON.stringify(input));
    assert.equal(verdict.exitCode, 1);
  }
});

test("discoverActive matches extension files, extension dirs and settings paths to ledger rows", () => {
  const agent = fs.mkdtempSync(path.join(os.tmpdir(), "check-discover-"));
  try {
    const ext = path.join(agent, "extensions");
    fs.mkdirSync(path.join(ext, "goal", "no-session"), { recursive: true });
    fs.mkdirSync(path.join(ext, "pkgdir"), { recursive: true });
    fs.writeFileSync(path.join(ext, "pkgdir", "index.ts"), "export default () => {};\n");
    const shim = (target) =>
      `// Generated by OmO. Delete this file to stop loading the default global extension.\n` +
      `export { default } from "file:///C:/x/node_modules/@code-yeongyu/senpi/dist/core/extensions/builtin/${target}.js";\n`;
    fs.writeFileSync(path.join(ext, "diff.js"), shim("diff"));
    fs.writeFileSync(path.join(ext, "tps.js"), shim("files")); // shim text, wrong builtin
    fs.writeFileSync(path.join(ext, "owned.js"), "export default () => {};\n");
    fs.writeFileSync(path.join(ext, "stray.ts"), "export default () => {};\n");
    fs.writeFileSync(path.join(ext, "notes.md"), "not an extension\n");
    const ownedPkg = path.join(agent, "owned-pkg");
    fs.mkdirSync(ownedPkg);
    fs.writeFileSync(
      path.join(agent, "settings.json"),
      JSON.stringify({ packages: [ownedPkg, path.join(agent, "gone-pkg")], extensions: ["npm:some-extension"] }),
    );
    const rows = [
      { name: "owned", discover: [path.join(ext, "owned.js"), ownedPkg.replace(/\\/g, "/").toUpperCase()] },
    ];
    const found = discoverActive(agent, rows);
    assert.deepEqual(found.hostShims, [path.join(ext, "diff.js")]);
    assert.deepEqual(found.inert, [path.join(ext, "goal")]);
    assert.deepEqual(found.unledgered.sort(), [
      "npm:some-extension",
      path.join(agent, "gone-pkg"),
      path.join(ext, "pkgdir"),
      path.join(ext, "stray.ts"),
      path.join(ext, "tps.js"),
    ].sort());
    assert.deepEqual(found.missing, [path.join(agent, "gone-pkg")]);
    assert.deepEqual(found.errors, []);
    assert.equal(found.entries.filter((e) => e.owner === "owned").length, 2);

    fs.writeFileSync(path.join(agent, "settings.json"), "{ not json");
    assert.equal(discoverActive(agent, rows).errors.length, 1);
  } finally {
    fs.rmSync(agent, { recursive: true, force: true });
  }
});

test("gitBlobId equals git's object id and treeHash changes with any file", () => {
  assert.equal(gitBlobId(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-tree-"));
  try {
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "a.txt"), "a");
    fs.writeFileSync(path.join(dir, "sub", "b.txt"), "b");
    const first = treeHash(dir);
    assert.equal(first.files, 2);
    assert.deepEqual(treeHash(dir), first);
    fs.writeFileSync(path.join(dir, "sub", "b.txt"), "B");
    assert.notEqual(treeHash(dir).hash, first.hash);
    fs.writeFileSync(path.join(dir, "sub", "b.txt"), "b");
    fs.writeFileSync(path.join(dir, "c.txt"), "");
    assert.notEqual(treeHash(dir).hash, first.hash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pinConsistency fails when any launcher pin or the overlay lags the installed versions", () => {
  const pins = [
    { label: "omo.cmd", omo: "5.1.38", senpi: "2026.10.19" },
    { label: "manifest", omo: "5.1.38", senpi: "2026.10.19" },
  ];
  const installed = { omo: "5.1.38", senpi: "2026.10.19", overlay: "5.1.38" };
  assert.equal(pinConsistency(pins, installed).status, "ok");
  const bumped = pinConsistency(pins, { ...installed, omo: "5.1.40" });
  assert.equal(bumped.status, "drift");
  assert.match(bumped.actual, /omo\.cmd\.omo=5\.1\.38/);
  assert.match(bumped.actual, /overlay=5\.1\.38/);
  assert.equal(pinConsistency([{ label: "reentry", omo: null, senpi: "2026.10.19" }], installed).status, "drift");
  assert.equal(pinConsistency(pins, { ...installed, senpi: null }).status, "drift");
});

test("CLI: default run exits 0 on drift, --strict fails it, an --only run never passes", () => {
  const agent = fs.mkdtempSync(path.join(os.tmpdir(), "check-cli-agent-"));
  const run = (...args) =>
    spawnSync(process.execPath, [CHECKER, "--only", "settings-guard", ...args], {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, OMO_CHECK_AGENT_DIR: agent },
    });
  try {
    const plain = run();
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /^PATCH settings-guard .*installed=missing\(0\/1\)/m);
    assert.match(plain.stdout, /^SUMMARY patches=1 /m);
    assert.doesNotMatch(plain.stdout, /^STRICT /m);

    const strict = run("--strict");
    assert.equal(strict.status, 1, strict.stdout);
    assert.match(strict.stdout, /^FAIL settings-guard: missing /m);
    assert.match(strict.stdout, /^STRICT verdict=fail exit=1 /m);

    const json = run("--json");
    assert.equal(json.status, 0, json.stderr);
    const doc = JSON.parse(json.stdout);
    assert.equal(doc.schema, "omo-check-patches/1");
    assert.equal(doc.rows.length, 1);
    assert.equal(doc.verdict.verdict, "fail");
    assert.equal(doc.ledger, null);

    // Same bytes as the row's HEAD source: every automated item is ok, yet --only stays incomplete.
    const source = execFileSync("git", ["show", "HEAD:custom-layer/settings-guard/extension.mjs"], {
      cwd: path.dirname(path.dirname(CHECKER)),
      encoding: null,
    });
    fs.mkdirSync(path.join(agent, "settings-guard"));
    fs.writeFileSync(path.join(agent, "settings-guard", "extension.mjs"), source);
    const partial = run("--strict", "--json");
    const partialDoc = JSON.parse(partial.stdout);
    assert.deepEqual(partialDoc.verdict.failures, []);
    assert.equal(partialDoc.verdict.verdict, "incomplete");
    assert.equal(partial.status, 3);
    assert.ok(partialDoc.verdict.unverified.some((line) => line.includes("--only run")));
  } finally {
    fs.rmSync(agent, { recursive: true, force: true });
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
