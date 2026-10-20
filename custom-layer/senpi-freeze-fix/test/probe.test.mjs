import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));
const PROBE = join(TOOL_DIR, "probe.mjs");
const PATCH = join(TOOL_DIR, "patch.mjs");
const SENPI_ROOT =
  process.env.SENPI_ROOT ??
  "C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi";

const FILES = [
  "dist/core/extensions/builtin/moved-path-guard/command-paths.js",
  "dist/core/tools/filesystem-policy.js",
  "dist/bundle/chunks/chunk-35M5MVUZ.js",
  "dist/bundle/chunks/session-worker.js",
];

function installed() {
  return existsSync(join(SENPI_ROOT, "package.json"));
}

function makeRoot(version) {
  const root = mkdtempSync(join(tmpdir(), "senpi-freeze-fix-probe-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "senpi", version }));
  for (const file of FILES) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(SENPI_ROOT, file), target);
  }
  return root;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [PROBE, "--senpi-root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function payload(result) {
  const match = /(?:^|\n)PROBE (\{.*\})\s*$/.exec(result.stdout);
  assert.ok(match, `missing PROBE line in: ${result.stdout}${result.stderr}`);
  return JSON.parse(match[1]);
}

test("probe reports both defects on a pristine tree", { skip: !installed() }, () => {
  const root = makeRoot("2026.10.19");
  try {
    const result = run(root, []);
    assert.equal(result.status, 0);
    const probe = payload(result);
    assert.equal(probe.urlExtraction, "present");
    assert.equal(probe.syncWalkerFallback, "present");
    assert.equal(probe.verdict, "defect-present");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("probe reports the defect absent after apply", { skip: !installed() }, () => {
  const root = makeRoot("2026.10.19");
  try {
    const applied = spawnSync(
      process.execPath,
      [PATCH, "--senpi-root", root, "--apply"],
      { encoding: "utf8", env: { ...process.env, SENPI_FREEZE_FIX_TEST_FAIL_RENAME: "" } }
    );
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);

    const result = run(root, []);
    assert.equal(result.status, 0);
    const probe = payload(result);
    assert.equal(probe.urlExtraction, "absent");
    assert.equal(probe.syncWalkerFallback, "absent");
    assert.equal(probe.verdict, "defect-absent");

    const fromBackups = payload(run(root, ["--from-backups"]));
    assert.equal(fromBackups.overlays, FILES.length);
    assert.equal(fromBackups.urlExtraction, "present");
    assert.equal(fromBackups.syncWalkerFallback, "present");
    assert.equal(fromBackups.verdict, "defect-present");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
