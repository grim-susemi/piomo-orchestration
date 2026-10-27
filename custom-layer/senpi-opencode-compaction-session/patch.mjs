#!/usr/bin/env node
// Managed anchor patch: forward the senpi session id into builtin compaction
// summarization requests so the opencode / opencode-go provider can attach
// `x-opencode-session`. Without it, a `compaction.model` such as
// opencode-go/muse-spark-1.3-contributor fails with 400 MissingSessionID.
//
//   patch.mjs --senpi-root <dir> (--check | --apply | --remove) [--receipt <file>]
//
// The patch is anchor-guarded: the target anchor must occur exactly once and
// the patched marker must be absent. --apply writes .opencode-session.bak
// backups and refuses an unknown file; --remove restores the backup after a
// marker check. --check is read-only and always exits 0 when it could inspect
// the files. A second --apply is a no-op.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SUFFIX = ".opencode-session.bak";
const NEW_SUFFIX = ".opencode-session.new";
const VERSION = "2026.10.21-3";

const CORE_FILE = "dist/core/extensions/builtin/compaction/speculative-summary.js";
const CHUNK_DIR = "dist/bundle/chunks";

const CORE_ANCHOR = `const headers = providerRequest
            ? await providerRequest.transformHeaders(options.auth.headers ?? {})
            : options.auth.headers;
        const responseStream = summarizationStream(options.context, options.snapshot.model, requestContext, {
            apiKey: options.auth.apiKey,`;
const CORE_PATCHED = `const headers = providerRequest
            ? await providerRequest.transformHeaders(options.auth.headers ?? {})
            : options.auth.headers;
        const sessionId = compactionSessionId(options.context, options.snapshot.model);
        const responseStream = summarizationStream(options.context, options.snapshot.model, requestContext, {
            ...(sessionId ? { sessionId } : {}),
            apiKey: options.auth.apiKey,`;
const CORE_MARKER = "compactionSessionId(options.context, options.snapshot.model)";
const CORE_EXPORT = "export async function generateSummaryMessage(options) {";
const CORE_HELPER = `function compactionSessionId(context, model) {
    if (!model) return undefined;
    let host = "";
    try { host = new URL(model.baseUrl).hostname; } catch { /* baseUrl is optional */ }
    if (model.provider !== "opencode" && model.provider !== "opencode-go" && host !== "opencode.ai") return undefined;
    try { return context?.sessionManager?.getSessionId?.(); } catch { return undefined; }
}
`;

const BUNDLE_ANCHOR = "requestContext,{apiKey:options.auth.apiKey,headers,";
const BUNDLE_PATCHED =
  'requestContext,{apiKey:options.auth.apiKey,headers,sessionId:(()=>{try{let m=options.snapshot.model,h="";try{h=new URL(m.baseUrl).hostname}catch{}if(m.provider!=="opencode"&&m.provider!=="opencode-go"&&h!=="opencode.ai")return;return options.context?.sessionManager?.getSessionId?.()}catch{return}})(),';
const BUNDLE_MARKER = "sessionId:(()=>{try{let m=options.snapshot.model";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function countOf(haystack, needle) {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function stateOf(text, kind) {
  if (kind === "core") {
    if (text.includes(CORE_MARKER)) return "patched";
    return countOf(text, CORE_ANCHOR) === 1 && countOf(text, CORE_EXPORT) === 1
      ? "pristine"
      : "unknown";
  }
  if (text.includes(BUNDLE_MARKER)) return "patched";
  return countOf(text, BUNDLE_ANCHOR) === 1 ? "pristine" : "unknown";
}

async function discover(root) {
  const files = [];
  const corePath = join(root, CORE_FILE);
  const core = await readFile(corePath, "utf8");
  files.push({ rel: CORE_FILE, path: corePath, text: core, kind: "core" });

  let names = [];
  try {
    names = await readdir(join(root, CHUNK_DIR));
  } catch {
    names = [];
  }
  for (const name of names) {
    if (name !== "session-worker.js" && !/^chunk-.*\.js$/.test(name)) continue;
    const path = join(root, CHUNK_DIR, name);
    let text;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("async function generateSummaryMessage")) continue;
    files.push({ rel: `${CHUNK_DIR}/${name}`, path, text, kind: "bundle" });
  }
  return files;
}

function transform(file) {
  if (file.kind === "core") {
    if (file.text.includes(CORE_MARKER)) return file.text;
    if (countOf(file.text, CORE_ANCHOR) !== 1 || countOf(file.text, CORE_EXPORT) !== 1) {
      throw new Error(`anchor mismatch in ${file.rel}`);
    }
    return file.text
      .replace(CORE_ANCHOR, CORE_PATCHED)
      .replace(CORE_EXPORT, CORE_HELPER + CORE_EXPORT);
  }
  if (file.text.includes(BUNDLE_MARKER)) return file.text;
  if (countOf(file.text, BUNDLE_ANCHOR) !== 1) {
    throw new Error(`anchor mismatch in ${file.rel}`);
  }
  return file.text.replace(BUNDLE_ANCHOR, BUNDLE_PATCHED);
}

