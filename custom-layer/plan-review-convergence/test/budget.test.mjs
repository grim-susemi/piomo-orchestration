import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  complete,
  initialize,
  logicalKey,
  markStop,
  readState,
  reserve,
  resolveBudget,
} from "../state.mjs";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "helpers", "reserve-worker.mjs");

function base(t) {
  const root = mkdtempSync(join(tmpdir(), "prc-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspaceId: "ws-1", workspaceRoot: "C:/ws", planPath: "C:/ws/.omo/plans/plan.md" };
}

function init(options, extra = {}) {
  return initialize({
    ...options,
    planSha256: "a".repeat(64),
    firstRequest: { eventId: "spawn:test", promptSha256: "f".repeat(64) },
    ...extra,
  });
}

function state(options) {
  return readState(options.root, logicalKey(options).key);
}

function runWorker(options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(options)], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("close", (code) => {
      let result = null;
      try { result = JSON.parse(stdout); } catch {}
      resolve({ code, result, stderr });
    });
  });
}

test("initialize requires an observed first request, not a bare init", (t) => {
  const options = base(t);
  const rejected = initialize({ ...options, planSha256: "a".repeat(64) });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "FIRST_REQUEST_REQUIRED");
  const badDigest = initialize({
    ...options,
    planSha256: "a".repeat(64),
    firstRequest: { eventId: "spawn:test", promptSha256: "not-a-digest" },
  });
  assert.equal(badDigest.reason, "FIRST_REQUEST_INVALID");
  assert.equal(state(options), null);

  const created = init(options, { explicitLimit: 1 });
  assert.equal(created.created, true);
  assert.equal(created.state.firstRequestEventId, "spawn:test");
  assert.equal(created.state.firstRequestPromptSha256, "f".repeat(64));
});

test("reserve-compete-final-token: two workers share one final token", async (t) => {
  const options = base(t);
  assert.equal(init(options, { explicitLimit: 1 }).state.B, 1);
  const args = { ...options, planSha256: "a".repeat(64), roundNo: 1 };
  const [first, second] = await Promise.all([
    runWorker({ ...args, launchKey: "launch-a" }),
    runWorker({ ...args, launchKey: "launch-b" }),
  ]);
  const results = [first, second].map((entry) => entry.result);
  const winners = results.filter((result) => result?.ok === true);
  const blocked = results.filter((result) =>
    ["BUDGET_EXHAUSTED", "UNRESOLVED_LAUNCH"].includes(result?.reason));
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(blocked.length, 1, JSON.stringify(results));
  const current = state(options);
  assert.equal(current.U, 1);
  assert.equal(current.autoUsed, 1);
  assert.equal(current.manualUsed, 0);
  assert.equal(current.B, 1);
});

test("reserve-crash: an unresolved reservation blocks a second launch until completed", (t) => {
  const before = base(t);
  init(before, { explicitLimit: 1 });
  assert.throws(
    () => reserve({
      ...before,
      planSha256: "a".repeat(64),
      launchKey: "crash-before",
      beforeWrite: () => { throw new Error("CRASH_BEFORE"); },
    }),
    /CRASH_BEFORE/,
  );
  assert.equal(state(before).U, 0);
  assert.equal(state(before).childReceiptId, null);

  const afterRecord = base(t);
  init(afterRecord, { explicitLimit: 1 });
  assert.equal(reserve({ ...afterRecord, planSha256: "a".repeat(64), launchKey: "record" }).ok, true);
  assert.equal(state(afterRecord).U, 1);
  assert.equal(state(afterRecord).childReceiptId, null);
  assert.equal(
    reserve({ ...afterRecord, planSha256: "a".repeat(64), launchKey: "retry" }).reason,
    "UNRESOLVED_LAUNCH",
  );
  const recovered = complete({
    ...afterRecord,
    launchKey: "record",
    childReceiptId: "st_record",
  });
  assert.equal(recovered.ok, true);
  assert.equal(
    reserve({ ...afterRecord, planSha256: "b".repeat(64), launchKey: "retry" }).reason,
    "BUDGET_EXHAUSTED",
  );
});

test("cap-edit-alias: default 5, explicit 1, and aliases share the same key", (t) => {
  const options = base(t);
  assert.equal(init(options, { draftLimit: 83 }).state.B, 5);
  assert.throws(() => resolveBudget(83), /INVALID_BUDGET/);
  assert.throws(() => resolveBudget(0), /INVALID_BUDGET/);
  assert.equal(resolveBudget(1), 1);
  assert.equal(resolveBudget(5), 5);

  const alias = logicalKey({
    workspaceId: "WS-1",
    workspaceRoot: "C:/ws/",
    cwd: "C:/ws/.omo",
    planPath: "plans\\plan.md",
  });
  const canonical = logicalKey(options);
  assert.equal(alias.key, canonical.key);
  assert.equal(
    logicalKey({ ...options, workspaceId: "ws-2" }).key === canonical.key,
    false,
  );
  assert.equal(
    logicalKey({ ...options, planPath: "C:/ws/.omo/plans/other.md" }).key === canonical.key,
    false,
  );
  assert.equal(alias.canonical, ".omo/plans/plan.md");

  const explicit = base(t);
  assert.equal(init(explicit, { explicitLimit: 1 }).state.B, 1);
  assert.equal(reserve({ ...explicit, planSha256: "a".repeat(64), launchKey: "one" }).ok, true);
  complete({ ...explicit, launchKey: "one", childReceiptId: "st_one" });
  assert.equal(
    reserve({ ...explicit, planSha256: "b".repeat(64), launchKey: "two" }).reason,
    "BUDGET_EXHAUSTED",
  );
  const current = state(explicit);
  assert.equal(current.B, 1);
  assert.equal(current.U, 1);
  assert.equal(current.planSha256, "a".repeat(64));
});

