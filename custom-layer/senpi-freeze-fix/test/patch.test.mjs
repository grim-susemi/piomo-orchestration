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

import { buildTargets, countOccurrences, filesFor } from "../patch.mjs";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));
const PATCH = join(TOOL_DIR, "patch.mjs");
const GLOBAL_SENPI = "C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi";
const SENPI_ROOT = process.env.SENPI_ROOT ?? GLOBAL_SENPI;
/** A 2026.10.19-2 tree (for example the tarball unpacked under m5/senpi-work); defaults to the global install. */
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

/** Pre-patch bytes: the managed .freeze-fix.bak when the live file is already patched. */
function pristinePath(version, file) {
  const root = VERSION_SOURCES[version];
  const bak = join(root, `${file}.freeze-fix.bak`);
  return existsSync(bak) ? bak : join(root, file);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeRoot(version, sourceVersion = version) {
  const root = mkdtempSync(join(tmpdir(), "senpi-freeze-fix-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "senpi", version }));
  for (const file of filesFor(sourceVersion)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    // Fixture must be pristine: prefer the managed .freeze-fix.bak (the pre-patch bytes) over the live, possibly patched file.
    copyFileSync(pristinePath(sourceVersion, file), target);
  }
  return root;
}

function hashes(root, version) {
  return Object.fromEntries(
    filesFor(version).map((file) => [file, sha256File(join(root, file))])
  );
}

function artifacts(root, version) {
  return filesFor(version)
    .flatMap((file) => [`${file}.freeze-fix.bak`, `${file}.freeze-fix.new`])
    .filter((file) => existsSync(join(root, file)));
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

for (const version of VERSIONS) {
  test(`checks are read-only on a supported ${version} tree`, () => {
    const root = makeRoot(version);
    try {
      const before = hashes(root, version);
      const result = run(root, ["--check"]);
      assert.equal(result.status, 0);
      const check = payload(result, "CHECK");
      assert.equal(check.version, version);
      assert.equal(check.supported, true);
      for (const file of filesFor(version)) assert.equal(check.files[file].state, "pristine");
      assert.deepEqual(hashes(root, version), before);
      assert.deepEqual(artifacts(root, version), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`an unknown file stops apply before any write [${version}]`, () => {
    const root = makeRoot(version);
    try {
      const target = join(root, filesFor(version)[0]);
      writeFileSync(target, `${readFileSync(target, "utf8")}\n// tampered\n`);
      const before = hashes(root, version);
      const result = run(root, ["--apply"]);
      assert.equal(result.status, 2);
      assert.equal(payload(result, "ERROR").reason, "unknown-file");
      assert.deepEqual(hashes(root, version), before);
      assert.deepEqual(artifacts(root, version), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`an injected rename failure rolls every file back [${version}]`, () => {
    const root = makeRoot(version);
    try {
      const before = hashes(root, version);
      const result = run(root, ["--apply"], {
        SENPI_FREEZE_FIX_TEST_FAIL_RENAME: "3",
      });
      assert.equal(result.status, 3);
      const failure = payload(result, "APPLY");
      assert.equal(failure.status, "rolled-back");
      assert.deepEqual(hashes(root, version), before);
      assert.deepEqual(
        artifacts(root, version).filter((file) => file.endsWith(".new")),
        []
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`a second apply is a no-op [${version}]`, () => {
    const root = makeRoot(version);
    try {
      const before = hashes(root, version);
      const first = run(root, ["--apply"]);
      assert.equal(first.status, 0);
      assert.equal(payload(first, "APPLY").status, "applied");
      const afterFirst = hashes(root, version);
      for (const file of filesFor(version)) assert.notEqual(afterFirst[file], before[file]);

      const second = run(root, ["--apply"]);
      assert.equal(second.status, 0);
      assert.equal(payload(second, "APPLY").status, "no-op");
      assert.deepEqual(hashes(root, version), afterFirst);

      const check = payload(run(root, ["--check"]), "CHECK");
      for (const file of filesFor(version)) assert.equal(check.files[file].state, "patched");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`remove restores the pristine files [${version}]`, () => {
    const root = makeRoot(version);
    try {
      const before = hashes(root, version);
      assert.equal(run(root, ["--apply"]).status, 0);
      const removed = run(root, ["--remove"]);
      assert.equal(removed.status, 0);
      assert.equal(payload(removed, "REMOVE").status, "removed");
      assert.deepEqual(hashes(root, version), before);
      const check = payload(run(root, ["--check"]), "CHECK");
      for (const file of filesFor(version)) assert.equal(check.files[file].state, "pristine");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`every anchor occurs exactly once in the pristine ${version} copies`, async () => {
    const targets = await buildTargets(version);
    assert.deepEqual(targets.map((target) => target.file), filesFor(version));
    for (const target of targets) {
      const text = readFileSync(pristinePath(version, target.file), "utf8");
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

  test(`the four targeted files are the four ${version} baselines`, () => {
    const baselines = JSON.parse(
      readFileSync(join(TOOL_DIR, "baselines.json"), "utf8")
    );
    const entry = baselines.versions[version];
    assert.ok(entry, `baselines.json has no ${version} entry`);
    assert.deepEqual(Object.keys(entry.files).sort(), [...filesFor(version)].sort());
    for (const file of filesFor(version)) {
      assert.equal(sha256File(pristinePath(version, file)), entry.files[file].pristine);
    }
  });
}

test("an unsupported version is check-only and apply writes nothing", { skip: !installed("2026.10.19") }, () => {
  const root = makeRoot("0.0.0", "2026.10.19");
  try {
    const before = hashes(root, "2026.10.19");
    const checkResult = run(root, ["--check"]);
    assert.equal(checkResult.status, 0);
    const check = payload(checkResult, "CHECK");
    assert.equal(check.version, "unsupported");
    assert.equal(check.supported, false);
    for (const file of Object.values(check.files)) assert.equal(file.state, "unknown");

    const applyResult = run(root, ["--apply"]);
    assert.equal(applyResult.status, 2);
    assert.equal(payload(applyResult, "ERROR").reason, "unsupported-version");
    assert.deepEqual(hashes(root, "2026.10.19"), before);
    assert.deepEqual(artifacts(root, "2026.10.19"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every emitted embeddedPaths guard executes in its own bundle shape", async () => {
  for (const version of VERSIONS) {
    const targets = await buildTargets(version);
    let checked = 0;
    for (const target of targets) {
      const edit = target.edits.find((e) => e.name === "embeddedPaths" && e.replacement.includes("flatMap("));
      if (!edit || !/function embeddedPaths\(command\)\{/.test(edit.replacement)) continue;
      const body = edit.replacement.replace(/let path\d+=$/, "return[\"ok\"]})} return embeddedPaths(command);");
      assert.notEqual(body, edit.replacement, `no tail to replace in ${target.file}`);
      const runFn = new Function("command", "EMBEDDED_PATH", body);
      const rx = () => /(\/\/[a-z.]+)()/g;
      assert.deepEqual(runFn("see https://github.com/x", rx()), [], target.file);
      assert.deepEqual(runFn("cat //srv/share", rx()), ["ok"], target.file);
      checked += 1;
    }
    assert.equal(checked, 2, `both bundled copies (${version} chunk and session-worker) must be exercised`);
  }
});

for (const version of VERSIONS) {
  test(`a second managed patch layered on top keeps the bundles patched [${version}]`, () => {
    const root = makeRoot(version);
    try {
      assert.equal(run(root, ["--apply"]).status, 0);
      const layered = filesFor(version).slice(2);
      for (const file of layered) {
        writeFileSync(join(root, file), `${readFileSync(join(root, file), "utf8")}\n/* other layer */\n`);
      }
      const check = payload(run(root, ["--check"]), "CHECK");
      for (const file of layered) {
        assert.equal(check.files[file].state, "patched");
        assert.equal(check.files[file].layered, true);
      }
      const before = hashes(root, version);
      const again = run(root, ["--apply"]);
      assert.equal(again.status, 0);
      assert.deepEqual(hashes(root, version), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