async function inspect(root) {
  const files = await discover(root);
  const report = { version: VERSION, supported: true, files: {} };
  for (const file of files) {
    const state = stateOf(file.text, file.kind);
    report.files[file.rel] = { state, sha256: sha256(file.text) };
    if (state === "unknown") report.supported = false;
  }
  if (!report.supported) report.version = "unsupported";
  return { files, report };
}

async function writeAtomic(path, text) {
  const temp = path + NEW_SUFFIX;
  await writeFile(temp, text);
  try {
    await rename(temp, path);
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EEXIST") throw error;
    await unlink(path);
    await rename(temp, path);
  }
}

async function apply(root, receiptPath) {
  const { files, report } = await inspect(root);
  if (!report.supported) {
    return { exitCode: 2, output: { ...report, error: "unsupported anchor shape" } };
  }
  const result = { version: VERSION, files: {} };
  for (const file of files) {
    const before = report.files[file.rel];
    if (before.state === "patched") {
      result.files[file.rel] = { state: "patched", sha256: before.sha256, changed: false };
      continue;
    }
    const next = transform(file);
    const state = stateOf(next, file.kind);
    if (state !== "patched") {
      return { exitCode: 2, output: { ...report, error: `transform did not produce the marker in ${file.rel}` } };
    }
    const backup = file.path + BACKUP_SUFFIX;
    let backupExists = false;
    try {
      const existing = await readFile(backup, "utf8");
      backupExists = true;
      if (stateOf(existing, file.kind) !== "pristine") {
        return { exitCode: 2, output: { ...report, error: `existing backup is not pristine: ${backup}` } };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (!backupExists) await writeFile(backup, file.text);
    await writeAtomic(file.path, next);
    const written = await readFile(file.path, "utf8");
    if (stateOf(written, file.kind) !== "patched") {
      return { exitCode: 3, output: { ...report, error: `post-write verification failed: ${file.rel}` } };
    }
    result.files[file.rel] = { state: "patched", sha256: sha256(written), changed: true };
  }
  const receipt = { schema: 1, patch: "senpi-opencode-compaction-session", root, at: new Date().toISOString(), files: result.files };
  if (receiptPath) {
    await mkdir(dirname(resolve(receiptPath)), { recursive: true });
    await writeFile(resolve(receiptPath), JSON.stringify(receipt, null, 2) + "\n");
  }
  return { exitCode: 0, output: result };
}

async function remove(root, receiptPath) {
  const { files, report } = await inspect(root);
  const result = { version: VERSION, files: {} };
  for (const file of files) {
    const before = report.files[file.rel];
    const backup = file.path + BACKUP_SUFFIX;
    let original;
    try {
      original = await readFile(backup, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      result.files[file.rel] = { state: before.state, restored: false };
      continue;
    }
    if (before.state !== "patched") {
      return { exitCode: 2, output: { ...report, error: `refusing to restore a file without the patch marker: ${file.rel}` } };
    }
    if (stateOf(original, file.kind) !== "pristine") {
      return { exitCode: 2, output: { ...report, error: `backup is not pristine: ${backup}` } };
    }
    await writeAtomic(file.path, original);
    await unlink(backup);
    result.files[file.rel] = { state: "pristine", restored: true };
  }
  const receipt = { schema: 1, patch: "senpi-opencode-compaction-session", root, at: new Date().toISOString(), removed: result.files };
  if (receiptPath) {
    await mkdir(dirname(resolve(receiptPath)), { recursive: true });
    await writeFile(resolve(receiptPath), JSON.stringify(receipt, null, 2) + "\n");
  }
  return { exitCode: 0, output: result };
}

function parseArgs(argv) {
  let senpiRoot;
  let mode = "check";
  let receiptPath;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--senpi-root") senpiRoot = argv[++index];
    else if (arg === "--check") mode = "check";
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--remove") mode = "remove";
    else if (arg === "--receipt") receiptPath = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!senpiRoot) throw new Error("usage: patch.mjs --senpi-root <dir> (--check | --apply | --remove)");
  return { senpiRoot: resolve(senpiRoot), mode, receiptPath };
}

async function main(argv = process.argv.slice(2)) {
  const { senpiRoot, mode, receiptPath } = parseArgs(argv);
  if (mode === "check") {
    const { report } = await inspect(senpiRoot);
    console.log("CHECK " + JSON.stringify(report));
    return 0;
  }
  const outcome = mode === "apply" ? await apply(senpiRoot, receiptPath) : await remove(senpiRoot, receiptPath);
  console.log((mode === "apply" ? "APPLY " : "REMOVE ") + JSON.stringify(outcome.output));
  return outcome.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error?.stack ?? String(error));
      process.exit(3);
    },
  );
}

export { CORE_ANCHOR, BUNDLE_ANCHOR, stateOf, transform };
