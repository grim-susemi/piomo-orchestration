import test from "node:test";
import assert from "node:assert/strict";
import { staticState, verdictOf } from "../probe.mjs";
import { targetsFor } from "../patch.mjs";

test("staticState tells the per-update hash from the deferred one", () => {
  for (const version of ["2026.10.19", "2026.10.19-2"]) {
    for (const target of targetsFor(version)) {
      assert.equal(staticState(target.edits[0].anchor), "hashes", `${version} ${target.file}`);
      assert.equal(staticState(target.edits[0].replacement), "no-hash", `${version} ${target.file}`);
    }
  }
  assert.equal(staticState("class Other {}"), "absent");
});

test("verdictOf: any hashing copy or a slow capture is defect-present", () => {
  const clean = { a: "no-hash", b: "no-hash" };
  const fast = { msPerCall: 0.01, semanticsOk: true };
  assert.equal(verdictOf({ a: "hashes", b: "no-hash" }, fast), "defect-present");
  assert.equal(verdictOf(clean, { msPerCall: 5, semanticsOk: true }), "defect-present");
  assert.equal(verdictOf(clean, fast), "defect-absent");
  assert.equal(verdictOf(clean, null), "defect-absent");
  assert.equal(verdictOf(clean, { msPerCall: 0.01, semanticsOk: false }), "needs-review");
  assert.equal(verdictOf({ a: "absent", b: "no-hash" }, fast), "needs-review");
});
