// Pure candidate generator. Imports and transformation never activate a trace.
import { createHash } from "node:crypto";

export const BASELINE_SHA256 = "64112d39dcdc24069e759481c92b420a109c879c6fdaab7087de054d573204c4";
export const TARGET = "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package/plugin/extensions/omo-task.js";
export const MARKER = "/* publication-trace:begin */";
export const END_MARKER = "/* publication-trace:end */";
export const FIXTURE_SELECTOR = Object.freeze({
  taskId: "st_00000001",
  parent: "fixture-parent",
  name: "publication-fixture",
  epoch: 0,
});
export const LIVE_SELECTOR = Object.freeze({
  schema: "publication-probe-live-selector-v1",
  parentSessionId: "67f4ea63-2dbe-4840-a3cf-e81c6c3ed166",
  taskName: "publication-probe01",
  runEpoch: 0,
  maxBindings: 1,
  agentType: "omo-native-qa-executor",
  resolvedModel: "chatgpt-subscription/gpt-6.1-sol",
  reasoning: "medium",
  excludeTaskIds: Object.freeze(["st_01a16774", "st_00000001"]),
  maxTraceRecords: 64,
  postOutcomeCaptureMs: 30000,
});
export const SELECTOR_SHA256 = "cc1048b1b7d90aa751d4ce559e92a719c6e59ba53be8ab5f239a6baeec641341";
export const BUILD_REF = "publication-probe01-n1-r1";
export const MANIFEST_REF = "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/overnight-command-20261023/maintenance-publication-n1-r1-manifest.json";

export function selectorText(value = LIVE_SELECTOR) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (sha256(text) !== SELECTOR_SHA256) throw new PatchError("selector", "Only the exact probe01 selector is supported");
  return text;
}

// Only emitted candidate code calls these native ports. Offline fixtures replace
// the ports, not the producer/outcome or publication code.
export function createNativeTracePorts(fs) {
  const final = "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/overnight-command-20261023/maintenance-publication-probe01-trace-seal.json";
  const stage = final + ".tmp";
  return {
    kind: "native",
    schedule(callback, delay) {
      const timer = setTimeout(callback, delay);
      timer.unref?.();
      return timer;
    },
    writeSeal(receipt) {
      const directory = final.slice(0, final.lastIndexOf("/"));
      const info = fs.lstatSync(directory);
      const normalize = (path) => path.replaceAll("\\", "/").toLowerCase();
      if (!info.isDirectory() || info.isSymbolicLink() ||
          normalize(fs.realpathSync(directory)) !== normalize(directory)) throw new Error("Seal directory is not the fixed regular directory");
      if (fs.existsSync(final) || fs.existsSync(stage)) throw new Error("Seal artifact already exists");
      let fd;
      try {
        fd = fs.openSync(stage, "wx");
        fs.writeFileSync(fd, JSON.stringify(receipt, null, 2) + "\n", "utf8");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        // The live grant must reserve this exact receipt path. Rename is not a
        // compare-and-swap against a non-cooperating concurrent writer.
        if (fs.existsSync(final)) throw new Error("Seal destination changed");
        fs.renameSync(stage, final);
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
      }
    },
  };
}

export class PatchError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "PatchError";
    this.kind = kind;
  }
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function replaceUnique(text, anchor, replacement) {
  const count = text.split(anchor).length - 1;
  if (!anchor || count !== 1) throw new PatchError("anchor", `Expected one anchor, found ${count}`);
  return text.replace(anchor, () => replacement);
}

