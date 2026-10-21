import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SUPPORTED_VERSIONS, FILE_BOUNDARY, classifyText, targetsFor } from "../patch.mjs";
import { staticState } from "../probe.mjs";

const PATCH = join(dirname(fileURLToPath(import.meta.url)), "..", "patch.mjs");

/** A fake senpi root whose three target files hold each anchor exactly once. */
function fixture({ version = "2026.10.19", crlf = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "leak-fix-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  for (const target of targetsFor(version)) {
    const body = target.edits.map((e) => e.anchor).join("\nconst between = 1;\n");
    let text = `// head\n${body}\n// tail\n`;
    if (crlf) text = text.replaceAll("\n", "\r\n");
    mkdirSync(dirname(join(root, target.file)), { recursive: true });
    writeFileSync(join(root, target.file), text);
  }
  return root;
}

function run(root, mode, env = {}) {
  const result = spawnSync(process.execPath, [PATCH, "--senpi-root", root, `--${mode}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  return { status: result.status, payload: JSON.parse(line.slice(line.indexOf(" ") + 1)) };
}

const snapshot = (root, version) =>
  Object.fromEntries(targetsFor(version).map((t) => [t.file, readFileSync(join(root, t.file), "utf8")]));

for (const version of SUPPORTED_VERSIONS) {
  test(`check reports pristine, apply patches every file, a second apply is a no-op [${version}]`, () => {
    const root = fixture({ version });
    try {
      assert.equal(run(root, "check").payload.overall, "pristine");
      const applied = run(root, "apply");
      assert.equal(applied.status, 0);
      assert.equal(applied.payload.overall, "patched");
      assert.equal(applied.payload.changed.length, 3);
      for (const t of targetsFor(version)) {
        assert.ok(existsSync(join(root, t.file) + ".leak-fix.bak"));
        assert.equal(staticState(readFileSync(join(root, t.file), "utf8")), "no-hash");
      }
      const again = run(root, "apply");
      assert.equal(again.status, 0);
      assert.equal(again.payload.noop, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`remove restores the original bytes and deletes the backups [${version}]`, () => {
    const root = fixture({ version });
    try {
      const before = snapshot(root, version);
      assert.equal(run(root, "apply").status, 0);
      const removed = run(root, "remove");
      assert.equal(removed.status, 0);
      assert.equal(removed.payload.overall, "pristine");
      assert.deepEqual(snapshot(root, version), before);
      for (const t of targetsFor(version)) assert.ok(!existsSync(join(root, t.file) + ".leak-fix.bak"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`multi-line anchors match a CRLF checkout [${version}]`, () => {
    const root = fixture({ version, crlf: true });
    try {
      assert.equal(run(root, "apply").status, 0);
      const text = readFileSync(join(root, FILE_BOUNDARY), "utf8");
      assert.equal(classifyText(text, targetsFor(version)[2].edits), "patched");
      assert.ok(!/[^\r]\n/.test(text));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("unsupported version and duplicated anchors exit 2 without writing", () => {
  const old = fixture({ version: "2026.9.1" });
  const dup = fixture();
  try {
    assert.equal(run(old, "apply").status, 2);
    const file = join(dup, targetsFor("2026.10.19")[0].file);
    writeFileSync(file, readFileSync(file, "utf8") + targetsFor("2026.10.19")[0].edits[0].anchor);
    const before = snapshot(dup, "2026.10.19");
    const result = run(dup, "apply");
    assert.equal(result.status, 2);
    assert.equal(result.payload.reason, "anchor-mismatch");
    assert.deepEqual(snapshot(dup, "2026.10.19"), before);
  } finally {
    rmSync(old, { recursive: true, force: true });
    rmSync(dup, { recursive: true, force: true });
  }
});

test("a failed rename rolls back every file already replaced", () => {
  const root = fixture();
  try {
    const before = snapshot(root, "2026.10.19");
    const result = run(root, "apply", { SENPI_LEAK_FIX_TEST_FAIL_RENAME: "2" });
    assert.equal(result.status, 3);
    assert.deepEqual(result.payload.rolledBack, [targetsFor("2026.10.19")[0].file]);
    assert.deepEqual(snapshot(root, "2026.10.19"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the 2026.10.19 target list still names the original chunk", () => {
  assert.equal(targetsFor("2026.10.19")[0].file, "dist/bundle/chunks/chunk-35M5MVUZ.js");
  assert.equal(targetsFor("2026.10.19-2")[0].file, "dist/bundle/chunks/chunk-F4ZU4RBE.js");
});
