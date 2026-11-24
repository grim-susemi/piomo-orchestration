import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareLedger, makeRows, parseLedger } from "../../check-patches.mjs";
import { maintenanceFromReports } from "../maintenance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..", "probe.mjs");
const LEDGER = fileURLToPath(new URL("../../PATCHES.md", import.meta.url));

let reports = null;

const CANDIDATE_CASES = [
  "native-single-review",
  "native-batch-review",
  "native-auto-progress-allows",
  "native-auto-sha-only-denies",
  "native-owner-findings",
  "native-resume",
  "native-delegation-handoff",
  "native-handoff-freshness",
  "native-r83-replay",
  "native-r84-prehash-denied",
  "native-r84-hash-bound-once",
  "native-r84-intent-denied",
  "native-recovery",
  "probe-forged-records",
  "probe-forged-handoff",
  "candidate-second-review",
  "native-ledger-deleted",
];

before(() => {
  const evidence = process.env.PRC_MAINTENANCE_EVIDENCE;
  if (evidence) {
    const stockName = ["case-stock-second-review.json", "case-boundary-stock-replay.json"]
      .find((name) => existsSync(join(evidence, name)));
    assert.ok(stockName, `stock report missing in ${evidence}`);
    const scenarios = [];
    let boundaryDetail = null;
    let ownerTranscript = null;
    for (const name of readdirSync(evidence)
      .filter((file) => /^case-.*\.json$/.test(file))
      .filter((file) => !file.startsWith("case-stock-") && file !== "case-boundary-stock-replay.json")) {
      const report = JSON.parse(readFileSync(join(evidence, name), "utf8"));
      scenarios.push(...(report.scenarios || []));
      boundaryDetail ??= report.boundaryDetail;
      ownerTranscript ??= report.ownerTranscript;
    }
    reports = {
      stock: JSON.parse(readFileSync(join(evidence, stockName), "utf8")),
      candidate: {
        schema: "plan-review-convergence/probe/v2",
        variant: "candidate",
        ok: scenarios.every((scenario) => scenario.state === scenario.expectedState),
        boundary: boundaryDetail?.state,
        boundaryDetail,
        ownerTranscript,
        scenarios,
      },
    };
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "prc-maintenance-"));
  try {
    const stockOut = join(root, "stock.json");
    const stock = spawnSync(process.execPath, [
      PROBE, "--variant", "stock", "--case", "stock-second-review", "--out", stockOut,
    ], { encoding: "utf8", timeout: 1800000, stdio: "ignore" });
    assert.equal(stock.status, 0, "stock probe failed");
    const scenarios = [];
    let boundaryDetail = null;
    let ownerTranscript = null;
    for (const caseId of CANDIDATE_CASES) {
      const candidateOut = join(root, `candidate-${caseId}.json`);
      const candidate = spawnSync(process.execPath, [
        PROBE, "--variant", "candidate", "--case", caseId, "--out", candidateOut,
      ], { encoding: "utf8", timeout: 1800000, stdio: "ignore" });
      assert.equal(candidate.status, 0, `candidate probe failed: ${caseId}`);
      const report = JSON.parse(readFileSync(candidateOut, "utf8"));
      scenarios.push(...report.scenarios);
      boundaryDetail ??= report.boundaryDetail;
      ownerTranscript ??= report.ownerTranscript;
    }
    reports = {
      stock: JSON.parse(readFileSync(stockOut, "utf8")),
      candidate: {
        schema: "plan-review-convergence/probe/v2",
        variant: "candidate",
        ok: scenarios.every((scenario) => scenario.state === scenario.expectedState),
        boundary: boundaryDetail?.state,
        boundaryDetail,
        ownerTranscript,
        scenarios,
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate-and-retirement: real reports keep the candidate, a conforming stock retires it", () => {
  const result = maintenanceFromReports({
    stockReport: reports.stock,
    candidateReport: reports.candidate,
    boundary: reports.candidate.boundaryDetail,
  });
  assert.equal(result.verdict, "candidate-pass", JSON.stringify(result.inputs));
  assert.equal(result.inputs.anchorsMatch, true);
  assert.equal(result.inputs.evidenceComplete, true);
  assert.equal(result.inputs.candidatePass, true);
  assert.equal(result.inputs.resumeFeatureImplemented, true);
  assert.equal(result.inputs.handoffFeatureImplemented, true);
  assert.equal(result.inputs.onceFeatureImplemented, true);
  assert.equal(result.inputs.findingsFeatureImplemented, true);
  assert.equal(result.inputs.budgetFeatureImplemented, true);
  assert.equal(result.inputs.stockConforms, false);
  assert.equal(result.inputs.stockLaunchCount, 2);
  assert.equal(result.inputs.ownerTranscriptSha256, reports.candidate.ownerTranscript.sha256);

  const conforming = maintenanceFromReports({
    stockReport: {
      ...reports.stock,
      scenarios: reports.stock.scenarios.map((scenario) => ({
        ...scenario,
        evidence: { ...scenario.evidence, stockReviewerTaskIds: [scenario.evidence.stockReviewerTaskIds[0]] },
      })),
    },
    candidateReport: reports.candidate,
    boundary: reports.candidate.boundaryDetail,
  });
  assert.equal(conforming.verdict, "official-conforms-retire-candidate");
});

test("maintenance-drift: missing anchors, missing evidence, or a failed candidate case is needs-review", () => {
  const brokenCandidate = {
    ...reports.candidate,
    scenarios: reports.candidate.scenarios.map((scenario) =>
      scenario.caseId === "native-resume" ? { ...scenario, state: "failed" } : scenario),
  };
  assert.equal(
    maintenanceFromReports({
      stockReport: reports.stock,
      candidateReport: brokenCandidate,
      boundary: reports.candidate.boundaryDetail,
    }).verdict,
    "needs-review",
  );
  assert.equal(
    maintenanceFromReports({
      stockReport: reports.stock,
      candidateReport: reports.candidate,
      boundary: { ...reports.candidate.boundaryDetail, state: "blocked" },
    }).verdict,
    "needs-review",
  );
  assert.equal(
    maintenanceFromReports({
      stockReport: reports.stock,
      candidateReport: { ...reports.candidate, ok: false },
      boundary: reports.candidate.boundaryDetail,
    }).verdict,
    "needs-review",
  );
});

test("ledger and checker agree on the plan-review-convergence candidate row", () => {
  const diff = compareLedger(parseLedger(readFileSync(LEDGER, "utf8")), makeRows());
  assert.equal(diff.missingFromChecker.includes("plan-review-convergence"), false);
  assert.equal(diff.missingFromLedger.includes("plan-review-convergence"), false);
  assert.equal(
    diff.stateMismatch.some((row) => row.id === "plan-review-convergence"),
    false,
  );
});
