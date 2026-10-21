#!/usr/bin/env node
// Managed anchor patch for the senpi subscription stream-hash leak.
//
//   patch.mjs --senpi-root <dir> (--check | --apply | --remove) [--receipt <file>]
//
// Defect (senpi 2026.10.19, builtin anthropic-subscription): the `message_update`
// handler calls AssistantCommitBoundary.captureProviderFinal on every streamed delta,
// and captureProviderFinal hashes JSON.stringify of the whole partial message each
// time. During one long generation (opus max thinking) the retained heap of the
// process grows roughly quadratically until the process dies.
// Fix: captureProviderFinal keeps the last streamed payload (string references only)
// and commit() hashes it once at message_end. The clean/rewritten verdict is unchanged.
//
// State is decided by anchors, not whole-file hashes, because the same two bundle
// files also carry the senpi-freeze-fix edits. Layering rule: apply senpi-freeze-fix
// first, then this patch; remove this patch first.
//
// --check  read-only on any version, always exits 0, prints CHECK {json}.
// --apply  writes the changed files atomically (<file>.leak-fix.bak / .leak-fix.new /
//          rename); exits 2 on an unsupported version or anchor mismatch; exits 3
//          after rolling back a failed write; a second run is a no-op.
// --remove reverses the edits (replacement -> anchor) with the same write protocol and
//          deletes the backups; a run on an unpatched tree is a no-op.
//
// The test-only SENPI_LEAK_FIX_TEST_FAIL_RENAME=<n> environment variable makes the
// n-th into-place rename throw so test/patch.test.mjs can exercise the rollback.

import { createHash } from "node:crypto";
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SUPPORTED_VERSIONS = ["2026.10.19", "2026.10.19-2"];
export const MARKER = "omoStreamHashLeakFix";
const BACKUP_SUFFIX = ".leak-fix.bak";
const NEW_SUFFIX = ".leak-fix.new";