// Self-contained: this exact function is emitted into, and exercised from, the
// candidate. A fixture selector is intentionally not a live activation API.
export function createPublicationTrace({ fixture = false, liveSelector, ports } = {}) {
  const live = liveSelector !== undefined;
  if (live && (fixture || liveSelector.schema !== "publication-probe-live-selector-v1" ||
      liveSelector.parentSessionId !== "67f4ea63-2dbe-4840-a3cf-e81c6c3ed166" ||
      liveSelector.taskName !== "publication-probe01" || liveSelector.runEpoch !== 0 ||
      liveSelector.maxBindings !== 1 || liveSelector.postOutcomeCaptureMs !== 30000 ||
      liveSelector.agentType !== "omo-native-qa-executor" ||
      liveSelector.resolvedModel !== "chatgpt-subscription/gpt-6.1-sol" ||
      liveSelector.reasoning !== "medium" || liveSelector.maxTraceRecords !== 64 ||
      !Array.isArray(liveSelector.excludeTaskIds) || liveSelector.excludeTaskIds.length !== 2 ||
      liveSelector.excludeTaskIds[0] !== "st_01a16774" || liveSelector.excludeTaskIds[1] !== "st_00000001" ||
      Object.keys(liveSelector).length !== 11)) throw new Error("Invalid compiled live selector");
  const active = fixture || live;
  const selector = live
    ? { parent: liveSelector.parentSessionId, name: liveSelector.taskName, epoch: 0 }
    : { id: "st_00000001", parent: "fixture-parent", name: "publication-fixture", epoch: 0 };
  const excluded = "st_01a16774";
  const ownerPid = process.pid;
  const phases = new Set([
    "CASE_BOUND", "CASE_CLOSED", "REGISTER_ATTEMPT", "REGISTER_ATTACHED",
    "CALLBACK_ENTER", "GUARD_PASS", "GUARD_REJECT", "STOP_AWAIT_BEGIN",
    "STOP_AWAIT_END", "LEASE_BEGIN", "LEASE_RETURN", "ISOLATION_CALL_BEGIN",
    "ISOLATION_CALL_RETURN", "ISOLATION_AWAIT_BEGIN", "ISOLATION_AWAIT_END",
    "TERMINAL_OBSERVER_BEGIN", "TERMINAL_OBSERVER_RETURN", "TERMINAL_STORE_BEGIN",
    "TERMINAL_STORE_RETURN", "TERMINAL_STORE_ERROR", "NOTIFY_DECISION",
    "NOTIFY_ENQUEUE", "EPOCH_BEGIN", "EPOCH_RETURN", "EPOCH_ERROR",
    "TRACKING_ERROR", "REGISTER_ERROR", "TRACE_SEAL",
    "PRODUCER_OUTCOME", "PRODUCER_REJECTED", "SEAL_TIMER_ERROR",
  ]);
  const keys = new Set([
    "handle_token", "live_handle_token", "promise_token", "record_epoch",
    "record_residency", "outcome_status", "has_final_text", "reason",
    "phase_result", "await_kind", "origin_phase", "error_name", "error_code",
    "applied", "event_kind", "case_closed",
  ]);
  const enums = {
    reason: new Set(["PASS", "HANDLE", "MISSING", "PERSISTED", "DETACHED", "EPOCH", "sync-task", "non-notifying-terminal", "already-notified", "not-terminal", "compacting", "session_switching", "session_shutdown"]),
    record_residency: new Set(["resident", "persisted_only", "rpc_detached", "disposed"]),
    outcome_status: new Set(["completed", "error", "cancelled", "interrupted", "lost"]),
    phase_result: new Set(["completed", "error", "cancelled", "interrupted", "lost", "delivered", "buffered", "failed", "skipped", "ACCEPTED", "FAILED"]),
    error_name: new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "AggregateError", "EvalError"]),
    error_code: new Set(["ENOENT", "EACCES", "EINVAL", "EIO", "OTHER"]),
    event_kind: new Set(["start", "complete", "fail", "cancel", "interrupt"]),
  };
  const tokens = new WeakMap();
  let nextToken = 0;
  let state;
  const own = (value, key) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const token = (value) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return "NONE";
    if (!tokens.has(value)) tokens.set(value, `H${++nextToken}`);
    return tokens.get(value);
  };
  const safe = (data) => {
    const result = {};
    for (const key of keys) {
      const value = own(data, key);
      if (["applied", "has_final_text", "case_closed"].includes(key)) {
        if (typeof value === "boolean") result[key] = value;
      } else if (key === "record_epoch") {
        if (Number.isSafeInteger(value)) result[key] = value;
      } else if (key === "origin_phase") {
        if (phases.has(value)) result[key] = value;
      } else if (key.endsWith("_token")) {
        if (typeof value === "string" && /^(H[0-9]{1,8}|NONE)$/.test(value)) result[key] = value;
      } else if (typeof value === "string") {
        result[key] = enums[key]?.has(value) ? value : "OTHER";
      }
    }
    return result;
  };
  function emit(id, epoch, phase, data = {}, sealing = false) {
    if (!active || !state || id !== state.id || epoch !== state.epoch || !phases.has(phase)) return;
    if (live && state.captureEnded) return;
    if (state.sealed) {
      state.dropped++;
      return;
    }
    const seq = ++state.seq;
    if (!sealing && state.written >= 63) {
      state.dropped++;
      return;
    }
    const payload = {
      schema_version: 1, task_id: id, run_epoch: epoch, host_pid: ownerPid,
      seq, timestamp_ms: Date.now(), phase, dropped_count: state.dropped,
      ...safe(data),
    };
    try {
      state.store.appendEvent(id, { type: "publication_trace", payload });
      state.written++;
      state.lastPhase = phase;
      if (sealing) state.sealed = true;
    } catch {
      state.dropped++;
    }
  }
  function error(id, epoch, phase, value) {
    if (!active || !state || (live && state.captureEnded)) return;
    try {
      const name = own(value, "name");
      const code = own(value, "code");
      emit(id, epoch, phase, {
        origin_phase: state.lastPhase ?? "NONE",
        error_name: typeof name === "string" && /^[A-Za-z_]{1,32}$/.test(name) ? name : "Error",
        error_code: ["ENOENT", "EACCES", "EINVAL", "EIO"].includes(code) ? code : "OTHER",
      });
    } catch {
      state.dropped++;
    }
  }
  // Every public probe is fail-open. Descriptor reads do not invoke business
  // getters. Only the original callback accesses their values and order.
  const probe = (fn) => (...args) => {
    if (!active || (live && state?.captureEnded)) return;
    try { return fn(...args); } catch { if (state) state.dropped++; }
  };
  const recordIdentity = (record) => {
    const id = own(record, "task_id");
    const epoch = own(own(record, "notification"), "run_epoch");
    return { id, epoch };
  };
  const health = () => state ? {
    enabled: active, mode: live ? "live" : "fixture", bound: true,
    seq: state.seq, written: state.written, dropped: state.dropped,
    sealed: state.sealed, caseClosed: state.caseClosed,
    nativeOutcomeObserved: state.nativeOutcomeObserved ?? false,
    captureEnded: state.captureEnded ?? false,
    sealWriteFailed: state.sealWriteFailed ?? false,
  } : { enabled: active, mode: live ? "live" : "fixture", bound: false, seq: 0, written: 0, dropped: 0, sealed: false, caseClosed: false };
  function finishLive() {
    if (!state || state.captureEnded) return;
    emit(state.id, state.epoch, "TRACE_SEAL", { case_closed: state.caseClosed }, true);
    state.captureEnded = true;
    try {
      ports.writeSeal({
        schema: "publication-probe01-trace-seal-v1",
        buildRef: "publication-probe01-n1-r1",
        manifestRef: "C:/Users/USER/orca/projects/기타 작업/.omo/evidence/overnight-command-20261023/maintenance-publication-n1-r1-manifest.json",
        provenance: ports.kind === "native" ? "real-native-producer" : "offline-controlled-ports",
        selectorSha256: "cc1048b1b7d90aa751d4ce559e92a719c6e59ba53be8ab5f239a6baeec641341",
        parentSessionId: selector.parent, taskName: selector.name,
        task_id: state.id, run_epoch: state.epoch, host_pid: ownerPid,
        reason: "POST_OUTCOME_CAPTURE_DEADLINE",
        nativeOutcomeStatus: state.nativeOutcomeStatus,
        health: health(),
        nativeCompletionNotificationPass: false,
        memoryHash: "UNKNOWN",
      });
    } catch {
      state.dropped++;
      state.sealWriteFailed = true;
    }
  }
  function observeProducer(id, outcome, rejected) {
    if (!live || !state || id !== state.id || state.nativeOutcomeObserved) return;
    state.nativeOutcomeObserved = true;
    const status = own(outcome, "status");
    const text = own(outcome, "finalResponse");
    state.nativeOutcomeStatus = rejected ? "rejected"
      : ["completed", "error", "cancelled", "interrupted", "lost"].includes(status) ? status : "OTHER";
    emit(id, state.epoch, rejected ? "PRODUCER_REJECTED" : "PRODUCER_OUTCOME", {
      outcome_status: rejected ? undefined : status,
      has_final_text: typeof text === "string" && text.length > 0,
    });
    try {
      ports.schedule(finishLive, 30000);
    } catch (value) {
      error(id, state.epoch, "SEAL_TIMER_ERROR", value);
      state.dropped++;
    }
  }
  return {
    transition: probe((store, result) => {
      const record = own(result, "record");
      if (own(result, "applied") !== true) return;
      const { id, epoch } = recordIdentity(record);
      const newId = live ? typeof id === "string" && /^st_[0-9a-f]{8}$/.test(id) && id !== "st_00000001" : id === selector.id;
      const model = live ? own(record, "resolved_model") : undefined;
      const roleMatches = !live || (own(record, "agent_type") === "omo-native-qa-executor" &&
        own(model, "provider") === "chatgpt-subscription" && own(model, "model_id") === "gpt-6.1-sol" &&
        own(model, "reasoning_effort") === "medium");
      if (!state && newId && id !== excluded && roleMatches &&
          own(record, "parent_session_id") === selector.parent &&
          own(record, "name") === selector.name && epoch === selector.epoch &&
          own(record, "host_pid") === ownerPid && own(record, "status") === "running") {
        state = { id, epoch, store, seq: 0, written: 0, dropped: 0, sealed: false, caseClosed: false };
        emit(id, epoch, "CASE_BOUND");
      }
      if (state && id === state.id && epoch === state.epoch &&
          ["completed", "error", "cancelled", "interrupted", "lost"].includes(own(record, "status"))) {
        state.caseClosed = true;
        emit(id, epoch, "CASE_CLOSED", { phase_result: own(record, "status"), case_closed: true });
      }
    }),
    event: probe((id, epoch, phase, data) => emit(id, epoch, phase, data)),
    outcome: probe((id, epoch, outcome) => {
      const text = own(outcome, "finalResponse");
      emit(id, epoch, "CALLBACK_ENTER", {
        outcome_status: own(outcome, "status"),
        has_final_text: typeof text === "string" && text.length > 0,
      });
    }),
    producerOutcome: probe((id, outcome) => observeProducer(id, outcome, false)),
    producerRejected: probe((id, value) => observeProducer(id, value, true)),
    guard: probe((id, epoch, reason, expected, actual, residency, observedEpoch) => {
      emit(id, epoch, reason === "PASS" ? "GUARD_PASS" : "GUARD_REJECT", {
        reason, handle_token: token(expected), live_handle_token: token(actual),
        record_residency: residency, record_epoch: observedEpoch,
      });
    }),
    error: probe(error),
    storeReturn: probe((id, result) => {
      if (state) emit(id, state.epoch, "TERMINAL_STORE_RETURN", { applied: own(result, "applied") });
    }),
    observer: probe((id, phase) => { if (state) emit(id, state.epoch, phase); }),
    storeError: probe((id, value) => { if (state) error(id, state.epoch, "TERMINAL_STORE_ERROR", value); }),
    decision: probe((record, result) => {
      const { id, epoch } = recordIdentity(record);
      emit(id, epoch, "NOTIFY_DECISION", { phase_result: own(result, "kind"), reason: own(result, "reason") });
    }),
    enqueue: probe((record, accepted) => {
      const { id, epoch } = recordIdentity(record);
      emit(id, epoch, "NOTIFY_ENQUEUE", { phase_result: accepted ? "ACCEPTED" : "FAILED" });
    }),
    register(id, epoch, handle, attach) {
      emit(id, epoch, "REGISTER_ATTEMPT", { handle_token: token(handle) });
      try {
        const promise = handle.waitForOutcome();
        const result = attach(promise);
        emit(id, epoch, "REGISTER_ATTACHED", { handle_token: token(handle), promise_token: token(promise) });
        return result;
      } catch (value) {
        error(id, epoch, "REGISTER_ERROR", value);
        throw value;
      }
    },
    // Deliberately unavailable as a live close operation.
    seal: probe(() => {
      if (!live && state && !state.sealed) emit(state.id, state.epoch, "TRACE_SEAL", { case_closed: state.caseClosed }, true);
    }),
    health,
  };
}

