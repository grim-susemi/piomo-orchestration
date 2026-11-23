import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ReceiptLedger, bindReceipt, classifyVerdict, sha256Bytes } from "../receipt.mjs";

const ACTUAL_TASK = "C:/Users/USER/orca/projects/기타 작업/.omo/senpi-task/tasks/st_01a203eb.json";
const PLAN_PATH = "C:/Users/USER/orca/projects/기타 작업/.omo/plans/omo-5181-snapcompact-upgrade.md";
const R83_SHA = "ab92ce5d927336a74dfdddd4c404db8e08ae7f378fcf0dd59e07245fe02ec5d1";
const ACTUAL = JSON.parse(readFileSync(ACTUAL_TASK, "utf8"));

function okay(overrides = {}) {
  return bindReceipt({
    taskRecord: {
      task_id: "st_ok",
      child_session_id: "child-ok",
      status: "completed",
      final_response: "**[OKAY]**\n\nLooks good.",
      spawn_spec: { prompt: PLAN_PATH },
      ...overrides.taskRecord,
    },
    expected: {
      W: "upgrade",
      roundId: "r90",
      launchKey: "r90-ok",
      taskId: "st_ok",
      childSessionId: "child-ok",
      planPath: PLAN_PATH,
      reviewedSha: "sha-ok",
      currentSha: "sha-ok",
      ...overrides.expected,
    },
    reviewedSnapshotRef: "snapshot:r90",
    reviewedSnapshotSha256: "sha-ok",
    safeRead: true,
    hostTrusted: true,
    ...overrides.input,
  });
}

test("classifyVerdict accepts one emphasized token on the first non-empty line", () => {
  assert.equal(classifyVerdict("**[OKAY]**\n\nfine").verdict, "OKAY");
  assert.equal(classifyVerdict("**[REJECT]**\n\nblocked").verdict, "REJECT");
  assert.equal(classifyVerdict("__[OKAY]__").verdict, "OKAY");
});

test("classifyVerdict rejects ambiguity, author prose, and empty responses", () => {
  assert.equal(classifyVerdict("[OKAY] [REJECT]").reason, "AMBIGUOUS_VERDICT");
  assert.equal(classifyVerdict("approved by the author").reason, "NO_SINGLE_TOKEN");
  assert.equal(classifyVerdict("").reason, "MISSING_RESPONSE");
});

test("receipt-matching-okay: a duplicate notification approves once", () => {
  const receipt = okay();
  assert.equal(receipt.status, "APPROVED");
  assert.equal(receipt.approvalDisplay, true);
  const ledger = new ReceiptLedger();
  const first = ledger.apply(receipt);
  const second = ledger.apply(receipt);
  assert.equal(first.approvalDisplay, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.approvalDisplay, false);
  const other = okay({
    taskRecord: { task_id: "st_ok2", child_session_id: "child-ok2", final_response: "**[OKAY]**\n\nsecond" },
    expected: { taskId: "st_ok2", childSessionId: "child-ok2" },
  });
  const third = ledger.apply(other);
  assert.equal(third.duplicate, true);
  assert.equal(third.approvalDisplay, false);
});

test("receipt-raw-reject: the actual r83 response stays byte-exact and separate from the plan hash", () => {
  const receipt = bindReceipt({
    taskRecord: ACTUAL,
    expected: {
      W: "upgrade",
      roundId: "r83",
      launchKey: "r83-ab92",
      taskId: ACTUAL.task_id,
      childSessionId: ACTUAL.child_session_id,
      planPath: PLAN_PATH,
      reviewedSha: R83_SHA,
      currentSha: R83_SHA,
    },
    reviewedSnapshotRef: "snapshot:r83",
    reviewedSnapshotSha256: R83_SHA,
    safeRead: true,
    hostTrusted: true,
  });
  assert.equal(receipt.status, "CHANGES_REQUESTED");
  assert.equal(receipt.verdict, "REJECT");
  assert.equal(receipt.rawResponseUtf8, ACTUAL.final_response);
  assert.equal(receipt.responseSha256, sha256Bytes(Buffer.from(ACTUAL.final_response, "utf8")));
  assert.equal(receipt.reviewedBodySha256, R83_SHA);
  assert.notEqual(receipt.responseSha256, receipt.reviewedBodySha256);
});

test("receipt-stale-drift: task, child, round, runtime, path, terminal, and safety mismatches are inconclusive", () => {
  const cases = [
    { expected: { taskId: "st-other" }, reason: "TASK_MISMATCH" },
    { expected: { childSessionId: "child-other" }, reason: "CHILD_SESSION_MISMATCH" },
    { taskRecord: { roundId: "r89" }, expected: { roundId: "r90" }, reason: "ROUND_MISMATCH" },
    { taskRecord: { runtimeSha: "runtime-other" }, expected: { runtimeSha: "runtime-ok" }, reason: "RUNTIME_MISMATCH" },
    { taskRecord: { spawn_spec: { prompt: "C:/other/.omo/plans/other.md" } }, reason: "PLAN_PATH_MISMATCH" },
    { taskRecord: { status: "running" }, reason: "TASK_NOT_TERMINAL" },
    { input: { safeRead: false }, reason: "UNSAFE_READ" },
    { input: { hostTrusted: false }, reason: "UNSAFE_READ" },
    { input: { stopAfterArrival: true }, reason: "STOPPED" },
    { expected: { currentSha: "sha-next" }, reason: "PLAN_CHANGED" },
  ];
  for (const entry of cases) {
    const receipt = okay(entry);
    assert.equal(receipt.status, "INCONCLUSIVE", entry.reason);
    assert.equal(receipt.approvalDisplay, false);
    assert.equal(receipt.reason, entry.reason);
  }
});

test("receipt-stale-drift: missing or mismatched snapshot evidence keeps the verdict but never approves", () => {
  const missing = bindReceipt({
    taskRecord: ACTUAL,
    expected: {
      W: "upgrade",
      roundId: "r83",
      launchKey: "r83-ab92",
      taskId: ACTUAL.task_id,
      childSessionId: ACTUAL.child_session_id,
      planPath: PLAN_PATH,
      reviewedSha: R83_SHA,
      currentSha: R83_SHA,
    },
    reviewedSnapshotRef: null,
    reviewedSnapshotSha256: null,
    safeRead: true,
    hostTrusted: true,
  });
  assert.equal(missing.status, "INCONCLUSIVE");
  assert.equal(missing.reason, "EVIDENCE_UNAVAILABLE");
  assert.equal(missing.verdict, "REJECT");
  assert.equal(missing.autoProgress, 0);
  assert.equal(missing.approvalDisplay, false);

  const mismatch = okay({
    input: { reviewedSnapshotSha256: "different" },
  });
  assert.equal(mismatch.reason, "SNAPSHOT_SHA_MISMATCH");
  assert.equal(mismatch.approvalDisplay, false);
});

test("a changed plan after approval cannot reuse the same receipt for display", () => {
  const approved = okay();
  assert.equal(approved.approvalDisplay, true);
  const changed = okay({ expected: { reviewedSha: "sha-ok", currentSha: "sha-next" } });
  assert.equal(changed.status, "INCONCLUSIVE");
  assert.equal(changed.reason, "PLAN_CHANGED");
  const ledger = new ReceiptLedger();
  ledger.apply(approved);
  assert.equal(ledger.apply(changed).approvalDisplay, false);
});
