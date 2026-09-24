/* todo-7-retry insert fragment.
 *
 * This file is NOT a standalone module. qa/retry-budget-anchor.mjs reads it and splices the
 * sections below into the beta.84 plugin/extensions/omo-task.js body *after* the todo-9-health
 * splice (harness-diagnostics-improve Todo 7 lands through its own patches/installed-patches.json
 * slot `todo-7-retry`, never inside gateRepair).
 *
 * Sections:
 *   @splice-settings -> replaces the settings-builder knob construction
 *                       `i={...void 0===n?.maxRetries?{}:{maxRetries:n.maxRetries},...}`
 *                       with budget-sourced engine retry knobs (maxSameFailureRetries 2,
 *                       baseDelayMs 250) so the EXISTING engine turn-retry plumbing is
 *                       budget-governed instead of ad hoc
 *   @splice-install  -> added as a binding in the same declaration list as the `u=eY(...)` wiring
 *                       call in the component register body (the wiring sits inside a
 *                       `let c=...,u=eY(...),p=RJ(...)` binding list, so the install call must be
 *                       a binding initializer, not a bare call expression); installs the
 *                       tool_call/tool_result hooks on the extension API (the real tool dispatcher
 *                       seam - the engine calls these hooks before and after every tool execution
 *                       and honours {block:true, reason})
 *   @splice-te-head  -> replaces the fallback-decision head with the trusted-loader fatal
 *                       fast-fail check (one structured terminal cause, no fallback replay).
 *                       beta.84 re-author (P3, st_01a0cb41): the fallback-decision method renamed
 *                       #te -> #ae with its two-arg shape intact (`e.record` + the launch error),
 *                       the store is this.#E.store and the failure class UR (was S$). The new
 *                       beta.84 #te(e) is the SPAWN-FAILURE finalizer (destructures
 *                       {claimed,registration,spec,executionMode,lease}) and is deliberately NOT
 *                       the seam: an early return there would skip lease release and the
 *                       start/fail transitions. The fallback-decision head is where the recorded
 *                       design places the launch fast-fail (no fallback replay, no second loop).
 *   @defs            -> appended at the end of the bundle (ESM imports hoist)
 *
 * Policy (harness-diagnostics-improve Todo 7): engine budget seams are ABSENT (task-1-seams.json
 * records no per-operation retry seam and no retry-admission seam), so the budget is NEW
 * custom-layer state over the existing maxRetries plumbing:
 *   - per-operation identity = tool name + sha256(canonical args) (the Todo 5 analyzer's
 *     "operation signature"; st_01a0c4e1's six distinct missing-resource operations are six
 *     distinct identities and never trip an identical-operation abort)
 *   - maxSameFailureRetries 2 (1 initial execution + 2 retries = exactly 3 executions of one
 *     operation, then one terminal retry_budget_exhausted event; the identity is closed)
 *   - maxTaskRetryAttempts 8 CHARGED retry admissions per task per budgetEpoch: an admission
 *     is charged only when it is a retry of an operation that already has failures; an engine
 *     gate rejection (the bracketed [GATE] retry=retry-after-input / retry=never-retry result
 *     classified by omoRetryIsGateRejection) is never charged and never marks an operation
 *     failed, so repeated gate refusals and repeated successful re-reads of one identity can
 *     never storm the task budget
 *   - backoff = max(Retry-After hint, min(4000, 250 * 2^(n-1))) - the engine default turn
 *     profile shape (baseDelayMs 250, growthFactor 2, perAttemptCapMs 4000) re-expressed as
 *     layer state; carried on the refusal reason and in the terminal event
 *   - budgetEpoch is separate from the engine run_epoch: only omoRetryReset advances it, and
 *     fallback transitions (run_epoch bumps) leave counters and budgetEpoch untouched
 *   - state persists at <stateDir>/retry-budgets/<safe task key>.json (tmp+rename) so counters
 *     and the emitted-event set survive restart; duplicate delivery never double-counts
 *   - parallel duplicates of one identity serialize: the second delivery waits for the
 *     in-flight execution to settle and only then is admitted or refused; the same toolCallId
 *     is never executed twice
 *   - failures of one identity are never reset by an unrelated success; only a success of the
 *     same identity resets its own counter
 *   - trusted-loader ENOENT inside the registered chunk graph (path shape
 *     <deployment>/dist/bundle/chunks/<file>.js, matched against the registered graph when
 *     available, otherwise proven absent on disk) latches fatal: exactly one structured
 *     retry_fatal terminal cause, all later tool admissions for the task refused (no silent
 *     shell-search substitution). Ordinary missing project files stay recoverable.
 * No second retry loop exists anywhere in this delta: the engine/model owns execution and the
 * governor only admits or refuses the next execution.
 */
// ==== @splice-settings
i=omoRetryEngineRetryKnobs(n)
// ==== @splice-install
,omoRetryInstalled=omoRetryInstall(n,{engine:l})
// ==== @splice-te-head
#ae(e,t){if(omoRetryLaunchFatal(this.#E.store,e.record,t))return;if(!UR.is(t)||"model_unavailable"!==t.failure.kind)return;
// ==== @defs
// ==== omoRetry:defs:begin
// ---------------------------------------------------------------------------
// omoRetry - budget-governed retry admission + trusted-loader fatal latch (Todo 7).
// Self-contained: every engine fact arrives through the documented hook contracts
// (pi.on("tool_call") / pi.on("tool_result")) or through the passed store/pi objects;
// no engine-local symbol is referenced. All state is new custom-layer state.
// ---------------------------------------------------------------------------
import { existsSync as ogQExistsSync2, writeFileSync as ogQWriteFileSync2, mkdirSync as ogQMkdirSync2, renameSync as ogQRenameSync2, rmSync as ogQRmSync2, readFileSync as ogQReadFileSync2 } from "node:fs";
import { join as ogQJoin2, dirname as ogQDirname2 } from "node:path";
import { createHash as ogQCreateHash2 } from "node:crypto";

