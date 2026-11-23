import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundaryReport } from "./helpers/host.mjs";

test("boundary-attested: the stock gate is unique and has no budget field", () => {
  const report = boundaryReport();
  assert.equal(report.state, "managed-delta");
  assert.equal(report.caseId, "boundary-attested");
  assert.equal(report.packageSha256, "719c1eac06b34bac708506fd62b6d4614b8ceb25c39c3fe10f9b2e03547d9eb7");
  assert.equal(report.packageVersion, "5.1.69");
  assert.equal(report.anchors.gateDefinitionCount, 1);
  assert.equal(report.anchors.callSiteCount, 1);
  assert.equal(report.anchors.spawnPolicyHasGate, true);
  assert.equal(report.anchors.stateProviderCount, 1);
  assert.equal(report.anchors.budgetMentions, 0);
  assert.equal(report.anchors.gateSourceStart, 144658);
  assert.equal(report.anchors.spawnPolicyStart, 313804);
  assert.equal(report.decisions.length, 2);
  assert.ok(report.decisions.every((entry) => entry.decision.kind === "allow"));
  assert.equal(report.r83.limit, 83);
  assert.equal(report.r83.child, "st_01a203eb");
  assert.equal(report.r83.sha, "ab92ce5d927336a74dfdddd4c404db8e08ae7f378fcf0dd59e07245fe02ec5d1");
  assert.equal(report.recordedChildCount, 1);
  assert.deepEqual(report.childReceiptIds, ["st_01a203eb"]);
  assert.equal(report.launchesFromHost, 0);
  assert.equal(report.loadedInProcess, false);
  assert.equal(report.evaluatedInVm, true);
  assert.equal(report.candidateEdits, 0);
});

test("boundary-attested: the gate still denies a missing request or plan artifact", () => {
  const report = boundaryReport();
  assert.equal(report.denied.request.kind, "deny");
  assert.equal(report.denied.artifact.kind, "deny");
});

test("boundary-unobserved: a missing host path is blocked", () => {
  const report = boundaryReport({ paths: { host: "C:/nonexistent/omo-task.js" } });
  assert.equal(report.state, "blocked");
  assert.match(report.reason, /missing:host/);
  assert.equal(report.candidateEdits, 0);
});

test("boundary-unobserved: a runtime hash mismatch is blocked", () => {
  const report = boundaryReport({ expectedHostSha: "0".repeat(64) });
  assert.equal(report.state, "blocked");
  assert.match(report.reason, /runtime-mismatch/);
  assert.equal(report.candidateEdits, 0);
});

test("boundary-unobserved: a fake host without the real gate is blocked", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "plan-review-convergence-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = join(root, "omo-task.js");
  await writeFile(fake, "function Ca(){return {kind:'allow'}}", "utf8");
  const report = boundaryReport({ paths: { host: fake } });
  assert.equal(report.state, "blocked");
  assert.match(report.reason, /gate-boundary|policy/);
  assert.equal(report.candidateEdits, 0);
});