export function assessTrace(events, health) {
  const records = events.filter((event) => event.type === "publication_trace").map((event) => event.payload);
  const complete = health?.bound && health.sealed && health.dropped === 0 &&
    records.length === health.written && records.length === health.seq &&
    records.every((record, index) => record.seq === index + 1 && record.dropped_count === 0) &&
    records.at(-1)?.phase === "TRACE_SEAL";
  if (!complete) return { classification: "UNKNOWN", coverage: false };
  const phases = records.map((record) => record.phase);
  const failure = records.find((record) => ["REGISTER_ERROR", "TRACKING_ERROR", "TERMINAL_STORE_ERROR", "EPOCH_ERROR"].includes(record.phase));
  if (failure) return { classification: "THROWN_ERROR_AT_PHASE", phase: failure.origin_phase, coverage: true };
  if (!phases.includes("REGISTER_ATTACHED")) {
    if (health.mode === "live" && health.nativeOutcomeObserved) {
      return { classification: "REGISTRATION_NOT_OBSERVED_IN_CAPTURE_WINDOW", coverage: true };
    }
    return health.caseClosed ? { classification: "CALLBACK_NOT_ARMED_IN_CAPTURED_WINDOW", coverage: true }
      : { classification: "UNKNOWN", coverage: false };
  }
  const rejection = records.find((record) => record.phase === "GUARD_REJECT");
  if (rejection) return { classification: "GUARD_REJECTION", reason: rejection.reason, coverage: true };
  for (const prefix of ["STOP", "ISOLATION"]) {
    if (phases.includes(`${prefix}_AWAIT_BEGIN`) && !phases.includes(`${prefix}_AWAIT_END`)) {
      return { classification: "PENDING_EXISTING_AWAIT_AT_OBSERVATION", phase: prefix, coverage: true };
    }
  }
  return health.caseClosed && phases.includes("TERMINAL_STORE_RETURN")
    ? { classification: "PUBLISHED_NOTIFICATION_STAGE", coverage: true }
    : { classification: "UNKNOWN", coverage: false };
}

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new PatchError("anchor", "Missing method boundary");
  return source.slice(from, to);
}

