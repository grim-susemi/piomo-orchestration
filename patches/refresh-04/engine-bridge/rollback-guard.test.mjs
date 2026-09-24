#!/usr/bin/env node
/**
 * rollback-guard test: `--rollback` must validate EVERY manifest output (path, bytes,
 * sha256) and the manifest itself BEFORE deleting anything.
 *
 * Red scenario: the LAST manifest output is drifted, so any interleaved
 * validate-then-delete loop would already have removed the earlier outputs before it
 * reaches the drifted file (leaving a partial tree with a live manifest). The test
 * requires the refusal (exit 2, ROLLBACK_DRIFT) and asserts that every file - earlier
 * outputs, the drifted file and the manifest - is still present; it then restores the
 * drift from captured bytes in `finally`.
 *
 * Green scenario: with an intact tree, `--rollback` removes all outputs + manifest,
 * and a rebuild reproduces byte-identical outputs and manifest.
 *
 * Run after the builder: node build-transform.mjs && node rollback-guard.test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, loadStaged, sha256 } from "./lib.mjs";

const LANE_DIR = dirname(fileURLToPath(import.meta.url));
const STAGE_ROOT = resolve(LANE_DIR, "..", "..", "..");
const BUILD = join(LANE_DIR, "build-transform.mjs");

function runBuild(args) {
  return spawnSync(process.execPath, [BUILD, ...args], { cwd: STAGE_ROOT, encoding: "utf8" });
}

async function main() {
  const { pins, manifest, outRoot } = loadStaged(STAGE_ROOT, LANE_DIR);
  const outputs = manifest.outputs ?? [];
  assert(outputs.length >= 2, "rollback-guard needs at least two outputs to place the drift last");
  const manifestPath = join(outRoot, pins.manifestRel);
  const first = outputs[0];
  const last = outputs[outputs.length - 1];

  const captured = new Map();
  for (const output of outputs) captured.set(output.relpath, readFileSync(join(outRoot, output.relpath)));
  const manifestShaBefore = sha256(readFileSync(manifestPath));

  const redScenarios = [
    { name: "appended-bytes", drift: (buf) => Buffer.concat([buf, Buffer.from("\n// rollback-guard drift\n")]) },
    { name: "truncated-bytes", drift: (buf) => buf.subarray(0, buf.length - 1) },
  ];
  const redResults = [];
  for (const scenario of redScenarios) {
    try {
      // ---- red scenario: drift the LAST output, earlier outputs must survive the refusal
      writeFileSync(join(outRoot, last.relpath), scenario.drift(captured.get(last.relpath)));
      assert(sha256(readFileSync(join(outRoot, last.relpath))) !== last.sha256, `${scenario.name}: drift fixture did not change the last output sha`);

      const red = runBuild(["--rollback"]);
      assert(red.status === 2, `${scenario.name}: red rollback exit ${red.status}, expected 2; stderr: ${red.stderr}`);
      assert(String(red.stderr).includes("ROLLBACK_DRIFT"), `${scenario.name}: red rollback stderr missing ROLLBACK_DRIFT: ${red.stderr}`);

      const problems = [];
      let survivors = 0;
      for (const output of outputs) {
        const path = join(outRoot, output.relpath);
        if (!existsSync(path)) {
          problems.push(`deleted ${output.relpath}`);
          continue;
        }
        if (output.relpath === last.relpath) continue; // drifted file is expected to exist with drifted bytes
        if (sha256(readFileSync(path)) !== output.sha256) problems.push(`altered ${output.relpath}`);
        survivors += 1;
      }
      assert(existsSync(join(outRoot, last.relpath)), `${scenario.name}: refused rollback must not delete the drifted file`);
      assert(existsSync(manifestPath), `${scenario.name}: refused rollback must keep the manifest`);
      assert(
        !problems.some((problem) => problem.startsWith("deleted")),
        `${scenario.name}: red rollback deleted files before detecting later drift: ${JSON.stringify(problems)} (partial tree left behind)`,
      );
      assert(problems.length === 0, `${scenario.name}: red rollback left a partial tree: ${JSON.stringify(problems)}`);
      assert(survivors === outputs.length - 1, `${scenario.name}: red rollback survivors ${survivors}; expected ${outputs.length - 1} untouched earlier outputs`);
      assert(existsSync(join(outRoot, first.relpath)), `${scenario.name}: red rollback deleted the earliest output ${first.relpath} before detecting later drift`);
      redResults.push({ scenario: scenario.name, refused: true, survivors });
    } finally {
      for (const output of outputs) writeFileSync(join(outRoot, output.relpath), captured.get(output.relpath));
    }
  }

  // ---- restored state must be fully consistent again
  for (const output of outputs) {
    const buf = readFileSync(join(outRoot, output.relpath));
    assert(buf.equals(captured.get(output.relpath)) && sha256(buf) === output.sha256, `restore failed for ${output.relpath}`);
  }
  const afterRestore = runBuild(["--check"]);
  assert(afterRestore.status === 0, `--check after restore exit ${afterRestore.status}: ${afterRestore.stderr}`);

  // ---- green scenario: rollback everything, then rebuild byte-identically
  const green = runBuild(["--rollback"]);
  assert(green.status === 0, `green rollback exit ${green.status}, expected 0; stderr: ${green.stderr}`);
  const greenRemoved = JSON.parse(green.stdout).removed;
  assert(greenRemoved.length === outputs.length + 1, `green rollback removed ${greenRemoved.length}, expected ${outputs.length + 1}`);
  for (const output of outputs) assert(!existsSync(join(outRoot, output.relpath)), `green rollback left ${output.relpath}`);
  assert(!existsSync(manifestPath), "green rollback left the manifest");

  const rebuild = runBuild([]);
  assert(rebuild.status === 0, `rebuild exit ${rebuild.status}, expected 0; stderr: ${rebuild.stderr}`);
  for (const output of outputs) {
    const buf = readFileSync(join(outRoot, output.relpath));
    assert(buf.equals(captured.get(output.relpath)), `rebuilt ${output.relpath} is not byte-identical`);
    assert(sha256(buf) === output.sha256, `rebuilt ${output.relpath} sha drift`);
  }
  assert(sha256(readFileSync(manifestPath)) === manifestShaBefore, "rebuilt manifest is not byte-identical");

  console.log(
    JSON.stringify({
      test: "rollback-guard",
      redResults,
      driftedOutput: last.relpath,
      greenRollbackRemoved: greenRemoved.length,
      rebuilt: outputs.length,
      manifestSha256: manifestShaBefore,
      status: "ok",
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(`FAIL rollback-guard: ${error?.stack ?? error}`);
  process.exit(1);
}
