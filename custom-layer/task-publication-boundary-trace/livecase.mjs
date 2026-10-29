// Preparation is separate from adoption. No top-level I/O or runtime activation.
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  TARGET, BASELINE_SHA256, SELECTOR_SHA256, LIVE_SELECTOR, BUILD_REF, MANIFEST_REF,
  PatchError, sha256, selectorText, transformText,
} from "./patch.mjs";

export const ROOT = "C:/Users/USER/orca/projects/piomo-orchestration-source/custom-layer/task-publication-boundary-trace";
export const EVIDENCE = "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/overnight-command-20261023";
export const SOURCE_PATHS = ["patch.mjs", "patch.test.mjs", "livecase.mjs"].map((name) => `${ROOT}/${name}`);
export const TEST_DESCRIPTION = "N1 r1 offline review findings <=60s";
export const SESSION = "C:/Users/USER/.omo-stable-500/home/.omo/agent/sessions/--C--Users-USER-orca-projects-기타 작업--/2026-10-23T03-52-38-595Z_67f4ea63-2dbe-4840-a3cf-e81c6c3ed166.jsonl";
export const FILES = Object.freeze({
  readiness: `${EVIDENCE}/maintenance-publication-livecase-readiness.json`,
  buildGo: `${EVIDENCE}/maintenance-publication-n1-revision-go.json`,
  selector: `${EVIDENCE}/publication-probe01-n1-r1-selector.json`,
  candidate: `${EVIDENCE}/publication-probe01-n1-r1-omo-task.js.candidate`,
  manifest: MANIFEST_REF,
  buildResult: `${EVIDENCE}/maintenance-publication-n1-r1-build-result.json`,
  liveGo: `${EVIDENCE}/maintenance-publication-livecase-live-go.json`,
  checkpoints: `${EVIDENCE}/maintenance-publication-livecase-checkpoints.json`,
  seal: `${EVIDENCE}/maintenance-publication-probe01-trace-seal.json`,
});
export const BACKUP = `${TARGET}.publication-probe01.before-${BASELINE_SHA256}.bak`;
export const STAGE = `${TARGET}.publication-probe01.new`;
const PACKAGE = "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package";
const CONTEXT_PINS = {
  [`${EVIDENCE}/maintenance-publication-u1-gate.json`]: "b442ff3a31c12facc116f3143f346353e3acea4d0ab664b467ac03ce25cea06b",
  [`${EVIDENCE}/maintenance-publication-u1-result.json`]: "fe1441c932ad24cf292b62eb0f3fa466a7bd0d1f26abd6596567366ec675dd49",
  [FILES.readiness]: "ca73a18ed1ffc5a8901b9b7da4c771b676f0cd15dbd2ac03968818d535e6e102",
  [`${EVIDENCE}/maintenance-publication-livecase-manifest.json`]: "4733ffab15b102f84fa2726a507f39dd1766d7266120d8c62b560a7527021f17",
  [`${EVIDENCE}/publication-probe01-omo-task.js.candidate`]: "5812bee204fdcf1f5dba194e92bac3ee71e369ed9b976d57d27ff6220e561354",
  [`${EVIDENCE}/maintenance-publication-livecase-build-result.json`]: "3aa24f25fd5534a281c3748a61708bc10aa1c0c34e14bab02f0ff8ce3b70c8c2",
  [`${EVIDENCE}/maintenance-publication-n1-gate-r1.json`]: "5a35cfd7d9a509837268fb0e8a2152ab25440ff3530d2baf420f4d61239f3c7b",
};
const PREIMAGES = {
  "patch.mjs": "7c00df183ffb2d38dca4316e0156db61cd92163d0481f85e795059414ff3193d",
  "patch.test.mjs": "af28412fea4b706552057bd6cbbc9a341c4c0a23590e525bf31aaf122abcce18",
  "livecase.mjs": "ca768143aafbc238063318bd3499278f4262546a3277a19b7054e3bebe6962aa",
  installedReadOnlyBaseline: BASELINE_SHA256,
};
const normalize = (path) => path.replaceAll("\\", "/").toLowerCase();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const requireValue = (condition, kind, message) => {
  if (!condition) throw new PatchError(kind, message);
};
const digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const textOf = (message) => (message?.content ?? []).map((part) => part.text ?? "").join("\n");

