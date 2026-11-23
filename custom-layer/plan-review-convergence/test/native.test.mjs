import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { runHostProbe } from "./helpers/host.mjs";

function save(name, report) {
  writeFileSync(
    `.omo/evidence/ulw-plan-review-convergence/${name}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

test("native-r83-replay: the candidate caps the review at one round even with the draft limit 83", { timeout: 180000 }, async () => {
  const report = await runHostProbe({ variant: "candidate", explicitLimit: 1, rounds: 2 });
  save("task-8-native", report);
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

test("native-normal: one normal review child and no denial", { timeout: 180000 }, async () => {
  const report = await runHostProbe({ variant: "candidate", explicitLimit: 5, rounds: 1 });
  save("task-8-native-normal", report);
  assert.equal(report.taskRecords.length, 1);
  assert.equal(report.launchesFromHost, 1);
  assert.equal(report.budgetState.B, 5);
  assert.equal(report.budgetState.U, 1);
  assert.deepEqual(report.denials, []);
  assert.equal(report.state, "verified");
});

test("native-auto-progress-allows: two children only when progress and budget allow", { timeout: 180000 }, async () => {
  const report = await runHostProbe({
    variant: "candidate",
    explicitLimit: 2,
    progressAllow: true,
    rounds: 2,
  });
  save("task-8-native-auto-allows", report);
  assert.equal(report.taskRecords.length, 2);
  assert.equal(report.budgetState.B, 2);
  assert.equal(report.budgetState.U, 2);
  assert.equal(report.budgetState.autoUsed, 2);
  assert.deepEqual(report.denials, []);
});

test("native-auto-sha-only-denies: a second round without progress is denied", { timeout: 180000 }, async () => {
  const report = await runHostProbe({
    variant: "candidate",
    explicitLimit: 2,
    progressAllow: false,
    rounds: 2,
  });
  save("task-8-native-auto-denies", report);
  assert.equal(report.taskRecords.length, 1);
  assert.equal(report.budgetState.B, 2);
  assert.equal(report.budgetState.U, 1);
  assert.ok(report.denials.includes("PRC_NO_PROGRESS"), JSON.stringify(report.denials));
});

test("native-recovery: a stopped ledger admits no child", { timeout: 180000 }, async () => {
  const report = await runHostProbe({
    variant: "candidate",
    explicitLimit: 5,
    stopState: "REJECT",
    rounds: 1,
  });
  save("task-8-native-recovery", report);
  assert.equal(report.taskRecords.length, 0);
  assert.equal(report.budgetState.status, "stopped");
  assert.ok(report.denials.includes("PRC_STOPPED"), JSON.stringify(report.denials));
});

test("native-r84-prehash-denied: a pre-freeze answer cannot launch", { timeout: 180000 }, async () => {
  const report = await runHostProbe({
    variant: "candidate",
    explicitLimit: 5,
    manual: { prehash: true },
    rounds: 1,
  });
  save("task-8-native-r84-prehash", report);
  assert.equal(report.taskRecords.length, 0);
  assert.equal(report.budgetState.manualUsed, 0);
  assert.ok(report.denials.includes("PRC_RESUME_HASH_NOT_BOUND"), JSON.stringify(report.denials));
});

test("native-r84-hash-bound-once: one hash-bound manual launch, replay denied", { timeout: 180000 }, async () => {
  const report = await runHostProbe({
    variant: "candidate",
    explicitLimit: 5,
    manual: { reviewedSha: "a".repeat(64) },
    rounds: 2,
  });
  save("task-8-native-r84-once", report);
  assert.equal(report.taskRecords.length, 1);
  assert.equal(report.budgetState.manualUsed, 1);
  assert.equal(report.budgetState.autoUsed, 1);
  assert.equal(report.budgetState.B, 5);
  assert.ok(
    report.denials.includes("PRC_ALREADY_CONSUMED")
      || report.denials.includes("PRC_MANUAL_EXHAUSTED"),
    JSON.stringify(report.denials),
  );
});
