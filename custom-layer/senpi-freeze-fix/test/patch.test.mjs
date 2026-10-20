import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

import { buildTargets, countOccurrences } from "../patch.mjs";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));
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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeRoot(version) {
  const root = mkdtempSync(join(tmpdir(), "senpi-freeze-fix-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "senpi", version }));
  for (const file of FILES) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(SENPI_ROOT, file), target);
  }
  return root;
}

function hashes(root) {
  return Object.fromEntries(
    FILES.map((file) => [file, sha256File(join(root, file))])
  );
}

function artifacts(root) {
  return FILES.flatMap((file) => [
    `${file}.freeze-fix.bak`,
    `${file}.freeze-fix.new`,
  ]).filter((file) => existsSync(join(root, file)));
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [PATCH, "--senpi-root", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, SENPI_FREEZE_FIX_TEST_FAIL_RENAME: "", ...env },
  });
}

function payload(result, prefix) {
  const match = new RegExp(`(?:^|\\n)${prefix} (\\{.*\\})\\s*$`).exec(result.stdout);
  assert.ok(match, `missing ${prefix} line in: ${result.stdout}${result.stderr}`);
  return JSON.parse(match[1]);
}

test("checks are read-only on a supported tree", { skip: !installed() }, () => {
  const root = makeRoot("2026.10.19");
  try {
    const before = hashes(root);
    const result = run(root, ["--check"]);
    assert.equal(result.status, 0);
    const check = payload(result, "CHECK");
    assert.equal(check.supported, true);
    for (const file of FILES) assert.equal(check.files[file].state, "pristine");
    assert.deepEqual(hashes(root), before);
    assert.deepEqual(artifacts(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "an unsupported version is check-only and apply writes nothing",
  { skip: !installed() },
  () => {
    const root = makeRoot("0.0.0");
    try {
      const before = hashes(root);
      const checkResult = run(root, ["--check"]);
      assert.equal(checkResult.status, 0);
      const check = payload(checkResult, "CHECK");
      assert.equal(check.version, "unsupported");
      for (const file of FILES) {
        assert.equal(check.files[file].state, "unknown");
        assert.ok(check.files[file].anchorsFound);
      }

      const applyResult = run(root, ["--apply"]);
      assert.equal(applyResult.status, 2);
      assert.equal(payload(applyResult, "ERROR").reason, "unsupported-version");
      assert.deepEqual(hashes(root), before);
      assert.deepEqual(artifacts(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "an unknown file stops apply before any write",
  { skip: !installed() },
  () => {
    const root = makeRoot("2026.10.19");
    try {
      const target = join(root, FILES[0]);
      writeFileSync(target, `${readFileSync(target, "utf8")}\n// tampered\n`);
      const before = hashes(root);
      const result = run(root, ["--apply"]);
      assert.equal(result.status, 2);
      assert.equal(payload(result, "ERROR").reason, "unknown-file");
      assert.deepEqual(hashes(root), before);
      assert.deepEqual(artifacts(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "an injected rename failure rolls every file back",
  { skip: !installed() },
  () => {
    const root = makeRoot("2026.10.19");
    try {
      const before = hashes(root);
      const result = run(root, ["--apply"], {
        SENPI_FREEZE_FIX_TEST_FAIL_RENAME: "3",
      });
      assert.equal(result.status, 3);
      const failure = payload(result, "APPLY");
      assert.equal(failure.status, "rolled-back");
      assert.deepEqual(hashes(root), before);
      assert.deepEqual(
        artifacts(root).filter((file) => file.endsWith(".new")),
        []
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test("a second apply is a no-op", { skip: !installed() }, () => {
  const root = makeRoot("2026.10.19");
  try {
    const before = hashes(root);
    const first = run(root, ["--apply"]);
    assert.equal(first.status, 0);
    assert.equal(payload(first, "APPLY").status, "applied");
    const afterFirst = hashes(root);
    for (const file of FILES) assert.notEqual(afterFirst[file], before[file]);

    const second = run(root, ["--apply"]);
    assert.equal(second.status, 0);
    assert.equal(payload(second, "APPLY").status, "no-op");
    assert.deepEqual(hashes(root), afterFirst);

    const check = payload(run(root, ["--check"]), "CHECK");
    for (const file of FILES) assert.equal(check.files[file].state, "patched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remove restores the pristine files", { skip: !installed() }, () => {
  const root = makeRoot("2026.10.19");
  try {
    const before = hashes(root);
    assert.equal(run(root, ["--apply"]).status, 0);
    const removed = run(root, ["--remove"]);
    assert.equal(removed.status, 0);
    assert.equal(payload(removed, "REMOVE").status, "removed");
    assert.deepEqual(hashes(root), before);
    const check = payload(run(root, ["--check"]), "CHECK");
    for (const file of FILES) assert.equal(check.files[file].state, "pristine");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every anchor occurs exactly once in the pristine copies", { skip: !installed() }, async () => {
  const targets = await buildTargets();
  for (const target of targets) {
    const text = readFileSync(join(SENPI_ROOT, target.file), "utf8");
    for (const edit of target.edits) {
      assert.equal(
        countOccurrences(text, edit.anchor),
        1,
        `${target.file} ${edit.name}: anchor must occur once`
      );
      assert.equal(
        countOccurrences(text, edit.replacement),
        0,
        `${target.file} ${edit.name}: pristine text must not contain the patch`
      );
    }
  }
});

test("the four targeted files are the four baselines", { skip: !installed() }, () => {
  const baselines = JSON.parse(
    readFileSync(join(TOOL_DIR, "baselines.json"), "utf8")
  );
  const entry = baselines.versions["2026.10.19"];
  assert.deepEqual(Object.keys(entry.files).sort(), [...FILES].sort());
  for (const file of FILES) {
    assert.equal(sha256File(join(SENPI_ROOT, file)), entry.files[file].pristine);
  }
});