async function regular(path, io = fs) {
  const info = await io.lstat(path);
  requireValue(info.isFile() && !info.isSymbolicLink(), "path", `Not a regular file: ${path}`);
  requireValue(normalize(await io.realpath(path)) === normalize(path), "path", `Unexpected realpath: ${path}`);
  return io.readFile(path);
}

async function json(path, io = fs) {
  return JSON.parse((await regular(path, io)).toString("utf8"));
}

async function absent(path, io = fs) {
  try { await io.lstat(path); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new PatchError("existing", `Artifact already exists: ${path}`);
}

async function exclusive(path, bytes, io = fs) {
  const handle = await io.open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function sourcePins(io = fs) {
  return Promise.all(SOURCE_PATHS.map(async (path) => {
    const bytes = await regular(path, io);
    return { path, sha256: sha256(bytes), bytes: bytes.length };
  }));
}

async function fixedPackage(io = fs) {
  requireValue((await json(`${PACKAGE}/package.json`, io)).version === "5.1.40", "version", "Expected package5.1.40");
  const bytes = await regular(TARGET, io);
  return { bytes, sha256: sha256(bytes) };
}

// Only native bash_output wrappers for this session's explicitly named monitor
// are eligible. Raw stdout is retained, never substituted by a program's own
// reported status. Failed attempts, including failures before the marker, stay.
export function collectTestEvidence(records) {
  const starts = new Set();
  const handles = new Set();
  const outputs = new Map();
  for (const record of records) {
    if (record.message?.role !== "assistant") continue;
    for (const call of record.message.content ?? []) {
      if (call.type === "toolCall" && call.name === "eval" &&
          call.arguments?.code?.includes(TEST_DESCRIPTION) && call.arguments.code.includes("tool.monitor")) starts.add(call.id);
    }
  }
  for (const record of records) {
    if (record.message?.role === "toolResult" && starts.has(record.message.toolCallId)) {
      for (const handle of textOf(record.message).match(/bash_[0-9]+/g) ?? []) handles.add(handle);
    }
    if (record.message?.role === "assistant") {
      for (const call of record.message.content ?? []) {
        if (call.type === "toolCall" && call.name === "bash_output" && handles.has(call.arguments?.bash_id)) outputs.set(call.id, call.arguments.bash_id);
      }
    }
  }
  const runs = records.filter((record) => record.message?.role === "toolResult" &&
    record.message.toolName === "bash_output" && outputs.has(record.message.toolCallId)).map((record) => {
    const raw = textOf(record.message);
    const match = /^status: completed exit_code: (-?[0-9]+)\r?\n/.exec(raw);
    const marker = /^N1_CANDIDATE (.+)$/m.exec(raw.replace(/\x1b\[[0-9;]*m/g, ""));
    const installation = /^N1_R1_INSTALL_CASES (.+)$/m.exec(raw.replace(/\x1b\[[0-9;]*m/g, ""));
    return {
      bashId: outputs.get(record.message.toolCallId),
      sessionRecordId: record.id, timestamp: record.timestamp,
      actualNumericExit: match ? Number(match[1]) : null,
      candidate: marker ? JSON.parse(marker[1]) : null,
      installationPaths: installation ? JSON.parse(installation[1]) : null,
      raw, nativeToolRecord: record,
    };
  });
  const completed = runs.filter((run) => run.actualNumericExit !== null);
  const last = completed.at(-1);
  requireValue(last?.actualNumericExit === 0 && last.candidate, "test-evidence", "No completed matching native Node exit0 and N1 marker");
  return { runs, last };
}

export function validateLiveAuthority(go, manifest, checkpoints) {
  requireValue(go?.decision === "GO_APPLY_PUBLICATION_PROBE01_LIVECASE", "authority", "A distinct future live GO is required");
  requireValue(manifest?.schema === "publication-probe01-manifest-v1" &&
    manifest.buildRef === BUILD_REF && manifest.manifestRef === FILES.manifest &&
    manifest.target === TARGET && manifest.beforeSha256 === BASELINE_SHA256 &&
    digest(manifest.candidate?.sha256) && manifest.candidate.path === FILES.candidate &&
    manifest.selectorSha256 === SELECTOR_SHA256 &&
    manifest.sourcePins?.length === 3 &&
    same(manifest.sourcePins.map((pin) => pin.path), SOURCE_PATHS) &&
    manifest.sourcePins.every((pin) => digest(pin.sha256)), "manifest", "Incomplete or non-fixed manifest");
  requireValue(go.parentSessionId === LIVE_SELECTOR.parentSessionId &&
    go.buildRef === BUILD_REF && go.manifestRef === FILES.manifest &&
    go.target === TARGET && go.expectedBeforeSha256 === BASELINE_SHA256 &&
    go.expectedAfterSha256 === manifest.candidate.sha256 &&
    go.selectorSha256 === SELECTOR_SHA256 &&
    same(go.sourcePins, manifest.sourcePins) &&
    same(go.probe, {
      taskName: LIVE_SELECTOR.taskName, runEpoch: 0, maxBindings: 1,
      role: LIVE_SELECTOR.agentType, model: LIVE_SELECTOR.resolvedModel,
      reasoning: "medium", nativeChildren: 1, ptyJobs: 0,
      modelOverrides: 0, fallback: false,
    }) &&
    go.normalMaintenanceRefreshOnly === true && go.acceptRamHashUnknown === true &&
    go.allowFixedDiagnosticSealAndTimer === true, "authority", "Live GO does not adopt these exact pins and limits");
  requireValue(checkpoints?.schema === "publication-probe01-checkpoints-v1" &&
    checkpoints.target === TARGET &&
    checkpoints.beforeSha256 === BASELINE_SHA256 &&
    checkpoints.afterSha256 === manifest.candidate.sha256 &&
    checkpoints.cooperativeTargetWriteQuiescent === true &&
    checkpoints.allAffectedSessionsCheckpointed === true &&
    Array.isArray(go.affectedSessionIds) && go.affectedSessionIds.length === 7 &&
    new Set(go.affectedSessionIds).size === 7 &&
    go.affectedSessionIds.includes(LIVE_SELECTOR.parentSessionId) &&
    same(checkpoints.sessions?.map((entry) => entry.sessionId), go.affectedSessionIds) &&
    checkpoints.sessions.every((entry) => typeof entry.path === "string" && digest(entry.sha256)),
  "checkpoints", "Seven exact cooperative checkpoint receipts are required");
}

export async function adoptedInputs(io = fs) {
  const [go, manifest, checkpoints] = await Promise.all([
    json(FILES.liveGo, io), json(FILES.manifest, io), json(FILES.checkpoints, io),
  ]);
  validateLiveAuthority(go, manifest, checkpoints);
  const build = await json(FILES.buildResult, io);
  requireValue(build.status === "BUILD_PREPARE_COMPLETE_NOT_APPLIED" &&
    build.actualPrepareProcessExit === 0 && build.tests?.last?.actualNumericExit === 0 &&
    same(build.manifest, manifest), "build-result", "Finalized native test/prepare exit0 evidence is required");
  requireValue(same(await sourcePins(io), manifest.sourcePins), "source", "Prepared source pins drifted");
  const selector = await regular(FILES.selector, io);
  requireValue(sha256(selector) === SELECTOR_SHA256 && selector.toString("utf8") === selectorText(), "selector", "Selector drifted");
  const bytes = await regular(FILES.candidate, io);
  requireValue(sha256(bytes) === manifest.candidate.sha256 && bytes.length === manifest.candidate.bytes, "candidate", "Full candidate drifted");
  for (const checkpoint of checkpoints.sessions) {
    requireValue(sha256(await regular(checkpoint.path, io)) === checkpoint.sha256, "checkpoints", "Checkpoint bytes drifted");
  }
  return { manifest, bytes };
}

// The CLI uses real fs; tests pass a memory-only port through the same paths.
export async function executeLive(io = fs) {
  const { manifest, bytes } = await adoptedInputs(io);
  const before = await fixedPackage(io);
  requireValue(before.sha256 === BASELINE_SHA256, "baseline", "Target is not the six-transform642 image");
  await absent(STAGE, io);
  try {
    requireValue(sha256(await regular(BACKUP, io)) === BASELINE_SHA256, "backup", "Existing backup is not642");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await exclusive(BACKUP, before.bytes, io);
  }
  requireValue(sha256(await regular(BACKUP, io)) === BASELINE_SHA256, "backup", "Before642 backup readback mismatch");
  await exclusive(STAGE, bytes, io);
  requireValue(sha256(await regular(STAGE, io)) === manifest.candidate.sha256, "stage", "Stage changed");
  requireValue((await fixedPackage(io)).sha256 === BASELINE_SHA256, "baseline", "Concurrent target change");
  await io.rename(STAGE, TARGET);
  requireValue((await fixedPackage(io)).sha256 === manifest.candidate.sha256 &&
    sha256(await regular(BACKUP, io)) === BASELINE_SHA256, "readback", "After/backup readback mismatch");
  return { state: "applied", afterSha256: manifest.candidate.sha256, backup: BACKUP };
}

export async function checkOnly(io = fs) {
  const { manifest } = await adoptedInputs(io);
  requireValue((await fixedPackage(io)).sha256 === manifest.candidate.sha256 &&
    sha256(await regular(BACKUP, io)) === BASELINE_SHA256, "readback", "After/backup mismatch");
  return { state: "verified", afterSha256: manifest.candidate.sha256 };
}

export async function prepare() {
  const [go, packet] = await Promise.all([json(FILES.buildGo), json(FILES.readiness)]);
  requireValue(go.decision === "GO_N1_REVIEW_FINDINGS_ONLY_OFFLINE_REVISION" &&
    go.owner === `maintenance session ${LIVE_SELECTOR.parentSessionId}` &&
    go.gate === `${EVIDENCE}/maintenance-publication-n1-gate-r1.json` &&
    same(go.allowedSourcePaths, SOURCE_PATHS) && go.baseline?.split(",")[0] === BASELINE_SHA256 &&
    go.output === FILES.buildResult, "authority", "Revision-only GO mismatch");
  requireValue(selectorText(packet.selector.value) === selectorText(), "selector", "Packet selector mismatch");
  for (const path of [FILES.selector, FILES.candidate, FILES.manifest, FILES.buildResult]) await absent(path);
  const provenance = [];
  for (const [path, expected] of Object.entries(CONTEXT_PINS)) {
    const bytes = await regular(path);
    requireValue(sha256(bytes) === expected, "provenance", "U1 evidence or packet changed");
    provenance.push({ path, sha256: expected, bytes: bytes.length });
  }
  const baseline = await fixedPackage();
  requireValue(baseline.sha256 === BASELINE_SHA256, "baseline", "Read-only baseline drifted");
  const pins = await sourcePins();
  const records = (await regular(SESSION)).toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const tests = collectTestEvidence(records);
  requireValue(same(tests.last.candidate.sourcePins, pins) &&
    tests.last.candidate.buildRef === BUILD_REF &&
    tests.last.candidate.fullModuleParse?.length === 4 &&
    tests.last.candidate.fullModuleParse.every((entry) => entry.status === "unlinked" && entry.evaluated === false) &&
    tests.last.installationPaths?.memoryOnly === true &&
    tests.last.installationPaths.adoptedInputs > 0 &&
    tests.last.installationPaths.executeLive > 0 && tests.last.installationPaths.checkOnly > 0 &&
    tests.last.candidate.selector === SELECTOR_SHA256 &&
    tests.last.candidate.baseline === BASELINE_SHA256, "test-evidence", "Passing test used different source/selector/baseline pins");
  const candidate = transformText(baseline.bytes.toString("utf8"), { liveSelector: packet.selector.value });
  const candidateBytes = Buffer.from(candidate, "utf8");
  requireValue(sha256(candidateBytes) === tests.last.candidate.live, "candidate", "Prepared image differs from tested image");
  requireValue((await fixedPackage()).sha256 === BASELINE_SHA256, "baseline", "Baseline changed during preparation");
  const manifest = {
    schema: "publication-probe01-manifest-v1", target: TARGET,
    buildRef: BUILD_REF, manifestRef: FILES.manifest,
    packageRoot: PACKAGE, packageVersion: "5.1.40",
    beforeSha256: BASELINE_SHA256,
    selectorPath: FILES.selector, selectorSha256: SELECTOR_SHA256,
    sourcePins: pins,
    candidate: { path: FILES.candidate, sha256: sha256(candidateBytes), bytes: candidateBytes.length },
    mode: "live-selective-candidate-not-installed",
    composition: "Full native baseline642 plus diagnostic layer; no VM fragments or runtime stubs",
    preimagePinsBeforeRevision: PREIMAGES,
    fullModuleParse: tests.last.candidate.fullModuleParse,
    offlineInstallationPaths: tests.last.installationPaths,
    preservedEvidence: provenance, memoryHash: "UNKNOWN",
    futureAuthority: {
      decision: "GO_APPLY_PUBLICATION_PROBE01_LIVECASE",
      requiredFields: [
        "buildRef", "manifestRef", "parentSessionId", "target", "expectedBeforeSha256", "expectedAfterSha256",
        "selectorSha256", "sourcePins", "probe", "affectedSessionIds",
        "normalMaintenanceRefreshOnly", "acceptRamHashUnknown", "allowFixedDiagnosticSealAndTimer",
      ],
      checkpointSchema: "publication-probe01-checkpoints-v1",
      checkpointFields: ["target", "beforeSha256", "afterSha256", "cooperativeTargetWriteQuiescent", "allAffectedSessionsCheckpointed", "sessions[{sessionId,path,sha256}]"],
    },
  };
  const result = {
    status: "PREPARED_CANDIDATE_PROCESS_EXIT_PENDING_PARENT_RECEIPT",
    scope: "N1 r1 three review findings only; offline revision",
    buildRef: BUILD_REF,
    manifest, tests,
    originalBaseline: { before: baseline.sha256, after: (await fixedPackage()).sha256 },
    actualPrepareProcessExit: null,
    preparationCommandReportedSuccess: true,
    parentFinalizationRequired: "Preserve the real process exit/raw wrapper after this process has exited; do not self-attest exit0",
    installedWrites: 0, realTimersRun: 0, realReceiptsWritten: 0,
    nativeChildren: 0, providerCalls: 0, checkOnlyCalls: 0, executeLiveCalls: 0,
    installationCallScope: "checkOnlyCalls/executeLiveCalls above count real installed filesystem calls only; actual functions were exercised on offline memory ports",
    next: "Return preparation evidence; no installation or live activation without a separately pinned GO and checkpoints",
  };
  await exclusive(FILES.selector, selectorText());
  await exclusive(FILES.candidate, candidateBytes);
  await exclusive(FILES.manifest, JSON.stringify(manifest, null, 2) + "\n");
  await exclusive(FILES.buildResult, JSON.stringify(result, null, 2) + "\n");
  return { state: "prepared-not-applied", buildRef: BUILD_REF, sourcePins: pins, selectorSha256: SELECTOR_SHA256, candidate: manifest.candidate, actualProcessExit: null };
}

function exactArgs(args, expected) {
  requireValue(same(args, expected), "arguments", "Only the fixed packet command is supported");
}

async function main(args) {
  if (args[0] === "--prepare") {
    exactArgs(args, ["--prepare", "--readiness", FILES.readiness, "--go", FILES.buildGo]);
    return prepare();
  }
  if (args[0] === "--execute-live") {
    exactArgs(args, ["--execute-live", "--go", FILES.liveGo, "--checkpoints", FILES.checkpoints, "--manifest", FILES.manifest]);
    return executeLive();
  }
  exactArgs(args, ["--check-only", "--manifest", FILES.manifest]);
  return checkOnly();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((result) => {
    console.log(`N1_PREPARE ${JSON.stringify(result)}`);
  }, (error) => {
    console.error(`N1_LIVECASE_ERROR ${JSON.stringify({ kind: error.kind ?? error.code ?? "error", message: error.message })}`);
    process.exitCode = 1;
  });
}
