import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ReceiptLedger, bindReceipt, classifyVerdict, parseFindings, sha256Bytes } from "../receipt.mjs";

const ACTUAL_TASK = "C:/Users/USER/orca/projects/기타 작업/.omo/senpi-task/tasks/st_01a2092c.json";
const PLAN_PATH = "C:/Users/USER/orca/projects/기타 작업/.omo/plans/omo-5181-snapcompact-upgrade.md";
const SNAP = Buffer.from("# plan body reviewed by the child\n", "utf8");
const SNAP_SHA = sha256Bytes(SNAP);
const ACTUAL = JSON.parse(readFileSync(ACTUAL_TASK, "utf8"));

function okay(overrides = {}) {
  return bindReceipt({
    taskRecord: {
      task_id: "st_ok",
      child_session_id: "child-ok",
      parent_session_id: "parent-ok",
      agent_type: "plan-reviewer",
      execution_mode: "in-process",
      status: "completed",
      started_at: "2026-11-24T00:00:00.000Z",
      terminal_at: "2026-11-24T00:00:10.000Z",
      final_response: "**[OKAY]**\n\nLooks good.",
      spawn_spec: { prompt: `Review the work plan at ${PLAN_PATH} for contradictions and blocking issues.` },
      ...overrides.taskRecord,
    },
    expected: {
      W: "upgrade",
      roundId: "r90",
      launchKey: "r90-ok",
      taskId: "st_ok",
      childSessionId: "child-ok",
      parentSessionId: "parent-ok",
      reviewerRole: "plan-reviewer",
      planPath: PLAN_PATH,
      reviewedSha: SNAP_SHA,
      currentSha: SNAP_SHA,
      ...overrides.expected,
    },
    reviewedSnapshotRef: `snapshots/${SNAP_SHA}.md`,
    reviewedSnapshotBytes: SNAP,
    safeRead: true,
    hostTrusted: true,
    childRead: {
      childSessionId: overrides.taskRecord?.child_session_id ?? "child-ok",
      sha256: overrides.expected?.reviewedSha ?? SNAP_SHA,
      terminalEvent: overrides.taskRecord?.terminal_at ?? "2026-11-24T00:00:10.000Z",
    },
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

test("parseFindings keeps the reviewer's own blocker bullets", () => {
  const findings = parseFindings("[REJECT]\n\n- blocker: task 3 references a missing file\n- major: no QA command\n");
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "blocker");
  assert.match(findings[0].note, /task 3 references/u);
  assert.equal(findings[1].severity, "major");
});

test("receipt-matching-okay: a duplicate notification approves once", () => {
  const receipt = okay();
  assert.equal(receipt.status, "APPROVED");
  assert.equal(receipt.approvalDisplay, true);
  assert.equal(receipt.reviewedBodySha256, SNAP_SHA);
  assert.equal(receipt.planSha256, SNAP_SHA);
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

test("receipt-real-gate-response: real observed bytes stay byte-exact and never become a plan verdict", () => {
  const receipt = bindReceipt({
    taskRecord: {
      task_id: "st_01a203eb",
      child_session_id: "01a203eb-child",
      parent_session_id: "01a201bd-parent",
      agent_type: "plan-reviewer",
      execution_mode: "in-process",
      status: "completed",
      started_at: "2026-11-22T15:40:00.000Z",
      terminal_at: "2026-11-22T15:44:00.000Z",
      final_response: ACTUAL.final_response,
      spawn_spec: { prompt: `Review the work plan at ${PLAN_PATH} for contradictions and blocking issues.` },
    },
    expected: {
      W: "upgrade",
      roundId: "r83",
      launchKey: "r83-ab92",
      taskId: "st_01a203eb",
      childSessionId: "01a203eb-child",
      parentSessionId: "01a201bd-parent",
      reviewerRole: "plan-reviewer",
      planPath: PLAN_PATH,
      reviewedSha: SNAP_SHA,
      currentSha: SNAP_SHA,
    },
    reviewedSnapshotRef: `snapshots/${SNAP_SHA}.md`,
    reviewedSnapshotBytes: SNAP,
    safeRead: true,
    hostTrusted: true,
  });
  assert.equal(receipt.status, "INCONCLUSIVE");
  assert.equal(receipt.reason, "NO_SINGLE_TOKEN");
  assert.equal(receipt.rawResponseUtf8, ACTUAL.final_response);
  assert.equal(receipt.responseSha256, sha256Bytes(Buffer.from(ACTUAL.final_response, "utf8")));
  assert.equal(receipt.reviewedBodySha256, SNAP_SHA);
  assert.notEqual(receipt.responseSha256, receipt.reviewedBodySha256);
  assert.ok(receipt.findings.length >= 7);
});

test("receipt-reject-token: a plan-reviewer rejection is CHANGES_REQUESTED against the snapshot bytes", () => {
  const raw = "[REJECT]\n\n- blocker: Task 3 references a missing file\n";
  const receipt = bindReceipt({
    taskRecord: {
      task_id: "st_reject",
      child_session_id: "child-reject",
      parent_session_id: "parent-ok",
      agent_type: "plan-reviewer",
      execution_mode: "in-process",
      status: "completed",
      started_at: "2026-11-24T00:00:00.000Z",
      terminal_at: "2026-11-24T00:00:10.000Z",
      final_response: raw,
      spawn_spec: { prompt: `Review the work plan at ${PLAN_PATH} for contradictions and blocking issues.` },
    },
    expected: {
      W: "upgrade",
      roundId: "r91",
      launchKey: "r91-reject",
      taskId: "st_reject",
      childSessionId: "child-reject",
      parentSessionId: "parent-ok",
      reviewerRole: "plan-reviewer",
      planPath: PLAN_PATH,
      reviewedSha: SNAP_SHA,
      currentSha: SNAP_SHA,
    },
    reviewedSnapshotRef: `snapshots/${SNAP_SHA}.md`,
    reviewedSnapshotBytes: SNAP,
    safeRead: true,
    hostTrusted: true,
  });
  assert.equal(receipt.status, "CHANGES_REQUESTED");
  assert.equal(receipt.verdict, "REJECT");
  assert.equal(receipt.findings[0].severity, "blocker");
});

test("receipt-real-record: a real task from another reviewer role is rejected", () => {
  const snapshot = Buffer.from(ACTUAL.final_response, "utf8");
  const receipt = bindReceipt({
    taskRecord: ACTUAL,
    expected: {
      W: "upgrade",
      roundId: "r83",
      taskId: ACTUAL.task_id,
      childSessionId: ACTUAL.child_session_id,
      parentSessionId: ACTUAL.parent_session_id,
      planPath: PLAN_PATH,
      reviewedSha: sha256Bytes(snapshot),
      currentSha: sha256Bytes(snapshot),
    },
    reviewedSnapshotRef: `snapshots/${sha256Bytes(snapshot)}.md`,
    reviewedSnapshotBytes: snapshot,
    safeRead: true,
    hostTrusted: true,
  });
  assert.equal(receipt.status, "INCONCLUSIVE");
  assert.equal(receipt.reason, "REVIEWER_ROLE_MISMATCH");
  assert.equal(receipt.childSessionId, ACTUAL.child_session_id);
  assert.equal(receipt.terminationEvent, ACTUAL.terminal_at);
});

test("receipt-stale-drift: task, child, parent, role, terminal, path, runtime, and safety mismatches are inconclusive", () => {
  const cases = [
    { expected: { taskId: "st-other" }, reason: "TASK_MISMATCH" },
    { expected: { childSessionId: "child-other" }, reason: "CHILD_SESSION_MISMATCH" },
    { taskRecord: { child_session_id: "parent-ok" }, expected: { childSessionId: "parent-ok" }, reason: "CHILD_SESSION_IS_PARENT" },
    { taskRecord: { child_session_id: "" }, reason: "CHILD_SESSION_MISSING" },
    { expected: { parentSessionId: "parent-other" }, reason: "PARENT_SESSION_MISMATCH" },
    { taskRecord: { agent_type: "explore" }, reason: "REVIEWER_ROLE_MISMATCH" },
    { taskRecord: { status: "running" }, reason: "TASK_NOT_TERMINAL" },
    { taskRecord: { terminal_at: null }, reason: "TASK_NOT_TERMINAL" },
    { taskRecord: { roundId: "r89" }, expected: { roundId: "r90" }, reason: "ROUND_MISMATCH" },
    { taskRecord: { runtimeSha: "runtime-other" }, expected: { runtimeSha: "runtime-ok" }, reason: "RUNTIME_MISMATCH" },
    { taskRecord: { spawn_spec: { prompt: "C:/other/.omo/plans/other.md" } }, reason: "PLAN_PATH_MISMATCH" },
    { input: { safeRead: false }, reason: "UNSAFE_READ" },
    { input: { hostTrusted: false }, reason: "UNSAFE_READ" },
    { input: { stopAfterArrival: true }, reason: "STOPPED" },
  ];
  for (const entry of cases) {
    const receipt = okay(entry);
    assert.equal(receipt.status, "INCONCLUSIVE", entry.reason);
    assert.equal(receipt.approvalDisplay, false);
    assert.equal(receipt.reason, entry.reason);
  }
});

test("receipt-stale-drift: a changed plan after an OKAY keeps the verdict but never approves", () => {
  const changed = okay({ expected: { currentSha: "b".repeat(64) } });
  assert.equal(changed.status, "INCONCLUSIVE");
  assert.equal(changed.reason, "PLAN_CHANGED");
  assert.equal(changed.verdict, "OKAY");
  assert.equal(changed.currentMatchesReviewed, false);
  assert.equal(changed.approvalDisplay, false);
});

test("receipt-stale-drift: missing or mismatched snapshot evidence keeps the verdict but never approves", () => {
  const missing = okay({ input: { reviewedSnapshotRef: null, reviewedSnapshotBytes: null } });
  assert.equal(missing.status, "INCONCLUSIVE");
  assert.equal(missing.reason, "EVIDENCE_UNAVAILABLE");
  assert.equal(missing.autoProgress, 0);

  const mismatch = okay({ input: { reviewedSnapshotBytes: Buffer.from("different bytes\n", "utf8") } });
  assert.equal(mismatch.reason, "SNAPSHOT_SHA_MISMATCH");
  assert.equal(mismatch.approvalDisplay, false);
});

test("a changed plan after approval cannot reuse the same receipt for display", () => {
  const approved = okay();
  assert.equal(approved.approvalDisplay, true);
  const changed = okay({ expected: { currentSha: "sha-next" } });
  assert.equal(changed.status, "INCONCLUSIVE");
  assert.equal(changed.reason, "PLAN_CHANGED");
  const ledger = new ReceiptLedger();
  ledger.apply(approved);
  assert.equal(ledger.apply(changed).approvalDisplay, false);
});
