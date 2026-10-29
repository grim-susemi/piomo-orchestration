import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));
const PATCH = join(TOOL_DIR, "patch.mjs");

const CORE_FILE = "dist/core/extensions/builtin/compaction/speculative-summary.js";
const CHUNK_FILE = "dist/bundle/chunks/chunk-J2U5VDG7.js";
const WORKER_FILE = "dist/bundle/chunks/session-worker.js";

const CORE_CONTENT = `export async function generateSummaryMessage(options) {
    const providerRequest = undefined;
    const headers = providerRequest
            ? await providerRequest.transformHeaders(options.auth.headers ?? {})
            : options.auth.headers;
        const responseStream = summarizationStream(options.context, options.snapshot.model, requestContext, {
            apiKey: options.auth.apiKey,
            headers,
        });
}
`;

const BUNDLE_CONTENT = `async function generateSummaryMessage(options){let requestContext={},headers={};summarizationStream(options.context,options.snapshot.model,requestContext,{apiKey:options.auth.apiKey,headers,foo:1})}`;

function fixture({ version = "2026.10.25-2" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "opencode-session-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "senpi", version }));
  for (const [file, content] of [[CORE_FILE, CORE_CONTENT], [CHUNK_FILE, BUNDLE_CONTENT], [WORKER_FILE, BUNDLE_CONTENT]]) {
    const dest = join(root, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return root;
}

function run(root, mode) {
  const result = spawnSync(process.execPath, [PATCH, "--senpi-root", root, `--${mode}`], {
    encoding: "utf8",
  });
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  const prefix = mode.toUpperCase() + " ";
  const idx = line.indexOf(prefix);
  return { status: result.status, payload: idx !== -1 ? JSON.parse(line.slice(idx + prefix.length)) : null };
}

for (const version of ["2026.10.21-3", "2026.10.25-2"]) {
  test(`check reports pristine, apply patches files, second apply is no-op [${version}]`, () => {
    const root = fixture({ version });
    try {
      const checked = run(root, "check");
      assert.equal(checked.status, 0);
      assert.equal(checked.payload.supported, true);
      assert.equal(checked.payload.version, version);
      for (const file of [CORE_FILE, CHUNK_FILE, WORKER_FILE]) {
        assert.equal(checked.payload.files[file].state, "pristine");
      }

      const applied = run(root, "apply");
      assert.equal(applied.status, 0);
      assert.equal(applied.payload.version, version);
      for (const file of [CORE_FILE, CHUNK_FILE, WORKER_FILE]) {
        assert.equal(applied.payload.files[file].state, "patched");
        assert.equal(applied.payload.files[file].changed, true);
        assert.ok(existsSync(join(root, file) + ".opencode-session.bak"));
      }

      const again = run(root, "apply");
      assert.equal(again.status, 0);
      for (const file of [CORE_FILE, CHUNK_FILE, WORKER_FILE]) {
        assert.equal(again.payload.files[file].changed, false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(`remove restores original bytes and deletes backups [${version}]`, () => {
    const root = fixture({ version });
    try {
      const beforeCore = readFileSync(join(root, CORE_FILE), "utf8");
      const beforeChunk = readFileSync(join(root, CHUNK_FILE), "utf8");

      assert.equal(run(root, "apply").status, 0);
      const removed = run(root, "remove");
      assert.equal(removed.status, 0);

      assert.equal(readFileSync(join(root, CORE_FILE), "utf8"), beforeCore);
      assert.equal(readFileSync(join(root, CHUNK_FILE), "utf8"), beforeChunk);

      for (const file of [CORE_FILE, CHUNK_FILE, WORKER_FILE]) {
        assert.ok(!existsSync(join(root, file) + ".opencode-session.bak"));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("unsupported version fails check with supported=false", () => {
  const root = fixture({ version: "1.0.0" });
  try {
    const checked = run(root, "check");
    assert.equal(checked.status, 0);
    assert.equal(checked.payload.supported, false);
    assert.equal(checked.payload.version, "unsupported");

    const applied = run(root, "apply");
    assert.equal(applied.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
