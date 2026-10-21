#!/usr/bin/env node
// Defect probe for the senpi subscription stream-hash leak. Independent of patch.mjs
// anchors, so it can tell when upstream has fixed the defect in a different way.
//
//   probe.mjs --senpi-root <dir> [--from-backups]
//
// static:     for each copy of AssistantCommitBoundary.captureProviderFinal
//             ("hashes" = the method body computes a digest on every call).
// behavioral: imports the unbundled session-commit-boundary.js from <dir> (read-only),
//             times 20 captureProviderFinal calls on a 4 MB thinking block, and checks
//             that commit() still says "clean" for an unchanged message and "rewritten"
//             for a changed one. Skipped with --from-backups (the backups are not
//             importable in place).
// verdict:    defect-present | defect-absent | needs-review. Always exits 0.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const CHUNK_BY_VERSION = {
  "2026.10.19": "dist/bundle/chunks/chunk-35M5MVUZ.js",
  "2026.10.19-2": "dist/bundle/chunks/chunk-F4ZU4RBE.js",
};
const NEWEST_VERSION = "2026.10.19-2";

function filesFor(version) {
  return [
    CHUNK_BY_VERSION[version] ?? CHUNK_BY_VERSION[NEWEST_VERSION],
    "dist/bundle/chunks/session-worker.js",
    "dist/core/extensions/builtin/anthropic-subscription/session-commit-boundary.js",
  ];
}
const DIR = "dist/core/extensions/builtin/anthropic-subscription";
const SLOW_MS_PER_CALL = 1;

/** "hashes", "no-hash", or "absent" for one file's captureProviderFinal body. */
export function staticState(text) {
  const match = /captureProviderFinal\s*\([^)]*\)\s*\{([\s\S]*?)\}/.exec(text);
  if (!match) return "absent";
  return /assistantContentHash\(|[dD]igest\(/.test(match[1]) ? "hashes" : "no-hash";
}

export async function behavioralProbe(senpiRoot) {
  const url = (name) => pathToFileURL(join(senpiRoot, DIR, name)).href;
  const boundary = await import(url("session-commit-boundary.js"));
  const { CLAUDE_SDK_OAUTH_API_ID } = await import(url("api-id.js"));
  const { ANTHROPIC_SUBSCRIPTION_PROVIDER_ID } = await import(url("account-management.js"));
  const model = "probe-model";
  const message = (thinking) => ({
    role: "assistant",
    api: CLAUDE_SDK_OAUTH_API_ID,
    provider: ANTHROPIC_SUBSCRIPTION_PROVIDER_ID,
    model,
    content: [{ type: "thinking", thinking, thinkingSignature: "" }],
  });
  const big = message("x".repeat(4 * 1024 * 1024));
  const commitBoundary = new boundary.AssistantCommitBoundary();
  const calls = 20;
  const t0 = performance.now();
  for (let i = 0; i < calls; i += 1) commitBoundary.captureProviderFinal("k", big);
  const msPerCall = (performance.now() - t0) / calls;
  const clean = commitBoundary.commit("k", big, model);
  commitBoundary.captureProviderFinal("k", message("before"));
  const rewritten = commitBoundary.commit("k", message("after"), model);
  return { msPerCall: Number(msPerCall.toFixed(3)), clean, rewritten, semanticsOk: clean === "clean" && rewritten === "rewritten" };
}

export function verdictOf(statics, behavioral) {
  const states = Object.values(statics);
  if (states.includes("hashes") || (behavioral && behavioral.msPerCall >= SLOW_MS_PER_CALL)) return "defect-present";
  const staticClean = states.every((s) => s === "no-hash");
  if (!staticClean) return "needs-review";
  if (behavioral === null) return "defect-absent";
  return behavioral.semanticsOk ? "defect-absent" : "needs-review";
}

async function main() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--senpi-root");
  if (rootIndex === -1 || !argv[rootIndex + 1]) {
    process.stderr.write("usage: probe.mjs --senpi-root <dir> [--from-backups]\n");
    process.exit(2);
  }
  const senpiRoot = resolve(argv[rootIndex + 1]);
  const fromBackups = argv.includes("--from-backups");
  const version = JSON.parse(
    await readFile(join(senpiRoot, "package.json"), "utf8").catch(() => '{}')
  ).version;
  const statics = {};
  for (const file of filesFor(version)) {
    const path = join(senpiRoot, file) + (fromBackups ? ".leak-fix.bak" : "");
    const text = await readFile(path, "utf8").catch(() => null);
    statics[file] = text === null ? "missing" : staticState(text);
  }
  let behavioral = null;
  let behavioralError;
  if (!fromBackups) {
    try {
      behavioral = await behavioralProbe(senpiRoot);
    } catch (error) {
      behavioralError = error.message;
    }
  }
  const verdict = behavioralError ? "needs-review" : verdictOf(statics, behavioral);
  process.stdout.write(`PROBE ${JSON.stringify({ senpiRoot, fromBackups, statics, behavioral, behavioralError, verdict })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
