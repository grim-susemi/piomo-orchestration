import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROBE = join(dirname(fileURLToPath(import.meta.url)), "..", "probe.mjs");

function run(args) {
  return spawnSync(process.execPath, [PROBE, ...args], { encoding: "utf8", timeout: 120000 });
}

async function outPath(t) {
  const root = await mkdtemp(join(tmpdir(), "plan-review-convergence-probe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, "probe.json");
}

test("probe-forged-green: forged input is rejected and cannot become green", async (t) => {
  const out = await outPath(t);
  const result = run(["--case", "probe-forged-green", "--out", out]);
  assert.equal(result.status, 0);
  const report = JSON.parse(await readFile(out, "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.scenarios.length, 1);
  assert.equal(report.scenarios[0].state, "rejected");
  assert.equal(report.scenarios[0].expectedState, "rejected");
  assert.equal(report.scenarios[0].launchesFromHost, 0);
  assert.deepEqual(report.scenarios[0].childReceiptIds, []);
});

test("probe-real-entry: the actual host spawns a plan-reviewer child and returns [OKAY]", async (t) => {
  const out = await outPath(t);
  const result = run(["--case", "probe-real-entry", "--out", out]);
  assert.equal(result.status, 0);
  const report = JSON.parse(await readFile(out, "utf8"));
  const scenario = report.scenarios[0];
  assert.equal(scenario.state, "verified");
  assert.equal(scenario.expectedState, "verified");
  assert.equal(scenario.loadedInProcess, true);
  assert.equal(scenario.launchesFromHost, 1);
  assert.equal(scenario.childReceiptIds.length, 1);
  assert.match(scenario.childReceiptIds[0], /^st_[0-9a-f]+$/);
  assert.match(scenario.finalResponse, /^\[OKAY\]/);
  assert.ok(scenario.childSessionId);
  assert.equal(scenario.actual.independentHome, true);
  assert.equal(report.ok, true);
});

test("probe rejects an unknown case or variant", () => {
  const badCase = run(["--case", "does-not-exist"]);
  assert.equal(badCase.status, 2);
  assert.match(badCase.stderr, /PROBE_INVALID/);
  const badVariant = run(["--variant", "nope"]);
  assert.equal(badVariant.status, 2);
  assert.match(badVariant.stderr, /PROBE_INVALID/);
});

test("probe all writes both scenarios and keeps the expected states", async (t) => {
  const out = await outPath(t);
  const result = run(["--case", "all", "--out", out]);
  assert.equal(result.status, 0);
  const report = JSON.parse(await readFile(out, "utf8"));
  assert.equal(report.scenarios.length, 2);
  assert.deepEqual(report.scenarios.map((scenario) => scenario.caseId), [
    "probe-real-entry",
    "probe-forged-green",
  ]);
  assert.equal(report.scenarios[0].state, "verified");
  assert.equal(report.scenarios[1].state, "rejected");
  assert.equal(report.ok, true);
});
