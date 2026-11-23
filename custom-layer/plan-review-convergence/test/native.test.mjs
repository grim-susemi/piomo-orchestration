import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { runHostProbe } from "./helpers/host.mjs";

test("native-r83-replay: the candidate caps the review at one round even with the draft limit 83", { timeout: 180000 }, async () => {
  const report = await runHostProbe({
    variant: "candidate",
    explicitLimit: 1,
    rounds: 2,
  });
  writeFileSync(
    ".omo/evidence/ulw-plan-review-convergence/task-8-native.json",
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  assert.equal(report.candidate, true);
  assert.equal(report.loadedInProcess, true);
  assert.equal(report.taskRecords.length, 1);
  assert.equal(report.launchesFromHost, 1);
  assert.equal(report.budgetState.B, 1);
  assert.equal(report.budgetState.U, 1);
  assert.equal(report.budgetState.autoUsed, 1);
  assert.equal(report.budgetState.manualUsed, 0);
  assert.ok(
    report.denials.includes("PRC_NO_PROGRESS")
      || report.denials.includes("PRC_BUDGET_EXHAUSTED"),
    JSON.stringify(report.denials),
  );
  assert.equal(report.state, "verified");
});