var omoRetrySchema = "senpi-task/retry-budget/v1";
// Budget constants (Todo 7 pinned): the engine default turn profile is baseDelayMs 250,
// growthFactor 2, perAttemptCapMs 4000 (SENPI_DEFAULT_RETRY_PROFILE); the layer re-expresses
// it as explicit layer state and stays stricter than the engine defaults on maxRetries.
var omoRetryLimits = { maxSameFailureRetries: 2, maxTaskRetryAttempts: 8, baseDelayMs: 250, perAttemptCapMs: 4000 };
var omoRetryMaxOpExecutions = 1 + omoRetryLimits.maxSameFailureRetries;
var omoRetryMaxOps = 256;
var omoRetryChunkPattern = /[\\/]dist[\\/]bundle[\\/]chunks[\\/]([^\\/\s"']+\.js)/;
var omoRetryLaunchLatches = {};
var omoRetryWriteSeq = 0;

function omoRetryNow() { return Date.now(); }
function omoRetryBackoffMs(omoRetryAttemptNumber, omoRetryHintMs) {
  var omoRetryN = "number" == typeof omoRetryAttemptNumber && omoRetryAttemptNumber >= 1 ? Math.floor(omoRetryAttemptNumber) : 1;
  var omoRetryLocal = Math.min(omoRetryLimits.perAttemptCapMs, omoRetryLimits.baseDelayMs * 2 ** (omoRetryN - 1));
  var omoRetryHint = "number" == typeof omoRetryHintMs && Number.isFinite(omoRetryHintMs) && omoRetryHintMs > 0 ? omoRetryHintMs : 0;
  return Math.max(omoRetryHint, omoRetryLocal);
}
// Sourced into the EXISTING settings-builder plumbing (SettingsManager.inMemory({retry:{...}}));
// the engine honours these knobs when the provider declares no retry profile of its own, which
// is why the real enforcement lives in the custom-layer state below.
function omoRetryEngineRetryKnobs(omoRetryRetry) {
  var omoRetryMax = omoRetryRetry && Number.isSafeInteger(omoRetryRetry.maxRetries) && omoRetryRetry.maxRetries >= 0 ? omoRetryRetry.maxRetries : omoRetryLimits.maxSameFailureRetries;
  var omoRetryBase = omoRetryRetry && Number.isSafeInteger(omoRetryRetry.baseDelayMs) && omoRetryRetry.baseDelayMs >= 0 ? omoRetryRetry.baseDelayMs : omoRetryLimits.baseDelayMs;
  return { maxRetries: omoRetryMax, baseDelayMs: omoRetryBase };
}
function omoRetryCanonical(omoRetryValue, omoRetryDepth) {
  var omoRetryD = "number" == typeof omoRetryDepth ? omoRetryDepth : 0;
  try {
    if (null === omoRetryValue || "object" != typeof omoRetryValue) return JSON.stringify(omoRetryValue) ?? "null";
    if (omoRetryD > 6) return JSON.stringify("[depth]");
    if (Array.isArray(omoRetryValue)) return "[" + omoRetryValue.map(function (omoRetryItem) { return omoRetryCanonical(omoRetryItem, omoRetryD + 1); }).join(",") + "]";
    var omoRetryKeys = Object.keys(omoRetryValue).sort();
    return "{" + omoRetryKeys.map(function (omoRetryKey) { return JSON.stringify(omoRetryKey) + ":" + omoRetryCanonical(omoRetryValue[omoRetryKey], omoRetryD + 1); }).join(",") + "}";
  } catch { return JSON.stringify(String(omoRetryValue)); }
}
// Per-operation identity: tool name + canonical-args digest (the Todo 5 operation signature).
function omoRetryOperationId(omoRetryToolName, omoRetryInput) {
  var omoRetryTool = "string" == typeof omoRetryToolName && omoRetryToolName.length > 0 ? omoRetryToolName : "unknown";
  var omoRetrySignature;
  try { omoRetrySignature = omoRetryCanonical(omoRetryInput, 0); } catch { omoRetrySignature = "{}"; }
  if ("string" != typeof omoRetrySignature) omoRetrySignature = "{}";
  return "tool:" + omoRetryTool + ":" + ogQCreateHash2("sha256").update(omoRetrySignature).digest("hex").slice(0, 32);
}
function omoRetryStateDir(omoRetryOptions) {
  try {
    if (omoRetryOptions && "string" == typeof omoRetryOptions.stateDir && omoRetryOptions.stateDir.length > 0) return omoRetryOptions.stateDir;
    var omoRetryEngine = omoRetryOptions ? omoRetryOptions.engine : undefined;
    if (omoRetryEngine && "string" == typeof omoRetryEngine.stateDir && omoRetryEngine.stateDir.length > 0) return omoRetryEngine.stateDir;
    return undefined;
  } catch { return undefined; }
}
function omoRetrySafeName(omoRetryValue) {
  var omoRetryText = "string" == typeof omoRetryValue && omoRetryValue.length > 0 ? omoRetryValue : "session";
  var omoRetrySafe = omoRetryText.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 96);
  if (omoRetrySafe.length === 0) omoRetrySafe = "session";
  return omoRetrySafe + "-" + ogQCreateHash2("sha256").update(omoRetryText).digest("hex").slice(0, 12);
}
function omoRetryTaskFile(omoRetryState, omoRetryTaskKey) {
  if (undefined === omoRetryState.stateDir) return undefined;
  return ogQJoin2(omoRetryState.stateDir, "retry-budgets", omoRetrySafeName(omoRetryTaskKey) + ".json");
}
function omoRetryEmptyTask(omoRetryTaskKey) {
  return { schema: omoRetrySchema, taskKey: omoRetryTaskKey, budgetEpoch: 0, runEpoch: null, revision: 0, taskRetryAttempts: 0, ops: {}, emitted: {}, fatal: null, duplicates: 0, updatedAtMs: 0, dirty: false };
}
function omoRetryNormalizeTask(omoRetryValue, omoRetryTaskKey) {
  var omoRetryTask = omoRetryEmptyTask(omoRetryTaskKey);
  if (null === omoRetryValue || "object" != typeof omoRetryValue || Array.isArray(omoRetryValue)) return omoRetryTask;
  omoRetryTask.budgetEpoch = "number" == typeof omoRetryValue.budgetEpoch && omoRetryValue.budgetEpoch >= 0 ? Math.floor(omoRetryValue.budgetEpoch) : 0;
  omoRetryTask.runEpoch = "number" == typeof omoRetryValue.runEpoch && omoRetryValue.runEpoch >= 0 ? Math.floor(omoRetryValue.runEpoch) : null;
  omoRetryTask.revision = "number" == typeof omoRetryValue.revision && omoRetryValue.revision >= 0 ? Math.floor(omoRetryValue.revision) : 0;
  omoRetryTask.taskRetryAttempts = "number" == typeof omoRetryValue.taskRetryAttempts && omoRetryValue.taskRetryAttempts >= 0 ? Math.floor(omoRetryValue.taskRetryAttempts) : 0;
  var omoRetryOps = null !== omoRetryValue.ops && "object" == typeof omoRetryValue.ops && !Array.isArray(omoRetryValue.ops) ? omoRetryValue.ops : {};
  var omoRetryKept = 0;
  for (var omoRetryOpId of Object.keys(omoRetryOps)) {
    if (omoRetryKept >= omoRetryMaxOps) break;
    var omoRetryOp = omoRetryOps[omoRetryOpId];
    if (null === omoRetryOp || "object" != typeof omoRetryOp) continue;
    omoRetryKept += 1;
    omoRetryTask.ops[omoRetryOpId] = {
      executions: "number" == typeof omoRetryOp.executions && omoRetryOp.executions >= 0 ? Math.floor(omoRetryOp.executions) : 0,
      failures: "number" == typeof omoRetryOp.failures && omoRetryOp.failures >= 0 ? Math.floor(omoRetryOp.failures) : 0,
      lastFailureAtMs: "number" == typeof omoRetryOp.lastFailureAtMs && omoRetryOp.lastFailureAtMs > 0 ? omoRetryOp.lastFailureAtMs : 0,
      lastSuccessAtMs: "number" == typeof omoRetryOp.lastSuccessAtMs && omoRetryOp.lastSuccessAtMs > 0 ? omoRetryOp.lastSuccessAtMs : 0,
      closed: !0 === omoRetryOp.closed
    };
  }
  var omoRetryEmitted = null !== omoRetryValue.emitted && "object" == typeof omoRetryValue.emitted && !Array.isArray(omoRetryValue.emitted) ? omoRetryValue.emitted : {};
  for (var omoRetryEmitKey of Object.keys(omoRetryEmitted)) {
    if ("number" == typeof omoRetryEmitted[omoRetryEmitKey]) omoRetryTask.emitted[omoRetryEmitKey] = omoRetryEmitted[omoRetryEmitKey];
  }
  if (null !== omoRetryValue.fatal && "object" == typeof omoRetryValue.fatal) {
    omoRetryTask.fatal = {
      cause: "string" == typeof omoRetryValue.fatal.cause ? omoRetryValue.fatal.cause : "trusted_loader_enoent",
      chunk: "string" == typeof omoRetryValue.fatal.chunk ? omoRetryValue.fatal.chunk : null,
      bundleDir: "string" == typeof omoRetryValue.fatal.bundleDir ? omoRetryValue.fatal.bundleDir : null,
      matched: "string" == typeof omoRetryValue.fatal.matched ? omoRetryValue.fatal.matched : null,
      source: "string" == typeof omoRetryValue.fatal.source ? omoRetryValue.fatal.source : null,
      atMs: "number" == typeof omoRetryValue.fatal.atMs && omoRetryValue.fatal.atMs > 0 ? omoRetryValue.fatal.atMs : 0
    };
  }
  omoRetryTask.duplicates = "number" == typeof omoRetryValue.duplicates && omoRetryValue.duplicates >= 0 ? Math.floor(omoRetryValue.duplicates) : 0;
  return omoRetryTask;
}
function omoRetryLoadTask(omoRetryState, omoRetryTaskKey) {
  var omoRetryCached = omoRetryState.tasks.get(omoRetryTaskKey);
  if (undefined !== omoRetryCached) return omoRetryCached;
  var omoRetryTask = omoRetryEmptyTask(omoRetryTaskKey);
  var omoRetryFile = omoRetryTaskFile(omoRetryState, omoRetryTaskKey);
  if (undefined !== omoRetryFile) {
    try {
      if (ogQExistsSync2(omoRetryFile)) omoRetryTask = omoRetryNormalizeTask(JSON.parse(ogQReadFileSync2(omoRetryFile, "utf8")), omoRetryTaskKey);
    } catch { omoRetryTask = omoRetryEmptyTask(omoRetryTaskKey); } // a malformed budget file is ignored, never fatal
  }
  omoRetryState.tasks.set(omoRetryTaskKey, omoRetryTask);
  return omoRetryTask;
}
function omoRetryFlushTask(omoRetryState, omoRetryTask) {
  if (!0 !== omoRetryTask.dirty) return false;
  var omoRetryFile = omoRetryTaskFile(omoRetryState, omoRetryTask.taskKey);
  if (undefined === omoRetryFile) return false;
  try {
    ogQMkdirSync2(ogQDirname2(omoRetryFile), { recursive: true });
    var omoRetryNext = {
      schema: omoRetrySchema, taskKey: omoRetryTask.taskKey, budgetEpoch: omoRetryTask.budgetEpoch, runEpoch: omoRetryTask.runEpoch,
      revision: (omoRetryTask.revision ?? 0) + 1, taskRetryAttempts: omoRetryTask.taskRetryAttempts, ops: omoRetryTask.ops,
      emitted: omoRetryTask.emitted, fatal: omoRetryTask.fatal, duplicates: omoRetryTask.duplicates, updatedAtMs: omoRetryNow()
    };
    var omoRetryTemp = omoRetryFile + "." + process.pid + "." + (omoRetryWriteSeq += 1) + ".tmp";
    try {
      ogQWriteFileSync2(omoRetryTemp, JSON.stringify(omoRetryNext) + "\n", "utf8");
      ogQRenameSync2(omoRetryTemp, omoRetryFile);
    } catch { try { ogQRmSync2(omoRetryTemp, { force: true }); } catch {} return false; }
    omoRetryTask.revision = omoRetryNext.revision;
    omoRetryTask.updatedAtMs = omoRetryNext.updatedAtMs;
    omoRetryTask.dirty = false;
    omoRetryState.writes = (omoRetryState.writes ?? 0) + 1;
    return true;
  } catch { return false; }
}
function omoRetryFlushAll(omoRetryState) {
  try { for (var omoRetryTask of omoRetryState.tasks.values()) omoRetryFlushTask(omoRetryState, omoRetryTask); } catch {}
}
function omoRetryCreateState(omoRetryOptions) {
  var omoRetryDir = omoRetryOptions ? omoRetryStateDir(omoRetryOptions) : undefined;
  return { schema: omoRetrySchema, stateDir: omoRetryDir, registeredChunks: omoRetryOptions ? omoRetryOptions.registeredChunks : undefined, tasks: new Map(), inflight: new Map(), writes: 0, installed: false };
}
function omoRetryEmit(omoRetrySink, omoRetryEvent) {
  try { if (omoRetrySink && "function" == typeof omoRetrySink.emit) { omoRetrySink.emit(omoRetryEvent); return true; } } catch {}
  return false;
}
// Exactly-once terminal emission per (key, budgetEpoch): the emitted set persists, so a
// restarted process or a duplicate delivery can never emit the same terminal cause twice.
function omoRetryEmitOnce(omoRetryState, omoRetryTask, omoRetrySink, omoRetryDedupeKey, omoRetryEvent) {
  if (undefined !== omoRetryTask.emitted[omoRetryDedupeKey]) return false; // budgetEpoch 0 is a valid recorded value
  omoRetryTask.emitted[omoRetryDedupeKey] = omoRetryTask.budgetEpoch;
  omoRetryTask.dirty = true;
  omoRetryEmit(omoRetrySink, omoRetryEvent);
  omoRetryFlushTask(omoRetryState, omoRetryTask);
  return true;
}
function omoRetryBudgetTerminalEvent(omoRetryTask, omoRetryScope, omoRetryOpId, omoRetryTool, omoRetryOp, omoRetryAtMs) {
  var omoRetryFailures = omoRetryOp ? omoRetryOp.failures : omoRetryLimits.maxSameFailureRetries + 1;
  return {
    type: "retry_budget_exhausted",
    payload: {
      taskKey: omoRetryTask.taskKey, scope: omoRetryScope, opId: omoRetryOpId ?? null, tool: omoRetryTool ?? null,
      budgetEpoch: omoRetryTask.budgetEpoch, runEpoch: omoRetryTask.runEpoch,
      executions: omoRetryOp ? omoRetryOp.executions : null, failures: omoRetryOp ? omoRetryOp.failures : null,
      maxSameFailureRetries: omoRetryLimits.maxSameFailureRetries, maxTaskRetryAttempts: omoRetryLimits.maxTaskRetryAttempts,
      taskRetryAttempts: omoRetryTask.taskRetryAttempts, retryAfterMs: omoRetryBackoffMs(omoRetryFailures, 0),
      terminal: true, reason: omoRetryScope === "task" ? "task-retry-attempt-budget" : "same-operation-retry-budget", atMs: omoRetryAtMs
    }
  };
}
function omoRetryFatalEvent(omoRetryTask, omoRetryFatal, omoRetrySource, omoRetryAtMs) {
  return {
    type: "retry_fatal",
    payload: {
      taskKey: omoRetryTask.taskKey, cause: omoRetryFatal.cause, chunk: omoRetryFatal.chunk ?? null, bundleDir: omoRetryFatal.bundleDir ?? null,
      matched: omoRetryFatal.matched ?? null, source: omoRetrySource, substitution: "refused",
      budgetEpoch: omoRetryTask.budgetEpoch, runEpoch: omoRetryTask.runEpoch, terminal: true, reason: "trusted-loader-enoent", atMs: omoRetryAtMs
    }
  };
}
// ---- trusted-loader ENOENT classification ---------------------------------------------------
// Collects text from the shapes an engine failure actually carries (error message/cause/stack,
// tool_result content/details) and looks for the senpi chunk-graph path shape. Fatal only when
// the chunk is in the registered graph (Todo 9's capture supplies it) or, absent that, when the
// named chunk is proven missing on disk under the same deployment root. An ordinary missing
// project file never matches the chunk shape and stays recoverable.
function omoRetryCollectText(omoRetryValue, omoRetryOut, omoRetryDepth) {
  var omoRetryD = "number" == typeof omoRetryDepth ? omoRetryDepth : 0;
  try {
    if (omoRetryOut.length > 64 || omoRetryD > 6) return omoRetryOut;
    if ("string" == typeof omoRetryValue) { if (omoRetryValue.length > 0) omoRetryOut.push(omoRetryValue.slice(0, 2000)); return omoRetryOut; }
    if (null === omoRetryValue || "object" != typeof omoRetryValue) return omoRetryOut;
    if (Array.isArray(omoRetryValue)) { for (var omoRetryI = 0; omoRetryI < omoRetryValue.length; omoRetryI += 1) omoRetryCollectText(omoRetryValue[omoRetryI], omoRetryOut, omoRetryD + 1); return omoRetryOut; }
    for (var omoRetryKey of Object.keys(omoRetryValue)) {
      if ("message" === omoRetryKey || "cause" === omoRetryKey || "stack" === omoRetryKey || "content" === omoRetryKey || "details" === omoRetryKey || "text" === omoRetryKey || "error" === omoRetryKey || "path" === omoRetryKey) omoRetryCollectText(omoRetryValue[omoRetryKey], omoRetryOut, omoRetryD + 1);
    }
    return omoRetryOut;
  } catch { return omoRetryOut; }
}
function omoRetryTrustedLoaderEnoent(omoRetryValue, omoRetryRegisteredChunks) {
  try {
    var omoRetryTexts = omoRetryCollectText(omoRetryValue, [], 0);
    var omoRetryJoined = omoRetryTexts.join("\n");
    if (!/ENOENT/i.test(omoRetryJoined)) return undefined;
    for (var omoRetryI = 0; omoRetryI < omoRetryTexts.length; omoRetryI += 1) {
      var omoRetryText = omoRetryTexts[omoRetryI];
      var omoRetryHit = omoRetryChunkPattern.exec(omoRetryText);
      if (null === omoRetryHit) continue;
      var omoRetryChunk = omoRetryHit[1];
      var omoRetryRoot = /([A-Za-z]:[\\/][^"'\r\n]*)$/.exec(omoRetryText.slice(Math.max(0, omoRetryHit.index - 512), omoRetryHit.index));
      var omoRetryBundleDir = null === omoRetryRoot ? null : omoRetryRoot[1].replace(/[\\/]+$/, "");
      var omoRetryRegistered = undefined;
      try {
        if (omoRetryRegisteredChunks !== undefined && omoRetryRegisteredChunks !== null) {
          if ("function" == typeof omoRetryRegisteredChunks.has) omoRetryRegistered = !0 === omoRetryRegisteredChunks.has(omoRetryChunk);
          else if (Array.isArray(omoRetryRegisteredChunks)) omoRetryRegistered = omoRetryRegisteredChunks.indexOf(omoRetryChunk) !== -1;
        }
      } catch {}
      var omoRetryAbsent = undefined;
      if (null !== omoRetryBundleDir) {
        try { omoRetryAbsent = !ogQExistsSync2(ogQJoin2(omoRetryBundleDir, "dist", "bundle", "chunks", omoRetryChunk)); } catch {}
      }
      var omoRetryMatched = !0 === omoRetryRegistered ? "registered-graph" : !0 === omoRetryAbsent ? "absent-on-disk" : undefined;
      if (undefined === omoRetryMatched) continue;
      return { cause: "trusted_loader_enoent", chunk: omoRetryChunk, bundleDir: omoRetryBundleDir, matched: omoRetryMatched, evidence: omoRetryText.slice(0, 240) };
    }
    return undefined;
  } catch { return undefined; }
}
// ---- engine gate rejection classification ---------------------------------------------------
// A tool result the engine refused at its own gate carries a bracketed gate marker with
// retry=retry-after-input or retry=never-retry. That is a policy refusal, not a failed execution
// of the caller's operation: it is never counted as a failure, never closes the identity and
// never charges the task retry budget. Absent the marker a result counts exactly as before; a
// trusted-loader ENOENT is classified before this check and still latches fatal.
var omoRetryGatePattern = /\[[A-Z][A-Z0-9_]{3,63}\] retry=(retry-after-input|never-retry)(?:;|$)/;
function omoRetryIsGateRejection(omoRetryValue) {
  try {
    var omoRetryTexts = omoRetryCollectText(omoRetryValue, [], 0);
    for (var omoRetryI = 0; omoRetryI < omoRetryTexts.length; omoRetryI += 1) {
      var omoRetryHit = omoRetryGatePattern.exec(omoRetryTexts[omoRetryI]);
      if (null !== omoRetryHit) return { marker: omoRetryHit[0], retry: omoRetryHit[1] };
    }
    return undefined;
  } catch { return undefined; }
}
// Launch-path fast-fail (spliced into the fallback-decision head, beta.84 name #ae): a trusted-loader ENOENT ends the launch operation
// with one structured terminal cause on the task record instead of a fallback replay.
function omoRetryLaunchFatal(omoRetryStore, omoRetryRecord, omoRetryError) {
  try {
    if (omoRetryStore === undefined || omoRetryError === undefined) return false;
    var omoRetryFatal = omoRetryTrustedLoaderEnoent(omoRetryError, undefined);
    if (undefined === omoRetryFatal) return false;
    var omoRetryTaskId = omoRetryRecord && "string" == typeof omoRetryRecord.task_id && omoRetryRecord.task_id.length > 0 ? omoRetryRecord.task_id : "unknown";
    var omoRetryLatchKey = omoRetryTaskId + "|" + omoRetryFatal.chunk;
    if (!0 !== omoRetryLaunchLatches[omoRetryLatchKey]) {
      omoRetryLaunchLatches[omoRetryLatchKey] = true;
      try {
        if ("function" == typeof omoRetryStore.appendEvent) omoRetryStore.appendEvent(omoRetryTaskId, { type: "retry_fatal", payload: { taskKey: omoRetryTaskId, cause: omoRetryFatal.cause, chunk: omoRetryFatal.chunk, bundleDir: omoRetryFatal.bundleDir, matched: omoRetryFatal.matched, source: "launch", substitution: "refused", terminal: true, reason: "trusted-loader-enoent", atMs: omoRetryNow() } });
      } catch {}
    }
    return true;
  } catch { return false; }
}
// ---- tool dispatcher admission --------------------------------------------------------------
function omoRetryTaskKeyFrom(omoRetryOptions) {
  try {
    if (omoRetryOptions && "function" == typeof omoRetryOptions.taskKey) { var omoRetryComputed = omoRetryOptions.taskKey(); if ("string" == typeof omoRetryComputed && omoRetryComputed.length > 0) return omoRetryComputed; }
    var omoRetryEngine = omoRetryOptions ? omoRetryOptions.engine : undefined;
    if (omoRetryEngine && omoRetryEngine.runtime && "function" == typeof omoRetryEngine.runtime.sessionId) { var omoRetryId = omoRetryEngine.runtime.sessionId(); if ("string" == typeof omoRetryId && omoRetryId.length > 0) return omoRetryId; }
  } catch {}
  return "session";
}
function omoRetryInflightFor(omoRetryState, omoRetryTaskKey) {
  var omoRetryMap = omoRetryState.inflight.get(omoRetryTaskKey);
  if (undefined === omoRetryMap) { omoRetryMap = new Map(); omoRetryState.inflight.set(omoRetryTaskKey, omoRetryMap); }
  return omoRetryMap;
}
function omoRetryDeferred() {
  var omoRetryResolve;
  var omoRetryPromise = new Promise(function (omoRetryR) { omoRetryResolve = omoRetryR; });
  return { promise: omoRetryPromise, resolve: omoRetryResolve };
}
function omoRetryBlockReason(omoRetryReason, omoRetryExtra) {
  return omoRetryExtra === undefined ? omoRetryReason : omoRetryReason + ":" + omoRetryExtra;
}
// The tool_call hook handler. Returns undefined to admit one execution, or
// {block:true, reason} to refuse it (the engine then throws ExecuteToolError("blocked")).
async function omoRetryToolCall(omoRetryState, omoRetryOptions) {
  try {
    var omoRetryEvent = omoRetryOptions ? omoRetryOptions.event : undefined;
    if (undefined === omoRetryEvent || null === omoRetryEvent) return undefined;
    var omoRetryTaskKey = omoRetryTaskKeyFrom(omoRetryOptions);
    var omoRetryTask = omoRetryLoadTask(omoRetryState, omoRetryTaskKey);
    var omoRetryNowMs = omoRetryOptions && "number" == typeof omoRetryOptions.nowMs ? omoRetryOptions.nowMs : omoRetryNow();
    var omoRetrySink = omoRetryOptions ? omoRetryOptions.sink : undefined;
    if (null !== omoRetryTask.fatal) {
      return { block: true, reason: omoRetryBlockReason("retry_fatal_latched", omoRetryTask.fatal.cause + ":" + (omoRetryTask.fatal.chunk ?? "unknown") + "; substitution refused") };
    }
    var omoRetryOpId = omoRetryOperationId(omoRetryEvent.toolName, omoRetryEvent.input);
    var omoRetryCallId = "string" == typeof omoRetryEvent.toolCallId && omoRetryEvent.toolCallId.length > 0 ? omoRetryEvent.toolCallId : omoRetryOpId;
    var omoRetryMap = omoRetryInflightFor(omoRetryState, omoRetryTaskKey);
    if (undefined !== omoRetryMap.get(omoRetryCallId)) return { block: true, reason: omoRetryBlockReason("retry_duplicate_delivery", omoRetryOpId) };
    var omoRetryParallel;
    for (var omoRetryEntry of omoRetryMap.values()) { if (omoRetryEntry.opId === omoRetryOpId) { omoRetryParallel = omoRetryEntry; break; } }
    if (undefined !== omoRetryParallel) {
      // Serialize parallel duplicates of one identity: wait for the in-flight execution to
      // settle, then re-evaluate admission against the settled state.
      try { await omoRetryParallel.settled.promise; } catch {}
      if (null !== omoRetryTask.fatal) {
        return { block: true, reason: omoRetryBlockReason("retry_fatal_latched", omoRetryTask.fatal.cause + ":" + (omoRetryTask.fatal.chunk ?? "unknown") + "; substitution refused") };
      }
    }
    var omoRetryOp = omoRetryTask.ops[omoRetryOpId];
    if (undefined === omoRetryOp) { omoRetryOp = { executions: 0, failures: 0, lastFailureAtMs: 0, lastSuccessAtMs: 0, closed: false }; omoRetryTask.ops[omoRetryOpId] = omoRetryOp; }
    if (!0 === omoRetryOp.closed || omoRetryOp.failures > omoRetryLimits.maxSameFailureRetries) {
      omoRetryOp.closed = true;
      omoRetryTask.dirty = true;
      omoRetryEmitOnce(omoRetryState, omoRetryTask, omoRetrySink, "op:" + omoRetryOpId, omoRetryBudgetTerminalEvent(omoRetryTask, "operation", omoRetryOpId, omoRetryEvent.toolName, omoRetryOp, omoRetryNowMs));
      return { block: true, reason: omoRetryBlockReason("retry_budget_exhausted", omoRetryOpId + ":retryAfterMs=" + omoRetryBackoffMs(omoRetryOp.failures, 0)) };
    }
    if (omoRetryOp.executions > 0) {
      if (omoRetryTask.taskRetryAttempts >= omoRetryLimits.maxTaskRetryAttempts) {
        omoRetryTask.dirty = true;
        omoRetryEmitOnce(omoRetryState, omoRetryTask, omoRetrySink, "task:" + omoRetryTask.budgetEpoch, omoRetryBudgetTerminalEvent(omoRetryTask, "task", omoRetryOpId, omoRetryEvent.toolName, omoRetryOp, omoRetryNowMs));
        return { block: true, reason: omoRetryBlockReason("retry_task_budget_exhausted", String(omoRetryTask.taskRetryAttempts)) };
      }
      if (omoRetryOp.failures > 0) { omoRetryTask.taskRetryAttempts += 1; }
    }
    omoRetryOp.executions += 1;
    var omoRetryDefer = omoRetryDeferred();
    omoRetryMap.set(omoRetryCallId, { opId: omoRetryOpId, tool: omoRetryEvent.toolName ?? null, settled: omoRetryDefer });
    omoRetryTask.dirty = true;
    omoRetryFlushTask(omoRetryState, omoRetryTask);
    return undefined;
  } catch { return undefined; } // the policy must never break tool dispatch
}
// The tool_result hook handler: records the outcome of an admitted execution. A result without
// a matching in-flight admission is a duplicate delivery and is never counted.
function omoRetryToolResult(omoRetryState, omoRetryOptions) {
  try {
    var omoRetryEvent = omoRetryOptions ? omoRetryOptions.event : undefined;
    if (undefined === omoRetryEvent || null === omoRetryEvent) return { counted: false, reason: "no-event" };
    var omoRetryTaskKey = omoRetryTaskKeyFrom(omoRetryOptions);
    var omoRetryTask = omoRetryLoadTask(omoRetryState, omoRetryTaskKey);
    var omoRetryNowMs = omoRetryOptions && "number" == typeof omoRetryOptions.nowMs ? omoRetryOptions.nowMs : omoRetryNow();
    var omoRetrySink = omoRetryOptions ? omoRetryOptions.sink : undefined;
    var omoRetryOpId = omoRetryOperationId(omoRetryEvent.toolName, omoRetryEvent.input);
    var omoRetryCallId = "string" == typeof omoRetryEvent.toolCallId && omoRetryEvent.toolCallId.length > 0 ? omoRetryEvent.toolCallId : omoRetryOpId;
    var omoRetryMap = omoRetryInflightFor(omoRetryState, omoRetryTaskKey);
    var omoRetryExisting = omoRetryMap.get(omoRetryCallId);
    if (undefined === omoRetryExisting) {
      omoRetryTask.duplicates += 1;
      omoRetryTask.dirty = true;
      omoRetryFlushTask(omoRetryState, omoRetryTask);
      return { counted: false, duplicate: true, opId: omoRetryOpId };
    }
    omoRetryMap.delete(omoRetryCallId);
    try { omoRetryExisting.settled.resolve(true); } catch {}
    var omoRetryOp = omoRetryTask.ops[omoRetryExisting.opId];
    if (undefined === omoRetryOp) { omoRetryOp = { executions: 1, failures: 0, lastFailureAtMs: 0, lastSuccessAtMs: 0, closed: false }; omoRetryTask.ops[omoRetryExisting.opId] = omoRetryOp; }
    if (!0 === omoRetryEvent.isError) {
      var omoRetryFatal = omoRetryTrustedLoaderEnoent(omoRetryEvent, omoRetryOptions ? omoRetryOptions.registeredChunks : undefined);
      if (undefined !== omoRetryFatal) {
        omoRetryTask.fatal = { cause: omoRetryFatal.cause, chunk: omoRetryFatal.chunk, bundleDir: omoRetryFatal.bundleDir, matched: omoRetryFatal.matched, source: "tool", atMs: omoRetryNowMs };
        omoRetryTask.dirty = true;
        omoRetryEmitOnce(omoRetryState, omoRetryTask, omoRetrySink, "fatal:" + omoRetryFatal.chunk, omoRetryFatalEvent(omoRetryTask, omoRetryTask.fatal, "tool", omoRetryNowMs));
        return { counted: true, fatal: true, opId: omoRetryExisting.opId, chunk: omoRetryFatal.chunk };
      }
      var omoRetryGate = omoRetryIsGateRejection(omoRetryEvent);
      if (undefined !== omoRetryGate) {
        omoRetryTask.dirty = true;
        omoRetryFlushTask(omoRetryState, omoRetryTask);
        return { counted: false, gate: true, opId: omoRetryExisting.opId };
      }
      omoRetryOp.failures += 1;
      omoRetryOp.lastFailureAtMs = omoRetryNowMs;
      if (omoRetryOp.failures > omoRetryLimits.maxSameFailureRetries) {
        omoRetryOp.closed = true;
        omoRetryTask.dirty = true;
        // One terminal budget event per operation identity per budgetEpoch, emitted the moment
        // the third failed execution lands (never on unrelated success or duplicate delivery).
        omoRetryEmitOnce(omoRetryState, omoRetryTask, omoRetrySink, "op:" + omoRetryExisting.opId, omoRetryBudgetTerminalEvent(omoRetryTask, "operation", omoRetryExisting.opId, omoRetryExisting.tool, omoRetryOp, omoRetryNowMs));
      }
      omoRetryTask.dirty = true;
      omoRetryFlushTask(omoRetryState, omoRetryTask);
      return { counted: true, opId: omoRetryExisting.opId, failures: omoRetryOp.failures, executions: omoRetryOp.executions, closed: omoRetryOp.closed };
    }
    // Same-identity success resets only that identity's failure counter; an unrelated success
    // never touches a failing operation's counter.
    omoRetryOp.failures = 0;
    omoRetryOp.closed = false;
    omoRetryOp.lastSuccessAtMs = omoRetryNowMs;
    omoRetryTask.dirty = true;
    omoRetryFlushTask(omoRetryState, omoRetryTask);
    return { counted: true, opId: omoRetryExisting.opId, failures: 0, executions: omoRetryOp.executions };
  } catch { return { counted: false, error: "internal" }; }
}
// run_epoch correlation is recorded WITHOUT touching budgetEpoch or any counter: the budget
// epoch advances only through omoRetryReset.
function omoRetryNoteRunEpoch(omoRetryState, omoRetryTaskKey, omoRetryRunEpoch) {
  try {
    var omoRetryTask = omoRetryLoadTask(omoRetryState, omoRetryTaskKey);
    if ("number" == typeof omoRetryRunEpoch && omoRetryRunEpoch >= 0 && omoRetryTask.runEpoch !== Math.floor(omoRetryRunEpoch)) {
      omoRetryTask.runEpoch = Math.floor(omoRetryRunEpoch);
      omoRetryTask.dirty = true;
      omoRetryFlushTask(omoRetryState, omoRetryTask);
    }
    return { budgetEpoch: omoRetryTask.budgetEpoch, runEpoch: omoRetryTask.runEpoch, taskRetryAttempts: omoRetryTask.taskRetryAttempts };
  } catch { return undefined; }
}
// The only reset: a new budget generation. Counters, emitted set and fatal latch are cleared
// together, budgetEpoch advances by exactly one.
function omoRetryReset(omoRetryState, omoRetryTaskKey) {
  try {
    var omoRetryTask = omoRetryLoadTask(omoRetryState, omoRetryTaskKey);
    omoRetryTask.budgetEpoch += 1;
    omoRetryTask.taskRetryAttempts = 0;
    omoRetryTask.ops = {};
    omoRetryTask.emitted = {};
    omoRetryTask.fatal = null;
    omoRetryTask.duplicates = 0;
    omoRetryTask.dirty = true;
    omoRetryFlushTask(omoRetryState, omoRetryTask);
    return omoRetryTask.budgetEpoch;
  } catch { return undefined; }
}
function omoRetryDefaultSink(omoRetryPi) {
  return {
    emit: function (omoRetryEvent) {
      try {
        if ("function" == typeof omoRetryPi.sendMessage) omoRetryPi.sendMessage({ customType: "senpi-task.retry-budget", content: "omo retry policy: " + omoRetryEvent.type + (omoRetryEvent.payload && omoRetryEvent.payload.opId ? " " + omoRetryEvent.payload.opId : ""), display: true, details: omoRetryEvent }, {});
      } catch {}
    }
  };
}
// Installs the budget admission on the real tool dispatcher (engine-called hooks) plus the
// outcome observer. Returns false instead of throwing so a failed install can never break the
// extension registration.
function omoRetryInstall(omoRetryPi, omoRetryDeps) {
  try {
    if (undefined === omoRetryPi || null === omoRetryPi || "function" != typeof omoRetryPi.on) return false;
    var omoRetryOptions = omoRetryDeps ?? {};
    var omoRetryState = omoRetryCreateState({ stateDir: omoRetryStateDir(omoRetryOptions), engine: omoRetryOptions.engine, registeredChunks: omoRetryOptions.registeredChunks });
    var omoRetrySink = omoRetryOptions.sink ?? omoRetryDefaultSink(omoRetryPi);
    var omoRetryTaskKey = function () { return omoRetryTaskKeyFrom(omoRetryOptions); };
    var omoRetryHookOptions = function (omoRetryEvent) { return { event: omoRetryEvent, taskKey: omoRetryTaskKey, sink: omoRetrySink, engine: omoRetryOptions.engine, registeredChunks: omoRetryOptions.registeredChunks }; };
    omoRetryPi.on("tool_call", function (omoRetryEvent) { return omoRetryToolCall(omoRetryState, omoRetryHookOptions(omoRetryEvent)); });
    omoRetryPi.on("tool_result", function (omoRetryEvent) { return omoRetryToolResult(omoRetryState, omoRetryHookOptions(omoRetryEvent)); });
    omoRetryPi.on("session_shutdown", function () { omoRetryFlushAll(omoRetryState); });
    omoRetryState.installed = true;
    return true;
  } catch { return false; }
}
// ==== omoRetry:defs:end
