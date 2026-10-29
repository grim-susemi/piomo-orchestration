import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));
const PROBE = join(TOOL_DIR, "probe.mjs");
const PATCH = join(TOOL_DIR, "patch.mjs");

const CORE_FILE = "dist/core/extensions/builtin/compaction/speculative-summary.js";
const WRAPPER_CHUNK = "dist/bundle/chunks/chunk-JRXKLIEQ.js";
const SUMMARY_CHUNK = "dist/bundle/chunks/chunk-J2U5VDG7.js";

const CORE_PRISTINE = `export async function generateSummaryMessage(options) {
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

const WRAPPER_CONTENT = `const OPENCODE_SESSION_HEADER="x-opencode-session";
function foo(options){
  return { [OPENCODE_SESSION_HEADER]:options.sessionId };
}
withOpenCodeSessionHeader(openAICompletionsApi());
`;

const SUMMARY_BUNDLE = `async function generateSummaryMessage(options){let requestContext={},headers={};summarizationStream(options.context,options.snapshot.model,requestContext,{apiKey:options.auth.apiKey,headers,foo:1})}`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "opencode-probe-test-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "senpi", version: "2026.10.25-2" }));
  for (const [file, content] of [[CORE_FILE, CORE_PRISTINE], [WRAPPER_CHUNK, WRAPPER_CONTENT], [SUMMARY_CHUNK, SUMMARY_BUNDLE]]) {
    const dest = join(root, file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  }
  return root;
}

function runProbe(root, args = []) {
  const result = spawnSync(process.execPath, [PROBE, "--senpi-root", root, ...args], {
    encoding: "utf8",
  });
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  assert.ok(line.startsWith("PROBE "), "missing PROBE output: " + result.stdout + result.stderr);
  return JSON.parse(line.slice(6));
}

test("probe reports defect-present before patch and defect-absent after patch", () => {
  const root = fixture();
  try {
    const before = runProbe(root);
    assert.equal(before.verdict, "defect-present");
    assert.equal(before.providerWrapper, true);
    assert.equal(before.summaryCall, false);

    const applied = spawnSync(process.execPath, [PATCH, "--senpi-root", root, "--apply"], {
      encoding: "utf8",
    });
    assert.equal(applied.status, 0);

    const after = runProbe(root);
    assert.equal(after.verdict, "defect-absent");
    assert.equal(after.summaryCall, true);
    assert.equal(after.summaryForward, true);
    assert.equal(after.providerWrapper, true);
    assert.equal(after.chunk, "chunk-JRXKLIEQ.js");

    const fromBackups = runProbe(root, ["--from-backups"]);
    assert.equal(fromBackups.verdict, "defect-present");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