test("no-state: a missing ledger fails closed", (t) => {
  const options = base(t);
  const result = reserve({ ...options, planSha256: "a".repeat(64), launchKey: "missing" });
  assert.equal(result.reason, "NO_STATE");
  assert.equal(state(options), null);
});

test("corrupt state fails closed without writing", (t) => {
  const options = base(t);
  init(options);
  const dir = join(options.root, readdirSync(options.root)[0]);
  writeFileSync(join(dir, "state-99.json"), "{not-json", "utf8");
  assert.throws(() => state(options), /STATE_CORRUPT/);
  assert.throws(
    () => reserve({ ...options, planSha256: "a".repeat(64), launchKey: "corrupt" }),
    /STATE_CORRUPT/,
  );
});

test("STOP_UNKNOWN survives a new init and blocks reservation", (t) => {
  const options = base(t);
  init(options, { explicitLimit: 1 });
  assert.equal(markStop({ ...options, reason: "STOP_UNKNOWN" }).ok, true);
  assert.equal(state(options).status, "stop-unknown");
  assert.equal(
    reserve({ ...options, planSha256: "a".repeat(64), launchKey: "blocked" }).reason,
    "STATE_STOPPED",
  );
  const reinit = init(options, { explicitLimit: 1 });
  assert.equal(reinit.created, false);
  assert.equal(reinit.state.status, "stop-unknown");
});

test("the same launch key is a replay, never permission to launch again", (t) => {
  const options = base(t);
  init(options, { explicitLimit: 2 });
  assert.equal(reserve({ ...options, planSha256: "a".repeat(64), launchKey: "same" }).ok, true);
  const second = reserve({ ...options, planSha256: "b".repeat(64), launchKey: "same" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "DUPLICATE_LAUNCH");
  assert.equal(second.duplicate, true);
  assert.equal(state(options).U, 1);
});

test("expected revision and unresolved reservation are checked before a new launch", (t) => {
  const options = base(t);
  const created = init(options, { explicitLimit: 2 });
  const revision = created.state.revision;
  const mismatch = reserve({
    ...options,
    planSha256: "a".repeat(64),
    launchKey: "stale-view",
    expectedRevision: revision + 1,
  });
  assert.equal(mismatch.reason, "REVISION_MISMATCH");
  assert.equal(state(options).U, 0);

  assert.equal(reserve({
    ...options,
    planSha256: "a".repeat(64),
    launchKey: "reserved",
    expectedRevision: revision,
  }).ok, true);
  assert.equal(
    reserve({ ...options, planSha256: "a".repeat(64), launchKey: "second" }).reason,
    "UNRESOLVED_LAUNCH",
  );
});

test("manual reservation is one-shot and never changes B", (t) => {
  const options = base(t);
  init(options, { explicitLimit: 1 });
  assert.equal(reserve({ ...options, planSha256: "a".repeat(64), launchKey: "auto" }).ok, true);
  complete({ ...options, launchKey: "auto", childReceiptId: "st_auto" });
  const manual = reserve({
    ...options,
    planSha256: "a".repeat(64),
    launchKey: "manual",
    kind: "manual",
    ownerEventId: "owner-event-1",
  });
  assert.equal(manual.ok, true);
  assert.equal(manual.state.B, 1);
  assert.equal(manual.state.U, 2);
  assert.equal(manual.state.manualUsed, 1);
  complete({ ...options, launchKey: "manual", childReceiptId: "st_manual" });
  assert.equal(
    reserve({
      ...options,
      planSha256: "a".repeat(64),
      launchKey: "manual-reused",
      kind: "manual",
      ownerEventId: "owner-event-1",
    }).reason,
    "OWNER_EVENT_REUSED",
  );
  assert.equal(
    reserve({
      ...options,
      planSha256: "a".repeat(64),
      launchKey: "manual-second",
      kind: "manual",
      ownerEventId: "owner-event-2",
    }).reason,
    "MANUAL_EXHAUSTED",
  );
});

test("complete binds one child receipt without refunding usage", (t) => {
  const options = base(t);
  init(options, { explicitLimit: 1 });
  assert.equal(reserve({ ...options, planSha256: "a".repeat(64), launchKey: "auto" }).ok, true);
  const reserved = state(options);
  assert.equal(
    complete({ ...options, launchKey: "auto", childReceiptId: "st_01a20000", expectedRevision: reserved.revision + 1 }).reason,
    "REVISION_MISMATCH",
  );
  const done = complete({
    ...options,
    launchKey: "auto",
    childReceiptId: "st_01a20000",
    expectedRevision: reserved.revision,
  });
  assert.equal(done.ok, true);
  assert.equal(done.state.childReceiptId, "st_01a20000");
  assert.equal(done.state.U, 1);
  const again = complete({
    ...options,
    launchKey: "auto",
    childReceiptId: "st_01a20000",
  });
  assert.equal(again.duplicate, true);
  assert.equal(state(options).U, 1);
  assert.equal(
    reserve({ ...options, planSha256: "b".repeat(64), launchKey: "next" }).reason,
    "BUDGET_EXHAUSTED",
  );
});
