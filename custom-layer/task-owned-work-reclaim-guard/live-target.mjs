#!/usr/bin/env node
// Exactly one pinned overlay target. This is NOT an arbitrary-path installer.
import * as nativeFs from "node:fs/promises";
import { win32, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BASELINE_SHA256, FILE, VERSION, PatchError, sha256, transformText } from "./patch.mjs";
import { AFTER_SHA256 } from "./installer.mjs";

export const ROOT = "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package";
export const TARGET = `${ROOT}/${FILE}`;
export const BACKUP = `${TARGET}.task-owned-work-reclaim-guard.live-before-${BASELINE_SHA256}.bak`;
export const STAGED = `${TARGET}.task-owned-work-reclaim-guard.live.new`;
const PACKAGE = `${ROOT}/package.json`;
const key = (path) => win32.normalize(path).toLowerCase();
const refuse = (kind, message) => { throw new PatchError(kind, message); };

async function regularPinned(io, file) {
  const stat = await io.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || key(await io.realpath(file)) !== key(file)) {
    refuse("realpath", `Not the pinned regular file: ${file}`);
  }
}

async function qualifiedTarget(io) {
  if (key(await io.realpath(ROOT)) !== key(ROOT)) refuse("realpath", "Pinned overlay root resolves elsewhere");
  await regularPinned(io, PACKAGE);
  const { version } = JSON.parse((await io.readFile(PACKAGE)).toString("utf8"));
  if (version !== VERSION) refuse("version", `Expected ${VERSION}, got ${version}`);
  await regularPinned(io, TARGET);
  return io.readFile(TARGET);
}

async function existing(io, file) {
  try { await io.lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function checkBackup(io) {
  if (!await existing(io, BACKUP)) return false;
  await regularPinned(io, BACKUP);
  if (sha256(await io.readFile(BACKUP)) !== BASELINE_SHA256) refuse("backup-drift", "Preserve foreign or damaged backup");
  return true;
}

async function authorize(io, goFile, checkpointFile) {
  if (!goFile || !checkpointFile) refuse("authorization", "Separate commander GO and session checkpoints are required");
  const go = JSON.parse((await io.readFile(goFile)).toString("utf8"));
  const checkpoints = JSON.parse((await io.readFile(checkpointFile)).toString("utf8"));
  if (go.decision !== "GO_APPLY_TASK_OWNED_WORK_PINNED_OVERLAY" ||
      go.target !== TARGET || go.beforeSha256 !== BASELINE_SHA256 || go.afterSha256 !== AFTER_SHA256 ||
      typeof go.checkpointId !== "string" || !go.checkpointId ||
      checkpoints.schema !== "task-owned-work-live-checkpoints-v1" ||
      checkpoints.checkpointId !== go.checkpointId || checkpoints.target !== TARGET ||
      checkpoints.hostQuiescent !== true || checkpoints.allAffectedSessionsCheckpointed !== true ||
      !Array.isArray(checkpoints.sessions) || checkpoints.sessions.length === 0) {
    refuse("authorization", "GO/checkpoint contract does not authorize this exact target");
  }
  const sessions = new Set();
  for (const row of checkpoints.sessions) {
    if (typeof row.sessionId !== "string" || !row.sessionId || sessions.has(row.sessionId) ||
        typeof row.checkpointPath !== "string" || !row.checkpointPath ||
        typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.sha256)) {
      refuse("authorization", "Each affected session needs a distinct checkpoint and exact hash");
    }
    sessions.add(row.sessionId);
    if (sha256(await io.readFile(row.checkpointPath)) !== row.sha256) refuse("checkpoint-drift", "Checkpoint bytes changed");
  }
  // These are commander declarations, not an independent process-quiescence detector.
  return { checkpointId: go.checkpointId, sessions: [...sessions] };
}

// Injection is exclusively for tests. All paths written by this function remain fixed constants.
export async function prepareLive({ execute = false, commanderGo, checkpoints } = {}, io = nativeFs) {
  const approval = execute ? await authorize(io, commanderGo, checkpoints) : undefined;
  const before = await qualifiedTarget(io);
  const beforeHash = sha256(before);
  if (![BASELINE_SHA256, AFTER_SHA256].includes(beforeHash)) refuse("drift", "Whole target hash differs; no write");
  const hasBackup = await checkBackup(io);
  if (await existing(io, STAGED)) refuse("staging-exists", "Preserve existing staging file");
  if (beforeHash === AFTER_SHA256) {
    if (!hasBackup) refuse("backup-missing", "Patched target has no qualified original backup");
    return { state: "patched", changed: false, target: TARGET, sha256: beforeHash, backup: BACKUP, checkOnly: !execute };
  }
  const after = Buffer.from(transformText(before.toString("utf8")));
  if (sha256(after) !== AFTER_SHA256) refuse("output-hash", "Output is not the reviewed candidate");
  if (!execute) {
    return { state: "qualified", changed: false, checkOnly: true, target: TARGET,
      beforeSha256: beforeHash, afterSha256: AFTER_SHA256, backup: BACKUP, backupPresent: hasBackup };
  }
  try { await io.writeFile(BACKUP, before, { flag: "wx", flush: true }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  if (!await checkBackup(io)) refuse("backup-missing", "Original backup disappeared");
  let stagedCreated = false;
  try {
    await io.writeFile(STAGED, after, { flag: "wx", flush: true });
    stagedCreated = true;
    await regularPinned(io, STAGED);
    if (sha256(await io.readFile(STAGED)) !== AFTER_SHA256) refuse("staged-drift", "Staged bytes differ");
    if (sha256(await qualifiedTarget(io)) !== BASELINE_SHA256) refuse("drift", "Target changed before replacement");
    if (!await checkBackup(io)) refuse("backup-missing", "Original backup disappeared before replacement");
    // Same-directory rename is the only target write. Checkpoint quiescence is mandatory:
    // Node does not offer a compare-and-swap rename against non-cooperating writers.
    await io.rename(STAGED, TARGET);
    stagedCreated = false;
    const observed = sha256(await qualifiedTarget(io));
    if (observed !== AFTER_SHA256) refuse("post-write-drift", "Preserve concurrent change; no automatic restore");
    return { state: "patched", changed: true, checkOnly: false, target: TARGET, backup: BACKUP,
      beforeSha256: beforeHash, afterSha256: observed, approval };
  } finally {
    if (stagedCreated) await io.unlink(STAGED);
  }
}

export async function main(argv = process.argv.slice(2), io = nativeFs) {
  let options;
  if (argv.length === 0 || (argv.length === 1 && ["--check-only", "--dry-run"].includes(argv[0]))) options = {};
  else if (argv.length === 5 && argv[0] === "--execute-live" && argv[1] === "--commander-go" && argv[3] === "--checkpoints") {
    options = { execute: true, commanderGo: argv[2], checkpoints: argv[4] };
  } else refuse("argument", "Use --check-only or --execute-live --commander-go <json> --checkpoints <json>; no root/target option");
  const result = await prepareLive(options, io);
  console.log(`PINNED_LIVE_INSTALL ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error); process.exitCode = 2; });
}