/** The bundle chunk is renamed between releases; each version maps to its own. */
export const FILE_CHUNKS = {
  "2026.10.19": "dist/bundle/chunks/chunk-35M5MVUZ.js",
  "2026.10.19-2": "dist/bundle/chunks/chunk-F4ZU4RBE.js",
};
const NEWEST_VERSION = "2026.10.19-2";
export const FILE_CHUNK = FILE_CHUNKS["2026.10.19"];
export const FILE_SESSION_WORKER = "dist/bundle/chunks/session-worker.js";
export const FILE_BOUNDARY =
  "dist/core/extensions/builtin/anthropic-subscription/session-commit-boundary.js";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function countOccurrences(text, needle) {
  let count = 0;
  let index = 0;
  for (;;) {
    index = text.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

function bundleEdits(key, modelArg) {
  return [
    {
      name: "captureProviderFinal",
      anchor: `captureProviderFinal(${key},message){this.providerFinalByKey.set(${key},assistantContentHash(message))}`,
      replacement: `captureProviderFinal(${key},message){/*${MARKER}*/this.providerFinalByKey.set(${key},{role:message.role,api:message.api,provider:message.provider,model:message.model,content:message.content.map(semanticContentBlock)})}`,
    },
    {
      name: "commit",
      anchor: `isResidentAssistant(message,${modelArg})?providerFinal===void 0||providerFinal===assistantContentHash(message)?"clean":"rewritten":"not-resident"`,
      replacement: `isResidentAssistant(message,${modelArg})?providerFinal===void 0||sessionSyncDigest(providerFinal)===assistantContentHash(message)?"clean":"rewritten":"not-resident"`,
    },
  ];
}

const BOUNDARY_EDITS = [
  {
    name: "captureProviderFinal",
    anchor: [
      "    captureProviderFinal(key, message) {",
      "        this.providerFinalByKey.set(key, assistantContentHash(message));",
      "    }",
    ].join("\n"),
    replacement: [
      "    captureProviderFinal(key, message) {",
      `        // ${MARKER}: keep the last streamed payload and hash it once in commit().`,
      "        this.providerFinalByKey.set(key, {",
      "            role: message.role,",
      "            api: message.api,",
      "            provider: message.provider,",
      "            model: message.model,",
      "            content: message.content.map(semanticContentBlock),",
      "        });",
      "    }",
    ].join("\n"),
  },
  {
    name: "commit",
    anchor: '        return providerFinal === assistantContentHash(message) ? "clean" : "rewritten";',
    replacement:
      '        return sessionSyncDigest(providerFinal) === assistantContentHash(message) ? "clean" : "rewritten";',
  },
];

export const TARGETS = targetsFor("2026.10.19");

/** The three targets of a version; an unknown version is shown the newest chunk. */
export function targetsFor(version) {
  const chunk = FILE_CHUNKS[version] ?? FILE_CHUNKS[NEWEST_VERSION];
  return [
    { file: chunk, edits: bundleEdits("key", "modelId") },
    { file: FILE_SESSION_WORKER, edits: bundleEdits("key2", "modelId2") },
    { file: FILE_BOUNDARY, edits: BOUNDARY_EDITS },
  ];
}

/** Match the file's line endings so multi-line anchors work on CRLF checkouts. */
function forText(text, edit) {
  if (!text.includes("\r\n")) return edit;
  return {
    ...edit,
    anchor: edit.anchor.replaceAll("\n", "\r\n"),
    replacement: edit.replacement.replaceAll("\n", "\r\n"),
  };
}

export function editStates(text, edits) {
  return edits.map((raw) => {
    const edit = forText(text, raw);
    return {
      name: edit.name,
      pristine: countOccurrences(text, edit.anchor),
      patched: countOccurrences(text, edit.replacement),
    };
  });
}

/** "pristine", "patched", or "unknown" for one file's edit set. */
export function classifyText(text, edits) {
  const states = editStates(text, edits);
  if (states.every((s) => s.patched === 1 && s.pristine === 0)) return "patched";
  if (states.every((s) => s.pristine === 1 && s.patched === 0)) return "pristine";
  return "unknown";
}

/** Replace each anchor (or, reversed, each replacement) that occurs exactly once. */
export function transformText(text, edits, direction) {
  let output = text;
  for (const raw of edits) {
    const edit = forText(output, raw);
    const from = direction === "apply" ? edit.anchor : edit.replacement;
    const to = direction === "apply" ? edit.replacement : edit.anchor;
    const found = countOccurrences(output, from);
    if (found !== 1) {
      throw new Error(`${edit.name}: ${direction} source occurs ${found} times, expected exactly 1`);
    }
    output = output.replace(from, () => to);
  }
  return output;
}

function print(prefix, payload) {
  process.stdout.write(`${prefix} ${JSON.stringify(payload)}\n`);
}

function usage() {
  process.stderr.write(
    "usage: patch.mjs --senpi-root <dir> (--check | --apply | --remove) [--receipt <file>]\n"
  );
  process.exit(2);
}

function parseArgs(argv) {
  let senpiRoot;
  let mode;
  let receipt;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--senpi-root") senpiRoot = argv[++index];
    else if (arg === "--receipt") receipt = argv[++index];
    else if (arg === "--check" || arg === "--apply" || arg === "--remove") {
      if (mode) usage();
      mode = arg.slice(2);
    } else usage();
  }
  if (!senpiRoot || !mode) usage();
  return { senpiRoot: resolve(senpiRoot), mode, receipt };
}

async function readVersion(senpiRoot) {
  return JSON.parse(await readFile(join(senpiRoot, "package.json"), "utf8")).version;
}

export async function checkTree(senpiRoot) {
  const payload = { senpiRoot, detectedVersion: undefined, supported: false, overall: "unknown", files: {} };
  try {
    payload.detectedVersion = await readVersion(senpiRoot);
  } catch (error) {
    payload.error = `package.json: ${error.message}`;
    return payload;
  }
  payload.supported = SUPPORTED_VERSIONS.includes(payload.detectedVersion);
  const targets = targetsFor(payload.detectedVersion);
  for (const target of targets) {
    const absolute = join(senpiRoot, target.file);
    let buffer;
    try {
      buffer = await readFile(absolute);
    } catch (error) {
      payload.files[target.file] = { state: "unknown", missing: true, error: error.code ?? error.message };
      continue;
    }
    const text = buffer.toString("utf8");
    const states = editStates(text, target.edits);
    payload.files[target.file] = {
      state: classifyText(text, target.edits),
      sha256: sha256(buffer),
      anchorsFound: Object.fromEntries(states.map((s) => [s.name, s.pristine])),
      patchesFound: Object.fromEntries(states.map((s) => [s.name, s.patched])),
      backup: existsSync(absolute + BACKUP_SUFFIX),
    };
  }
  const fileStates = Object.values(payload.files).map((f) => f.state);
  payload.overall = fileStates.every((s) => s === "patched")
    ? "patched"
    : fileStates.every((s) => s === "pristine")
      ? "pristine"
      : fileStates.every((s) => s === "patched" || s === "pristine")
        ? "partial"
        : "unknown";
  return payload;
}

async function writeReceipt(receiptPath, payload) {
  if (!receiptPath) return;
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(payload, null, 2)}\n`);
}

/** Write every planned file through .new + rename; roll back renamed files on failure. */
async function commitPlans(plans, { makeBackups }) {
  const failAt = Number(process.env.SENPI_LEAK_FIX_TEST_FAIL_RENAME ?? 0);
  const done = [];
  try {
    for (const plan of plans) {
      if (makeBackups && !existsSync(plan.absolute + BACKUP_SUFFIX)) {
        await writeFile(plan.absolute + BACKUP_SUFFIX, plan.before);
      }
      await writeFile(plan.absolute + NEW_SUFFIX, plan.after);
    }
    for (const [index, plan] of plans.entries()) {
      if (failAt === index + 1) throw new Error(`test-injected rename failure at ${index + 1}`);
      await rename(plan.absolute + NEW_SUFFIX, plan.absolute);
      done.push(plan);
    }
  } catch (error) {
    for (const plan of done) await writeFile(plan.absolute, plan.before);
    for (const plan of plans) await unlink(plan.absolute + NEW_SUFFIX).catch(() => {});
    return { ok: false, error: error.message, rolledBack: done.map((p) => p.file) };
  }
  return { ok: true };
}

async function run(senpiRoot, mode, receiptPath) {
  const version = await readVersion(senpiRoot).catch(() => undefined);
  if (!SUPPORTED_VERSIONS.includes(version)) {
    print("ERROR", { reason: "unsupported-version", detectedVersion: version });
    process.exit(2);
  }
  const want = mode === "apply" ? "patched" : "pristine";
  const targets = targetsFor(version);
  const plans = [];
  for (const target of targets) {
    const absolute = join(senpiRoot, target.file);
    const before = await readFile(absolute, "utf8").catch(() => null);
    if (before === null) {
      print("ERROR", { reason: "missing-file", file: target.file });
      process.exit(2);
    }
    const state = classifyText(before, target.edits);
    if (state === want) continue;
    if (state === "unknown") {
      print("ERROR", { reason: "anchor-mismatch", file: target.file, states: editStates(before, target.edits) });
      process.exit(2);
    }
    plans.push({ file: target.file, absolute, before, after: transformText(before, target.edits, mode) });
  }
  const result = plans.length === 0 ? { ok: true, noop: true } : await commitPlans(plans, { makeBackups: mode === "apply" });
  if (!result.ok) {
    print("ERROR", { reason: "write-failed", ...result });
    process.exit(3);
  }
  if (mode === "remove") {
    for (const target of targets) await unlink(join(senpiRoot, target.file) + BACKUP_SUFFIX).catch(() => {});
  }
  const after = await checkTree(senpiRoot);
  const payload = { mode, version, changed: plans.map((p) => p.file), noop: plans.length === 0, overall: after.overall, files: after.files };
  try {
    await writeReceipt(receiptPath, payload);
  } catch (error) {
    print(mode.toUpperCase(), { ...payload, receiptError: error.message });
    process.exit(3);
  }
  print(mode.toUpperCase(), payload);
}

async function main() {
  const { senpiRoot, mode, receipt } = parseArgs(process.argv.slice(2));
  if (mode === "check") {
    print("CHECK", await checkTree(senpiRoot));
    return;
  }
  await run(senpiRoot, mode, receipt);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
