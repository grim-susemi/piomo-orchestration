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

import { filesFor } from "../patch.mjs";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));
const PROBE = join(TOOL_DIR, "probe.mjs");
const PATCH = join(TOOL_DIR, "patch.mjs");
const GLOBAL_SENPI = "C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi";
const SENPI_ROOT = process.env.SENPI_ROOT ?? GLOBAL_SENPI;
const SENPI_19_2_ROOT = process.env.SENPI_19_2_ROOT ?? GLOBAL_SENPI;

const VERSION_SOURCES = {
  "2026.10.19": SENPI_ROOT,
  "2026.10.19-2": SENPI_19_2_ROOT,
};

function installed(version) {
  const root = VERSION_SOURCES[version];
  if (!root || !existsSync(join(root, "package.json"))) return false;
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version === version;
}

const VERSIONS = Object.keys(VERSION_SOURCES).filter(installed);

function makeRoot(version) {
  const root = mkdtempSync(join(tmpdir(), "senpi-freeze-fix-probe-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "senpi", version }));
  for (const file of filesFor(version)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    // Fixture must be pristine: prefer the managed .freeze-fix.bak (the pre-patch bytes) over the live, possibly patched file.
    const bak = join(VERSION_SOURCES[version], `${file}.freeze-fix.bak`);
    copyFileSync(existsSync(bak) ? bak : join(VERSION_SOURCES[version], file), target);
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

for (const version of VERSIONS) {
  test(`probe reports both defects on a pristine ${version} tree`, () => {
    const root = makeRoot(version);
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

  test(`probe reports the defect absent after apply [${version}]`, () => {
    const root = makeRoot(version);
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
      assert.equal(fromBackups.overlays, filesFor(version).length);
      assert.equal(fromBackups.urlExtraction, "present");
      assert.equal(fromBackups.syncWalkerFallback, "present");
      assert.equal(fromBackups.verdict, "defect-present");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

// Keep the file list honest: a version that targets anything but four anchored files fails here.
test("each version targets four anchored files", () => {
  for (const version of VERSIONS) assert.equal(filesFor(version).length, 4);
});
