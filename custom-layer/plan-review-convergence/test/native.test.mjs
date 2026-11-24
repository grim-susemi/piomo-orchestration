import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..", "probe.mjs");
const EVIDENCE = "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/ulw-plan-review-convergence/repair-r5";

function runCase(caseId) {
  const root = mkdtempSync(join(tmpdir(), `prc-native-${caseId}-`));
  const out = join(root, "report.json");
  try {
    const result = spawnSync(process.execPath, [
      PROBE, "--variant", "candidate", "--case", caseId, "--out", out,
    ], { stdio: "ignore", timeout: 900000 });
    assert.equal(result.status, 0, `${caseId} probe failed`);
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.ok, true, `${caseId} report was not ok`);
    return report.scenarios[0];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function save(name, scenario) {
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `${name}.json`), `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
}

test("native-single-review: a real child read approves the normal first OKAY", { timeout: 900000 }, () => {
  const scenario = runCase("native-single-review");
  save("native-single-review", scenario);
  assert.equal(scenario.state, "receipt-approved");
  assert.equal(scenario.reviewerTaskIds.length, 1);
  assert.equal(scenario.launchesFromHost, 1);
  assert.equal(scenario.evidence.receiptStatus, "APPROVED");
  assert.ok(scenario.evidence.childReadEventId);
  assert.ok(scenario.evidence.childReadResultEventId);
  assert.equal(scenario.evidence.reviewedBodySha256, scenario.evidence.snapshotSha256);
  assert.equal(scenario.evidence.denial, "PRC_ALREADY_APPROVED");
});

test("native-normal-batch: two requests in one turn produce one child", { timeout: 900000 }, () => {
  const scenario = runCase("native-batch-review");
  save("native-normal-batch", scenario);
  assert.equal(scenario.state, "batch-single-child");
  assert.equal(scenario.reviewerTaskIds.length, 1);
  assert.ok(scenario.evidence.denial);
});

test("native-auto-progress-allows: a different next-round blocker key allows the next review", { timeout: 900000 }, () => {
  const scenario = runCase("native-auto-progress-allows");
  save("native-auto-progress-allows", scenario);
  assert.equal(scenario.state, "convergence-allowed");
  assert.equal(scenario.evidence.budgetB, 3);
  assert.deepEqual(scenario.evidence.progressReasons, ["NO_REVIEW_RESULT", "NEW_BLOCKER_KEYS"]);
  assert.deepEqual(scenario.evidence.reservedKeys, ["IS-1|gateway-access-order|gateway|contradiction"]);
  assert.deepEqual(scenario.evidence.nextKeys, ["IS-1|resume-order|gateway|contradiction"]);
  assert.equal(scenario.evidence.noResultProgress.reason, "NO_REVIEW_RESULT");
  assert.equal(scenario.evidence.autoUsed, 2);
  assert.equal(scenario.evidence.manualUsed, 1);
  assert.equal(scenario.reviewerTaskIds.length, 3);
  assert.equal(scenario.evidence.newReviewerTaskIds.length, 2);
});

test("native-auto-sha-only-denies: no next-round result means no extra launch or charge", { timeout: 900000 }, () => {
  const scenario = runCase("native-auto-sha-only-denies");
  save("native-auto-sha-only-denies", scenario);
  assert.equal(scenario.state, "no-next-result-denied");
  assert.equal(scenario.reviewerTaskIds.length, 1);
  assert.equal(scenario.evidence.budgetB, 3);
  assert.equal(scenario.evidence.autoUsed, 1);
  assert.equal(scenario.evidence.manualUsed, 0);
  assert.equal(scenario.evidence.additionalReviewers, 0);
  assert.equal(scenario.evidence.additionalAutoUsed, 0);
  assert.equal(scenario.evidence.denial, "PRC_NO_REVIEW_RESULT");
  assert.equal(scenario.evidence.progressReasons.length, 0);
  assert.ok(scenario.evidence.firstKey.includes("IS-1|gateway-access-order|gateway|contradiction"));
});

test("native-owner-findings: the notice row carries the four classes, evidence and duplicate key", { timeout: 900000 }, () => {
  const scenario = runCase("native-owner-findings");
  save("native-owner-findings", scenario);
  assert.equal(scenario.state, "owner-findings-delivered");
  assert.equal(scenario.reviewerTaskIds.length, 2);
  assert.ok(scenario.evidence.findingsRequestRow);
  assert.ok(scenario.evidence.noticeRow.toolCallId);
  assert.ok(scenario.evidence.notice.deliveryId);
  assert.equal(scenario.evidence.notice.classifications.length, 4);
  assert.ok(scenario.evidence.notice.evidenceLine);
  assert.ok(scenario.evidence.notice.duplicateKey);
  assert.equal(scenario.evidence.foreignShown, false);
  assert.equal(scenario.evidence.chatDelivery, "UNSUPPORTED_BY_HOST");
  assert.equal(scenario.evidence.assistantNoticeRows.length, 0);
  assert.ok(scenario.evidence.toolResultNoticeRows.length > 0);
});

test("native-resume: the real question row and an explicit yes authorize one manual review", { timeout: 900000 }, () => {
  const scenario = runCase("native-resume");
  save("native-resume", scenario);
  assert.equal(scenario.state, "chat-question-bound");
  assert.equal(scenario.evidence.manualUsed, 1);
  assert.equal(scenario.evidence.answerSource, "owner-chat");
  assert.ok(scenario.evidence.hostRequestId);
  assert.ok(scenario.evidence.answerEventId);
  assert.equal(scenario.evidence.questionStatus, "consumed");
  assert.equal(scenario.evidence.approvedProgress.allow, true);
  assert.equal(scenario.evidence.approvedProgress.reason, "APPROVED");
});

test("native-delegation-handoff: H0 is APPROVED and the post-edit H1 is UNVERIFIED", { timeout: 900000 }, () => {
  const scenario = runCase("native-delegation-handoff");
  save("native-delegation-handoff", scenario);
  assert.equal(scenario.state, "handoff-approved-then-stale");
  assert.equal(scenario.executorTaskIds.length, 2);
  assert.match(scenario.evidence.h0Head, /PRC_HANDOFF APPROVED/u);
  assert.match(scenario.evidence.h0Head, /receipt=st_/u);
  assert.match(scenario.evidence.h1Head, /PRC_HANDOFF UNVERIFIED/u);
  assert.match(scenario.evidence.h1Head, /PLAN_SHA_MISMATCH/u);
  assert.equal(scenario.evidence.reviewerCount, 1);
  assert.equal(scenario.evidence.cardPublishImplemented, false);
  assert.deepEqual(scenario.evidence.cardEvents, []);
});

test("native-handoff-freshness: the same flow is a separate all-set case", { timeout: 900000 }, () => {
  const scenario = runCase("native-handoff-freshness");
  save("native-handoff-freshness", scenario);
  assert.equal(scenario.state, "handoff-approved-then-stale");
  assert.equal(scenario.evidence.reviewerCount, 1);
});

test("native-r83-replay: the owner 1 limit holds when a draft says 83", { timeout: 900000 }, () => {
  const scenario = runCase("native-r83-replay");
  save("native-r83-replay", scenario);
  assert.equal(scenario.state, "r83-limit-held");
  assert.equal(scenario.evidence.firstB, 1);
  assert.equal(scenario.evidence.firstLimitSource, "owner-request");
  assert.equal(scenario.evidence.secondB, 1);
  assert.equal(scenario.evidence.newReviewerTaskIds.length, 0);
  assert.match(scenario.evidence.denial, /^PRC_BUDGET_EXHAUSTED/u);
});

test("native-r84-prehash-denied: the historical answer leaves the manual and auto counters at zero", { timeout: 900000 }, () => {
  const scenario = runCase("native-r84-prehash-denied");
  save("native-r84-prehash-denied", scenario);
  assert.equal(scenario.state, "prehash-zero");
  assert.equal(scenario.evidence.autoUsed, 1);
  assert.equal(scenario.evidence.manualUsed, 0);
  assert.equal(scenario.evidence.usedOwnerEventIds.length, 0);
  assert.equal(scenario.evidence.reviewerCounts.historical, scenario.evidence.reviewerCounts.first);
  assert.equal(scenario.evidence.questionStatus, "open");
  assert.ok(scenario.evidence.oldAnswer.eventId);
  assert.equal(scenario.evidence.autoAdded, 0);
  assert.equal(scenario.evidence.prehashDenial.reason, "RESUME_HASH_NOT_BOUND");
  assert.match(scenario.evidence.denial, /RESUME_HASH_NOT_BOUND/u);
});

test("native-r84-intent-denied: a no answer and a quoted yes authorize nothing", { timeout: 900000 }, () => {
  const scenario = runCase("native-r84-intent-denied");
  save("native-r84-intent-denied", scenario);
  assert.equal(scenario.state, "intent-and-quote-denied");
  assert.equal(scenario.evidence.noRun.manualUsed, 0);
  assert.equal(scenario.evidence.quotedRun.manualUsed, 0);
  assert.equal(scenario.evidence.noRun.reviewers.length, scenario.evidence.firstReviewers.length);
  assert.equal(scenario.evidence.quotedRun.reviewers.length, scenario.evidence.firstReviewers.length);
});

test("native-r84-hash-bound-once: two processes consume one answer once and a manual rejection stops auto", { timeout: 900000 }, () => {
  const scenario = runCase("native-r84-hash-bound-once");
  save("native-r84-hash-bound-once", scenario);
  assert.equal(scenario.state, "manual-once-then-stopped");
  assert.equal(scenario.evidence.newReviewerIds.length, 1);
  assert.equal(scenario.evidence.manualUsed, 1);
  assert.equal(scenario.evidence.autoUsed, 1);
  assert.match(scenario.evidence.afterDenial, /^PRC_MANUAL_/u);
});

test("native-recovery: a second process keeps the stopped ledger and adds no child", { timeout: 900000 }, () => {
  const scenario = runCase("native-recovery");
  save("native-recovery", scenario);
  assert.equal(scenario.state, "restart-kept-stopped");
  assert.equal(scenario.evidence.newReviewerIds.length, 0);
  assert.equal(scenario.evidence.autoUsed, 1);
});
