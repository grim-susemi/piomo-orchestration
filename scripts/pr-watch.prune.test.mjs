import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "pr-watch.mjs"), "utf8");

// Extract the const PRS = [ ... ]; block without executing the script
// (executing would invoke gh/network; this test stays deterministic).
function extractPrs(src) {
  const block = src.match(/const PRS\s*=\s*\[(.*?)\];/s);
  assert.ok(block, "PRS block not found in pr-watch.mjs");
  const pairs = [...block[1].matchAll(/\[\s*"([^"]+)"\s*,\s*(\d+)\s*\]/g)];
  return pairs.map((m) => `${m[1]}#${m[2]}`);
}

const EXPECTED_ORDERED = [
  "code-yeongyu/senpi#899",
  "code-yeongyu/senpi#912",
  "code-yeongyu/senpi#913",
  "code-yeongyu/senpi#927",
  "code-yeongyu/oh-my-openagent#6740",
  "code-yeongyu/oh-my-openagent#7268",
];

const MUST_BE_ABSENT = [
  "code-yeongyu/oh-my-openagent#6533",
  "code-yeongyu/oh-my-openagent#6848",
  "code-yeongyu/oh-my-openagent#6850",
  "code-yeongyu/oh-my-openagent#6973",
  "code-yeongyu/oh-my-openagent#7082",
  "code-yeongyu/oh-my-openagent#7102",
  "code-yeongyu/oh-my-openagent#7231",
];

test("active polling set is exactly the six approved OPEN PRs", () => {
  const actual = extractPrs(SRC);
  assert.equal(actual.length, 6, `expected 6 active PRs, got ${actual.length}: ${actual.join(", ")}`);
  assert.deepEqual(actual, EXPECTED_ORDERED);
  for (const pr of MUST_BE_ABSENT) {
    assert.ok(!actual.includes(pr), `${pr} must not be actively polled`);
  }
});

test("owner comment sweep covers the five owner PRs, not the old nine", () => {
  assert.ok(
    SRC.includes("slice(0, 5)"),
    "maintainer comment sweep must target the five owner PRs via slice(0, 5)"
  );
  assert.ok(
    !SRC.includes("slice(0, 9)"),
    "old nine-owner slice must be gone"
  );
});

test("header usage reflects the pruned active count", () => {
  assert.ok(!SRC.includes("PR 13건"), "old fixed-13 header must be gone");
  assert.ok(SRC.includes("PR 6건"), "header must state the six active PRs");
});
