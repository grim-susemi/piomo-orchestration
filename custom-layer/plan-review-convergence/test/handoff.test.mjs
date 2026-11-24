import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { handoffNotice, resolveHandoff } from "../handoff.mjs";
import { runHostCase } from "./helpers/host.mjs";

let host = null;

before(async () => {
  host = await runHostCase({
    name: "handoff-real-receipt",
    variant: "candidate",
    steps: [{ kind: "review" }, { kind: "review" }],
    verdicts: ["OKAY"],
    keep: true,
  });
});

after(() => {
  if (host?.tempRoot) rmSync(host.tempRoot, { recursive: true, force: true });
});

test("native-handoff-freshness: the real host receipt is APPROVED only through the child read", () => {
  assert.ok(host, "the host probe did not run");
  const status = resolveHandoff({
    agentDir: host.agentDir,
    stateRoot: host.stateRoot,
    state: host.state,
    planPath: host.planPath,
    currentSha: host.planSha256,
    workspaceRoot: host.workspace,
  });
  assert.equal(status.reviewStatus, "APPROVED");
  assert.equal(status.receiptId, host.reviewerTaskIds[0]);
  assert.equal(status.receipt.childSessionId, host.taskRecords[0].child_session_id);
  assert.equal(status.receipt.reviewerRole, "plan-reviewer");
  assert.equal(status.receipt.terminationEvent, host.taskRecords[0].terminal_at);
  assert.equal(status.receipt.reviewedBodySha256, host.planSha256);
  assert.equal(status.receipt.planSha256, host.planSha256);
  assert.ok(status.receipt.childReadEventId);
  assert.equal(status.receipt.reviewedSnapshotRef.startsWith("snapshots/"), true);
  assert.match(handoffNotice(status, host.planPath), /PRC_HANDOFF APPROVED/);
  assert.doesNotMatch(handoffNotice(status, host.planPath), /PRC_HANDOFF UNVERIFIED/);
});

test("native-handoff-freshness: changed bytes are still UNVERIFIED for the old receipt", () => {
  const status = resolveHandoff({
    agentDir: host.agentDir,
    stateRoot: host.stateRoot,
    state: host.state,
    planPath: host.planPath,
    currentSha: "b".repeat(64),
    workspaceRoot: host.workspace,
  });
  assert.equal(status.reviewStatus, "UNVERIFIED");
  assert.equal(status.reason, "PLAN_SHA_MISMATCH");
  assert.equal(status.receipt.reviewedBodySha256, host.planSha256);
  assert.doesNotMatch(handoffNotice(status, host.planPath), /PRC_HANDOFF APPROVED/);
});

test("native-handoff-freshness: missing state is UNVERIFIED with NO_STATE", () => {
  const status = resolveHandoff({
    agentDir: host.agentDir,
    stateRoot: host.stateRoot,
    state: null,
    planPath: host.planPath,
    currentSha: host.planSha256,
    workspaceRoot: host.workspace,
  });
  assert.equal(status.reviewStatus, "UNVERIFIED");
  assert.equal(status.reason, "NO_STATE");
});
