import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROBE = join(dirname(fileURLToPath(import.meta.url)), "..", "probe.mjs");
const OWNER_SHA = "2607995b00b0236849062f8723d27c5d7163f5bb438a063cbe379dd9b8f5a051";

function run(args, { quiet = false } = {}) {
  return spawnSync(process.execPath, [PROBE, ...args], quiet
    ? { stdio: "ignore", timeout: 600000 }
    : { encoding: "utf8", timeout: 600000 });
}

async function outPath(t) {
  const root = await mkdtemp(join(tmpdir(), "plan-review-convergence-probe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "probe.json");
}

test("probe-forged-green: forged records, owner answers and APPROVED prompts are rejected", { timeout: 300000 }, async (t) => {
  const out = await outPath(t);
  const result = run(["--case", "probe-forged-records", "--variant", "candidate", "--out", out], { quiet: true });
  assert.equal(result.status, 0, "forged-records probe failed");
  const report = JSON.parse(await readFile(out, "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.scenarios.length, 1);
  const scenario = report.scenarios[0];
  assert.equal(scenario.caseId, "probe-forged-records");
  assert.equal(scenario.state, "forged-rejected");
  assert.equal(scenario.evidence.wrongRole, "REVIEWER_ROLE_MISMATCH");
  assert.equal(scenario.evidence.wrongChild, "CHILD_SESSION_IS_PARENT");
  assert.equal(scenario.evidence.notTerminal, "TASK_NOT_TERMINAL");
  assert.equal(scenario.evidence.wrongPlan, "PLAN_PATH_MISMATCH");
  assert.equal(scenario.evidence.wrongSnapshot, "SNAPSHOT_SHA_MISMATCH");
  assert.equal(scenario.evidence.forgedOwnerAnswers, 0);
  assert.equal(scenario.evidence.settlementForged, 0);
  assert.equal(scenario.evidence.forgedBind, "QUESTION_NOT_PUBLISHED");
  assert.equal(report.ownerTranscript.sha256, OWNER_SHA);

  const handoffOut = await outPath(t);
  const handoff = run(["--case", "probe-forged-handoff", "--variant", "candidate", "--out", handoffOut], { quiet: true });
  assert.equal(handoff.status, 0, "forged-handoff probe failed");
  const handoffReport = JSON.parse(await readFile(handoffOut, "utf8"));
  const handoffScenario = handoffReport.scenarios[0];
  assert.equal(handoffScenario.state, "forged-handoff-rejected");
  assert.equal(handoffScenario.evidence.status, "UNVERIFIED");
  assert.equal(handoffScenario.evidence.delivered, true);
  assert.match(handoffScenario.evidence.promptHead, /PRC_HANDOFF UNVERIFIED/u);
  assert.match(handoffScenario.evidence.promptHead, /PRC_HANDOFF APPROVED receipt=st_forged/u);
});

test("probe-real-entry: the actual host spawns a plan-reviewer child and binds its receipt", { timeout: 300000 }, async (t) => {
  const out = await outPath(t);
  const result = run(["--case", "native-single-review", "--variant", "candidate", "--out", out], { quiet: true });
  assert.equal(result.status, 0, "native-single-review probe failed");
  const report = JSON.parse(await readFile(out, "utf8"));
  const scenario = report.scenarios[0];
  assert.equal(scenario.state, "receipt-approved");
  assert.equal(scenario.realChild, true);
  assert.equal(scenario.launchesFromHost, 1);
  assert.equal(scenario.reviewerTaskIds.length, 1);
  assert.match(scenario.reviewerTaskIds[0], /^st_[0-9a-f]+$/);
  assert.equal(scenario.evidence.receiptStatus, "APPROVED");
  assert.equal(scenario.evidence.receiptReason, null);
  assert.equal(scenario.evidence.reviewedBodySha256, scenario.evidence.snapshotSha256);
  assert.ok(scenario.evidence.reviewerChildSessionId);
  assert.ok(scenario.evidence.childReadEventId);
  assert.ok(scenario.evidence.childReadResultEventId);
  assert.equal(scenario.evidence.firstRequestSource, "owner-session");
  assert.equal(scenario.evidence.denial, "PRC_ALREADY_APPROVED");
  assert.equal(report.ok, true);
  assert.equal(report.boundary, "managed-delta");
  assert.equal(report.boundaryDetail.anchors.gateDefinitionCount, 1);
  assert.equal(report.boundaryDetail.anchors.callSiteCount, 1);
});

test("boundary-stock-replay: isolated stock admits the second review, candidate denies it", { timeout: 600000 }, async (t) => {
  const stockOut = await outPath(t);
  const stockResult = run(["--case", "stock-second-review", "--variant", "stock", "--out", stockOut], { quiet: true });
  assert.equal(stockResult.status, 0, "stock-second-review probe failed");
  const stockReport = JSON.parse(await readFile(stockOut, "utf8"));
  assert.equal(stockReport.ok, true);
  assert.equal(stockReport.scenarios[0].evidence.stockReviewerTaskIds.length, 2);

  const candidateOut = await outPath(t);
  const candidateResult = run(["--case", "candidate-second-review", "--variant", "candidate", "--out", candidateOut], { quiet: true });
  assert.equal(candidateResult.status, 0, "candidate-second-review probe failed");
  const candidateReport = JSON.parse(await readFile(candidateOut, "utf8"));
  assert.equal(candidateReport.ok, true);
  const candidate = candidateReport.scenarios[0];
  assert.equal(candidate.evidence.candidateReviewerTaskIds.length, 1);
  assert.ok(candidate.evidence.candidateDenial);
  assert.equal(candidateReport.boundaryDetail.anchors.gateDefinitionCount, 1);
  assert.equal(candidateReport.boundaryDetail.anchors.callSiteCount, 1);
});

test("probe rejects an unknown case or variant", () => {
  const badCase = run(["--case", "does-not-exist"]);
  assert.equal(badCase.status, 2);
  assert.match(badCase.stderr, /PROBE_INVALID/);
  const badVariant = run(["--variant", "nope"]);
  assert.equal(badVariant.status, 2);
  assert.match(badVariant.stderr, /PROBE_INVALID/);
});