export function transformText(source, options = {}) {
  if (Object.keys(options).some((key) => !["fixture", "liveSelector"].includes(key)) ||
      (options.fixture !== undefined && typeof options.fixture !== "boolean")) {
    throw new PatchError("selector", "Unsupported selector option");
  }
  if (options.liveSelector !== undefined) {
    if (options.fixture) throw new PatchError("selector", "Fixture and live are mutually exclusive");
    selectorText(options.liveSelector);
  }
  if (source.includes(MARKER)) throw new PatchError("partial", "Refuse an already instrumented input");
  if (sha256(source) !== BASELINE_SHA256) throw new PatchError("baseline", "Pinned source hash mismatch");
  const edits = [];
  const add = (anchor, replacement) => edits.push([anchor, replacement]);
  add('function hF(e,t,n="final-text"){let r=', 'function hF(e,t,n="final-text"){const __pubTaskId=e;let r=');
  add('}(t,e,()=>r,a,n),s.then(()=>{o=!1},()=>{o=!1})};return((__coordTurn)=>{',
    '}(t,e,()=>r,a,n),s.then(__pubOutcome=>{o=!1;__pubTrace.producerOutcome(__pubTaskId,__pubOutcome)},__pubError=>{o=!1;__pubTrace.producerRejected(__pubTaskId,__pubError)})};return((__coordTurn)=>{');
  const guard = 'function JH(e,t,n,r){if(e.liveHandle(t)!==n)return null;let i=e.tryLoad(t);return null===i||"persisted_only"===i.residency_state||"rpc_detached"===i.residency_state||i.notification.run_epoch!==r?null:i}';
  add(guard, 'function JH(e,t,n,r){let __live=e.liveHandle(t);if(__live!==n){__pubTrace.guard(t,r,"HANDLE",n,__live);return null}let i=e.tryLoad(t);if(null===i){__pubTrace.guard(t,r,"MISSING",n,__live);return null}let __s1=i.residency_state;if("persisted_only"===__s1){__pubTrace.guard(t,r,"PERSISTED",n,__live,__s1);return null}let __s2=i.residency_state;if("rpc_detached"===__s2){__pubTrace.guard(t,r,"DETACHED",n,__live,__s2);return null}let __epoch=i.notification.run_epoch;if(__epoch!==r){__pubTrace.guard(t,r,"EPOCH",n,__live,__s2,__epoch);return null}__pubTrace.guard(t,r,"PASS",n,__live,__s2,__epoch);return i}');
  add('i.waitForOutcome().then(async o=>{', '__pubTrace.register(r,l,i,__pubPromise=>__pubPromise.then(async o=>{__pubTrace.outcome(r,l,o);');
  add('.catch(e=>zm("senpi-task manager outcome tracking failed",{taskId:r,error:String(e)}))',
    '.catch(__pubError=>{__pubTrace.error(r,l,"TRACKING_ERROR",__pubError);return zm("senpi-task manager outcome tracking failed",{taskId:r,error:String(__pubError)})}))');
  add('async function d(t,r,i,o,s){await s;let a=JH(e,t,r,o)',
    'async function d(t,r,i,o,s){__pubTrace.event(t,o,"STOP_AWAIT_BEGIN");await s;__pubTrace.event(t,o,"STOP_AWAIT_END");let a=JH(e,t,r,o)');
  add('e.releaseSlot(t,i,o);let d=e.runStatsSnapshot(t)',
    '__pubTrace.event(t,o,"LEASE_BEGIN");e.releaseSlot(t,i,o);__pubTrace.event(t,o,"LEASE_RETURN");let d=e.runStatsSnapshot(t)');
  add('e.releaseSlot(r,s,l);let f=ZH(e,c,"completed"===o.status&&o.finalResponse.length>0);void 0!==f&&await f;',
    '__pubTrace.event(r,l,"LEASE_BEGIN");e.releaseSlot(r,s,l);__pubTrace.event(r,l,"LEASE_RETURN");__pubTrace.event(r,l,"ISOLATION_CALL_BEGIN");let f=ZH(e,c,"completed"===o.status&&o.finalResponse.length>0);__pubTrace.event(r,l,"ISOLATION_CALL_RETURN");if(void 0!==f){__pubTrace.event(r,l,"ISOLATION_AWAIT_BEGIN");await f;__pubTrace.event(r,l,"ISOLATION_AWAIT_END")}');
  add('function n(t,n,r,i){let __coordAttempt=', 'function n(t,n,r,i){__pubTrace.observer(t,"TERMINAL_OBSERVER_BEGIN");let __coordAttempt=');
  add('try{e.store.transition(t,i)}catch(i){__coordAttempt?.failed(i);',
    '__pubTrace.observer(t,"TERMINAL_OBSERVER_RETURN");try{__pubTrace.observer(t,"TERMINAL_STORE_BEGIN");let __pubResult=e.store.transition(t,i);__pubTrace.storeReturn(t,__pubResult)}catch(i){__pubTrace.storeError(t,i);__coordAttempt?.failed(i);');
  add('transition:(n,i)=>{let o=r(n),s=e.transition(n,i);return t(),s.applied&&o.settle(s.record),s}',
    'transition:(n,i)=>{let o=r(n),s=e.transition(n,i);return t(),s.applied&&o.settle(s.record),__pubTrace.transition(e,s),s}');
  const notification = between(source, 'notifyTerminal:function(t){if(!t.runInBackground)', '},recordDeliveryFailure:');
  const recordStart = 'let n=e.store.load(t.record.task_id)??t.record;return ';
  add(notification, notification.replace(recordStart, 'let n=e.store.load(t.record.task_id)??t.record;let __pubDecision=') +
    ';__pubTrace.decision(n,__pubDecision);return __pubDecision');
  add('let l=wJ(e.notifier,hJ([r],s));return l.ok?',
    'let l=wJ(e.notifier,hJ([r],s));let __pubAccepted=l.ok;__pubTrace.enqueue(n,__pubAccepted);return __pubAccepted?');
  add('function SJ(e,t,n){e.mutate(t,e=>e.notification.notified_epoch>=n?e:{...e,notification:{...e.notification,notified_epoch:n}})}',
    'function SJ(e,t,n){__pubTrace.event(t,n,"EPOCH_BEGIN");try{e.mutate(t,e=>e.notification.notified_epoch>=n?e:{...e,notification:{...e.notification,notified_epoch:n}});__pubTrace.event(t,n,"EPOCH_RETURN")}catch(__pubError){__pubTrace.error(t,n,"EPOCH_ERROR",__pubError);throw __pubError}}');
  let output = source;
  for (const [anchor, replacement] of edits) output = replaceUnique(output, anchor, replacement);
  const nativePorts = options.liveSelector === undefined ? ""
    : `import * as __pubTraceFs from "node:fs";\nconst __pubTracePorts=(${createNativeTracePorts.toString()})(__pubTraceFs);\n`;
  const configuration = options.liveSelector === undefined ? `{fixture:${options.fixture === true}}`
    : `{liveSelector:${JSON.stringify(LIVE_SELECTOR)},ports:__pubTracePorts}`;
  const prefix = `${nativePorts}${MARKER}\nconst __pubTrace=(${createPublicationTrace.toString()})(${configuration});\n${END_MARKER}\n`;
  return prefix + output;
}
