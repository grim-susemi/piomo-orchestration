import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareLedger, makeRows, parseLedger } from "../../check-patches.mjs";
import { classifyMaintenance } from "../maintenance.mjs";

const LEDGER = fileURLToPath(new URL("../../PATCHES.md", import.meta.url));

test("candidate-and-retirement: a complete candidate pass is kept, official conformance recommends retirement", () => {
  assert.equal(
    classifyMaintenance({
      stockConforms: false,
      candidatePass: true,
      anchorsMatch: true,
      evidenceComplete: true,
    }),
    "candidate-pass",
  );
  assert.equal(
    classifyMaintenance({
      stockConforms: true,
      candidatePass: true,
      anchorsMatch: true,
      evidenceComplete: true,
    }),
    "official-conforms-retire-candidate",
  );
});

test("maintenance-drift: a missing anchor, target hash, or evidence is needs-review", () => {
  for (const input of [
    { stockConforms: false, candidatePass: true, anchorsMatch: false, evidenceComplete: true },
    { stockConforms: false, candidatePass: true, anchorsMatch: true, evidenceComplete: false },
    { stockConforms: false, candidatePass: false, anchorsMatch: true, evidenceComplete: true },
    { stockConforms: true, candidatePass: true, anchorsMatch: true, evidenceComplete: false },
  ]) {
    assert.equal(classifyMaintenance(input), "needs-review");
  }
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
