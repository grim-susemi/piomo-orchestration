import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  TARGET, BASELINE_SHA256, MARKER, END_MARKER, FIXTURE_SELECTOR,
  LIVE_SELECTOR, SELECTOR_SHA256, selectorText, createNativeTracePorts,
  BUILD_REF, MANIFEST_REF,
  transformText, replaceUnique, assessTrace, sha256,
} from "./patch.mjs";
import {
  SOURCE_PATHS, FILES, BACKUP, STAGE, EVIDENCE,
  adoptedInputs, executeLive, checkOnly, validateLiveAuthority, collectTestEvidence,
  TEST_DESCRIPTION,
} from "./livecase.mjs";

const baseline = await readFile(TARGET, "utf8");
assert.equal(sha256(baseline), BASELINE_SHA256);
const inactive = transformText(baseline);
const traced = transformText(baseline, { fixture: true });
const liveTraced = transformText(baseline, { liveSelector: LIVE_SELECTOR });
const sourceBytes = new Map();
const sourcePins = await Promise.all(SOURCE_PATHS.map(async (path) => {
  const bytes = await readFile(path);
  sourceBytes.set(path, bytes);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}));
// Parsing is deliberately separate from the extracted-function VM executions.
// No link/evaluate/import callback is supplied or invoked for these full images.
assert.equal(typeof vm.SourceTextModule, "function");
const fullModuleParse = [
  ["baseline", baseline], ["inactive", inactive], ["fixture", traced], ["live", liveTraced],
].map(([name, source]) => {
  const context = vm.createContext({});
  const module = new vm.SourceTextModule(source, { context, identifier: `${BUILD_REF}:${name}` });
  assert.equal(module.status, "unlinked");
  assert.deepEqual(Object.keys(context), []);
  return {
    name, sha256: sha256(source), bytes: Buffer.byteLength(source),
    status: module.status, evaluated: false,
  };
});
console.log(`N1_CANDIDATE ${JSON.stringify({
  baseline: sha256(baseline), inactive: sha256(inactive), fixture: sha256(traced),
  live: sha256(liveTraced), selector: sha256(selectorText()), sourcePins,
  installedWrites: 0, providers: 0, nativeChildren: 0,
  realTimers: 0, realSealReceipts: 0,
  buildRef: BUILD_REF, manifestRef: MANIFEST_REF, fullModuleParse,
})}`);

function span(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source boundary missing: ${start}`);
  return source.slice(from, to);
}

function sourceFactory(source, environment) {
  const prefix = source.includes(MARKER)
    ? span(source, MARKER, END_MARKER)
    : "const __pubTrace=undefined;";
  const fragments = [
    prefix,
    span(source, "var pF=e=>{};", "async function gF("),
    span(source, "function SW(", "function IW("),
    span(source, "function JH(", "async function QH("),
    span(source, 'var cJ=new Set(["completed","error","lost"]);', 'vy(),hE();import{randomUUID as AJ}'),
    span(source, "var T6=new Set(", "function O6("),
    span(source, "function GB(", "function KB("),
    span(source, "function O6(", 'rg(),Ks();var M6='),
  ].join("\n");
  const context = vm.createContext(environment);
  const script = new vm.Script(`(()=>{${fragments}\nreturn {hF,SW,JH,YH,O6,mJ,trace:__pubTrace};})()`);
  return script.runInContext(context, { timeout: 1000 });
}

function setup(source, options = {}) {
  const calls = [];
  const events = [];
  const notices = [];
  const errors = [];
  const getters = [];
  const diagnosticTimers = [];
  const sealReceipts = [];
  const signals = {
    waiter: Promise.withResolvers(),
    error: Promise.withResolvers(),
    stop: Promise.withResolvers(),
    isolation: Promise.withResolvers(),
  };
  const native = {
    runtimeOwners: new WeakMap(), terminalObservers: new WeakMap(),
    replays: new WeakMap(), outcomePorts() {},
  };
  const environment = {
    process: { pid: 1 },
    rg() {},
    GW: (_record, text) => text,
    KH: new Set(["completed", "error", "cancelled", "interrupted", "lost"]),
    rJ: (record) => ({ task_id: record.task_id, run_epoch: record.notification.run_epoch }),
    iJ: (details) => ({ details }),
    uF: () => ({ provider: "fixture", id: "model" }),
    __pubTracePorts: {
      kind: "offline",
      schedule(callback, delay) {
        if (options.timerError) throw options.timerError;
        diagnosticTimers.push({ callback, delay });
      },
      writeSeal(receipt) {
        if (options.sealError) throw options.sealError;
        sealReceipts.push(JSON.parse(JSON.stringify(receipt)));
      },
    },
    zm(message, details) {
      errors.push({ message, details });
      signals.error.resolve();
    },
  };
  environment[Symbol.for("omo.agent-coordination.native.v1")] = native;
  const code = sourceFactory(source, environment);
  const id = options.id ?? (options.live ? "st_00000002" : FIXTURE_SELECTOR.taskId);
  const epoch = options.epoch ?? 0;
  let record = {
    task_id: id, parent_session_id: options.parent ?? (options.live ? LIVE_SELECTOR.parentSessionId : FIXTURE_SELECTOR.parent),
    name: options.name ?? (options.live ? LIVE_SELECTOR.taskName : FIXTURE_SELECTOR.name), host_pid: options.hostPid ?? 1,
    ...(options.live ? {
      agent_type: options.role ?? LIVE_SELECTOR.agentType,
      resolved_model: {
        provider: "chatgpt-subscription", model_id: options.model ?? "gpt-6.1-sol",
        reasoning_effort: options.reasoning ?? "medium",
      },
    } : {}),
    status: "pending", residency_state: "resident",
    notification: { run_epoch: options.epoch ?? 0, notified_epoch: -1 },
    ...(options.isolationGate ? { isolation: { fixture: true } } : {}),
  };
  let live;
  let lease = true;
  const raw = {
    stateDir: "fixture-memory",
    load(taskId) {
      assert.equal(taskId, id);
      return record;
    },
    list: () => ({ records: [record] }),
    mutate(taskId, mutate) {
      assert.equal(taskId, id);
      calls.push("mutate");
      record = mutate(record);
      return record;
    },
    appendEvent(taskId, event) {
      assert.equal(taskId, id);
      if (event.type === "publication_trace" && options.traceWriteFailure) throw options.traceWriteFailure;
      events.push(event);
    },
    transition(taskId, event) {
      assert.equal(taskId, id);
      calls.push(`transition:${event.type}`);
      if (event.type === "complete" && options.storeError) throw options.storeError;
      const status = { start: "running", complete: "completed", fail: "error", cancel: "cancelled", interrupt: "interrupted" }[event.type];
      assert.ok(status);
      record = { ...record, status };
      return { applied: true, record };
    },
  };
  const scheduled = [];
  const notifier = code.mJ({
    store: raw,
    getParentState: () => ({ kind: options.parentState ?? "idle" }),
    getCurrentSessionId: () => record.parent_session_id,
    schedule(fn) {
      scheduled.push(fn);
      return () => {};
    },
    notifier: {
      enqueue(payload) {
        calls.push("enqueue");
        if (options.enqueueError) throw options.enqueueError;
        notices.push(payload);
      },
    },
  });
  const store = code.O6(raw, () => {}, {
    notify({ record: terminal }) {
      calls.push("terminal-observer");
      notifier.notifyTerminal({
        runInBackground: true, record: terminal,
        parentState: { kind: options.parentState ?? "idle" },
      });
    },
  });
  const promptGate = Promise.withResolvers();
  const listeners = new Set();
  let text;
  const fakeSession = {
    sessionId: "fixture-session",
    model: { provider: "fixture", id: "model" },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getLastAssistantText: () => text,
    prompt: () => promptGate.promise,
    get isSessionBusy() { getters.push("session.isSessionBusy"); return false; },
    abort: async () => {},
    steer: async () => {},
    followUp: async () => {},
  };
  const managed = code.hF(id, fakeSession);
  managed.beginTurn("fixture-only-not-a-provider-prompt");
  const handle = code.SW(managed.handle);
  live = handle;
  const businessRecord = () => {
    if (options.guard === "missing") return null;
    const residency = options.guard === "persisted" ? "persisted_only"
      : options.guard === "detached" ? "rpc_detached" : "resident";
    const notification = {};
    Object.defineProperty(notification, "run_epoch", {
      get() { getters.push("record.run_epoch"); return options.guard === "epoch" ? epoch + 1 : epoch; },
    });
    return {
      ...record,
      get residency_state() { getters.push("record.residency_state"); return residency; },
      get notification() { getters.push("record.notification"); return notification; },
    };
  };
  const ports = {
    store,
    now() { calls.push("now"); return 1000; },
    liveHandle() { getters.push("liveHandle"); return options.guard === "handle" ? {} : live; },
    tryLoad() { calls.push("tryLoad"); return businessRecord(); },
    runStatsSnapshot() { calls.push("stats"); return undefined; },
    releaseSlot(taskId, _model, observedEpoch) {
      assert.equal(taskId, id);
      assert.equal(observedEpoch, epoch);
      calls.push("release");
      if (options.leaseError) throw options.leaseError;
      lease = false;
    },
    forget() { calls.push("forget"); live = undefined; },
    settleWaiters() { calls.push("waiters"); signals.waiter.resolve(); },
    tryRuntimeFallback() { throw new Error("No model fallback is allowed"); },
    stopSettlement() {
      calls.push("stopSettlement");
      if (options.stopGate) {
        signals.stop.resolve();
        return options.stopGate.promise;
      }
      return undefined;
    },
    settleIsolation() {
      calls.push("isolation");
      signals.isolation.resolve();
      return options.isolationGate.promise;
    },
    scheduleExitConfirmation() { throw new Error("Unexpected exit timer"); },
  };
  if (options.observerError) {
    native.terminalObservers.set(store, () => { throw options.observerError; });
  } else if (options.storeError) {
    native.terminalObservers.set(store, () => ({
      failed(error) {
        assert.equal(error, options.storeError);
        calls.push("same-original-store-error");
      },
    }));
  }
  const tracker = code.YH(ports);
  store.transition(id, { type: "start" });
  if (options.arm !== false) tracker.trackOutcome(id, handle, "fixture/model", epoch);
  const outcome = handle.waitForOutcome();
  return {
    code, id, calls, getters, events, notices, errors, signals, tracker, handle, raw, store, scheduled,
    diagnosticTimers, sealReceipts,
    get record() { return record; },
    get lease() { return lease; },
    optionsStopResolve() { options.stopGate.resolve(); },
    async finishText() {
      text = "PRIVATE_FINAL_FIXTURE";
      for (const listener of listeners) listener({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
      });
      promptGate.resolve();
      return outcome;
    },
    close() {
      if (record.status === "running") store.transition(id, { type: "cancel" });
      code.trace?.seal();
    },
    report() { return assessTrace(events, code.trace?.health()); },
    view() {
      return JSON.parse(JSON.stringify({
        calls, getters, status: record.status, notification: record.notification,
        lease, notices, errors,
        nativeEvents: events.filter((event) => event.type !== "publication_trace"),
      }));
    },
  };
}

async function compare(options, scenario) {
  const before = setup(baseline, options());
  const after = setup(traced, options());
  await scenario(before);
  await scenario(after);
  assert.deepEqual(after.view(), before.view());
  return after;
}

test("F0 pinned hash, unique anchor, partial refusal and default OFF", { timeout: 3000 }, async () => {
  assert.throws(() => transformText(`${baseline}\n`), { kind: "baseline" });
  assert.throws(() => transformText(traced), { kind: "partial" });
  assert.throws(() => transformText(baseline, { selector: {} }), { kind: "selector" });
  assert.throws(() => replaceUnique("xx", "x", "y"), { kind: "anchor" });
  assert.throws(() => replaceUnique("x", "z", "y"), { kind: "anchor" });
  const off = setup(inactive);
  await off.finishText();
  await off.signals.waiter.promise;
  off.close();
  assert.equal(off.events.filter((event) => event.type === "publication_trace").length, 0);
  assert.equal(off.record.status, "completed");
});

test("F1 actual source completed outcome preserves effects, getters and enqueue meaning", { timeout: 3000 }, async () => {
  const after = await compare(() => ({}), async (state) => {
    await state.finishText();
    await state.signals.waiter.promise;
    state.close();
  });
  assert.equal(after.record.notification.notified_epoch, 0);
  assert.equal(after.lease, false);
  assert.equal(after.report().classification, "PUBLISHED_NOTIFICATION_STAGE");
  assert.deepEqual(after.getters, ["liveHandle", "record.residency_state", "record.residency_state", "record.notification", "record.run_epoch"]);
  const diagnosticText = JSON.stringify(after.events.filter((event) => event.type === "publication_trace"));
  assert.ok(!diagnosticText.includes("PRIVATE_FINAL_FIXTURE"));
  assert.ok(!diagnosticText.includes("fixture-only-not-a-provider-prompt"));
  assert.ok(!diagnosticText.includes("PARENT_NOTIFICATION_PERSISTED"));
});

test("F2 unarmed callback is distinct only with sealed lossless coverage", { timeout: 3000 }, async () => {
  const after = await compare(() => ({ arm: false }), async (state) => {
    await state.finishText();
    assert.equal(state.record.status, "running");
    assert.equal(state.lease, true);
    state.close();
  });
  assert.equal(after.report().classification, "CALLBACK_NOT_ARMED_IN_CAPTURED_WINDOW");
  assert.equal(assessTrace(after.events).classification, "UNKNOWN");
});

test("F3 JH original reads and each guard rejection are preserved", { timeout: 3000 }, async () => {
  for (const [guard, expected, reads] of [
    ["handle", "HANDLE", ["liveHandle"]],
    ["missing", "MISSING", ["liveHandle"]],
    ["persisted", "PERSISTED", ["liveHandle", "record.residency_state"]],
    ["detached", "DETACHED", ["liveHandle", "record.residency_state", "record.residency_state"]],
    ["epoch", "EPOCH", ["liveHandle", "record.residency_state", "record.residency_state", "record.notification", "record.run_epoch"]],
  ]) {
    const after = await compare(() => ({ guard }), async (state) => {
      await state.finishText();
      assert.equal(state.lease, true);
      assert.ok(!state.calls.includes("release"));
      state.close();
    });
    assert.deepEqual(after.getters, reads);
    assert.equal(after.report().classification, "GUARD_REJECTION");
    assert.equal(after.report().reason, expected);
  }
  const states = [];
  for (const source of [baseline, traced]) {
    const state = setup(source, { arm: false });
    const originalWait = state.handle.waitForOutcome;
    let reads = 0;
    Object.defineProperty(state.handle, "waitForOutcome", {
      get() { reads++; return originalWait; },
    });
    state.tracker.trackOutcome(state.id, state.handle, "fixture/model", 0);
    await state.finishText();
    await state.signals.waiter.promise;
    state.close();
    assert.equal(reads, 1);
    states.push(state);
  }
  assert.deepEqual(states[1].view(), states[0].view());
});

test("F4 real deferred stop-settlement signal, no sleep", { timeout: 3000 }, async () => {
  const after = await compare(() => ({ stopGate: Promise.withResolvers() }), async (state) => {
    await state.finishText();
    await state.signals.stop.promise;
    assert.equal(state.lease, true);
    // Resolve the exact promise returned by the original port.
    const stop = state.code.trace;
    if (stop) {
      assert.ok(state.events.some((event) => event.payload?.phase === "STOP_AWAIT_BEGIN"));
      stop.seal();
      assert.equal(state.report().classification, "PENDING_EXISTING_AWAIT_AT_OBSERVATION");
    }
    state.optionsStopResolve();
    await state.signals.waiter.promise;
    state.close();
  });
  assert.equal(after.record.status, "cancelled");
  assert.equal(after.record.notification.notified_epoch, -1);
});

test("F5 isolation waits only after the original release", { timeout: 3000 }, async () => {
  const run = async (source) => {
    const gate = Promise.withResolvers();
    const state = setup(source, { isolationGate: gate });
    await state.finishText();
    await state.signals.isolation.promise;
    assert.equal(state.lease, false);
    assert.equal(state.record.status, "running");
    assert.ok(state.calls.indexOf("release") < state.calls.indexOf("isolation"));
    if (state.code.trace) {
      state.code.trace.seal();
      assert.equal(state.report().classification, "PENDING_EXISTING_AWAIT_AT_OBSERVATION");
    }
    gate.resolve();
    await state.signals.waiter.promise;
    state.close();
    return state;
  };
  const before = await run(baseline);
  const after = await run(traced);
  assert.deepEqual(after.view(), before.view());
  assert.equal(after.report().classification, "UNKNOWN");
});

test("F6 original thrown errors and terminal catch boundaries remain intact", { timeout: 3000 }, async () => {
  for (const key of ["leaseError", "observerError", "storeError"]) {
    const original = new Error("SECRET_FIXTURE_ERROR");
    const after = await compare(() => ({ [key]: original }), async (state) => {
      await state.finishText();
      if (key === "storeError") await state.signals.waiter.promise;
      else await state.signals.error.promise;
      assert.ok(state.errors.some((entry) => entry.details.error?.includes("SECRET_FIXTURE_ERROR")));
      state.close();
    });
    assert.equal(after.report().classification, "THROWN_ERROR_AT_PHASE");
    const diagnostics = JSON.stringify(after.events.filter((event) => event.type === "publication_trace"));
    assert.ok(!diagnostics.includes("SECRET_FIXTURE_ERROR"));
  }
  const registrationError = new Error("SECRET_REGISTRATION_ERROR");
  const states = [];
  for (const source of [baseline, traced]) {
    const state = setup(source, { arm: false });
    state.handle.waitForOutcome = () => { throw registrationError; };
    assert.throws(() => state.tracker.trackOutcome(state.id, state.handle, "fixture/model", 0), (error) => error === registrationError);
    await state.finishText();
    state.close();
    states.push(state);
  }
  assert.deepEqual(states[1].view(), states[0].view());
  assert.equal(states[1].report().classification, "THROWN_ERROR_AT_PHASE");
});

test("F7 native notification buffering, failure and cancelled gates", { timeout: 3000 }, async () => {
  for (const options of [
    () => ({ parentState: "compacting" }),
    () => ({ enqueueError: new Error("fixture-enqueue-error") }),
    () => ({ stopGate: Promise.withResolvers() }),
  ]) {
    const run = async (source) => {
      const config = options();
      const state = setup(source, config);
      await state.finishText();
      if (config.stopGate) {
        await state.signals.stop.promise;
        config.stopGate.resolve();
      }
      await state.signals.waiter.promise;
      assert.equal(state.record.notification.notified_epoch, -1);
      if (config.enqueueError) assert.equal(state.calls.filter((call) => call === "enqueue").length, 2);
      state.close();
      return state;
    };
    const before = await run(baseline);
    const after = await run(traced);
    assert.deepEqual(after.view(), before.view());
  }
});

test("F8 failing writer, cap and incomplete capture cannot manufacture coverage", { timeout: 3000 }, async () => {
  const failed = await compare(() => ({ traceWriteFailure: new Error("writer-failure") }), async (state) => {
    await state.finishText();
    await state.signals.waiter.promise;
    state.close();
  });
  assert.equal(failed.record.status, "completed");
  assert.equal(failed.report().classification, "UNKNOWN");
  const capped = setup(traced, { arm: false });
  capped.code.trace.event(capped.id, 0, "GUARD_PASS", {
    rawPrompt: "DO_NOT_LOG_PROMPT",
    error_name: "DO_NOT_LOG_SECRET",
    reason: "DO_NOT_LOG_REASON",
  });
  assert.ok(!JSON.stringify(capped.events).includes("DO_NOT_LOG"));
  for (let index = 0; index < 100; index++) capped.code.trace.event(capped.id, 0, "GUARD_PASS", { reason: "PASS" });
  capped.close();
  assert.ok(capped.events.filter((event) => event.type === "publication_trace").length <= 64);
  assert.ok(capped.code.trace.health().dropped > 0);
  assert.equal(capped.report().classification, "UNKNOWN");
});

test("F9 one fixed case only, no original/foreign selector or extra binding", { timeout: 3000 }, async () => {
  for (const options of [
    { id: "st_01a16774" }, { id: "st_00000002" }, { parent: "foreign" },
    { name: "foreign" }, { epoch: 1 },
  ]) {
    const state = setup(traced, options);
    await state.finishText();
    await state.signals.waiter.promise;
    state.close();
    assert.equal(state.events.filter((event) => event.type === "publication_trace").length, 0);
  }
  const bound = setup(traced, { arm: false });
  let foreignWrites = 0;
  bound.code.trace.transition({ appendEvent() { foreignWrites++; } }, { applied: true, record: bound.record });
  bound.code.trace.event(bound.id, 0, "GUARD_PASS", { reason: "PASS" });
  assert.equal(foreignWrites, 0);
  await bound.finishText();
  bound.close();
});

test("L0 canonical selector, real native ports only in the opted-in full candidate", () => {
  assert.equal(sha256(selectorText()), SELECTOR_SHA256);
  for (const change of [
    { parentSessionId: "foreign" }, { taskName: "foreign" }, { runEpoch: 1 },
    { maxBindings: 2 }, { excludeTaskIds: [] }, { resolvedModel: "foreign" },
    { postOutcomeCaptureMs: 1 }, { maxTraceRecords: 65 }, { extra: true },
  ]) {
    assert.throws(() => transformText(baseline, { liveSelector: { ...LIVE_SELECTOR, ...change } }), { kind: "selector" });
  }
  assert.throws(() => transformText(baseline, { liveSelector: LIVE_SELECTOR, fixture: true }), { kind: "selector" });
  assert.ok(liveTraced.includes('import * as __pubTraceFs from "node:fs"'));
  assert.ok(!inactive.includes('import * as __pubTraceFs'));
  assert.ok(!traced.includes('import * as __pubTraceFs'));
  assert.ok(liveTraced.includes("const __pubTaskId=e;"));
  assert.ok(liveTraced.includes("__pubTrace.producerOutcome(__pubTaskId,__pubOutcome)"));
});

test("L1 actual extracted hF outcome, one controlled30s timer, no live fixture seal", { timeout: 3000 }, async () => {
  const before = setup(baseline, { live: true });
  const after = setup(liveTraced, { live: true });
  assert.equal(after.diagnosticTimers.length, 0);
  assert.equal(after.sealReceipts.length, 0);
  await before.finishText();
  await before.signals.waiter.promise;
  await after.finishText();
  await after.signals.waiter.promise;
  assert.deepEqual(after.view(), before.view());
  assert.equal(after.diagnosticTimers.length, 1);
  assert.equal(after.diagnosticTimers[0].delay, 30000);
  assert.ok(after.events.some((event) => event.payload?.phase === "PRODUCER_OUTCOME"));
  after.code.trace.seal();
  assert.equal(after.code.trace.health().sealed, false);
  assert.equal(after.sealReceipts.length, 0);
  after.diagnosticTimers[0].callback();
  after.diagnosticTimers[0].callback();
  assert.equal(after.sealReceipts.length, 1);
  const receipt = after.sealReceipts[0];
  assert.equal(receipt.provenance, "offline-controlled-ports");
  assert.equal(receipt.buildRef, BUILD_REF);
  assert.equal(receipt.manifestRef, MANIFEST_REF);
  assert.equal(receipt.task_id, "st_00000002");
  assert.equal(receipt.health.caseClosed, true);
  assert.equal(receipt.health.nativeOutcomeObserved, true);
  assert.equal(receipt.nativeCompletionNotificationPass, false);
  assert.equal(after.report().classification, "PUBLISHED_NOTIFICATION_STAGE");
  assert.ok(!JSON.stringify({ events: after.events.filter((event) => event.type === "publication_trace"), receipt }).includes("PRIVATE_FINAL_FIXTURE"));
  assert.ok(!JSON.stringify(receipt).includes("fixture-only-not-a-provider-prompt"));
});

test("L2 unarmed native final is not a forged terminal transition", { timeout: 3000 }, async () => {
  const before = setup(baseline, { live: true, arm: false });
  const after = setup(liveTraced, { live: true, arm: false });
  await before.finishText();
  await after.finishText();
  after.diagnosticTimers[0].callback();
  assert.deepEqual(after.view(), before.view());
  assert.equal(after.record.status, "running");
  assert.equal(after.lease, true);
  assert.equal(after.sealReceipts[0].health.caseClosed, false);
  assert.equal(after.report().classification, "REGISTRATION_NOT_OBSERVED_IN_CAPTURE_WINDOW");
  assert.ok(!after.calls.includes("transition:cancel"));
});

test("L3 exact live parent/name/epoch/role/new-id and one binding", { timeout: 3000 }, async () => {
  for (const options of [
    { id: "st_01a16774" }, { id: "st_00000001" }, { id: "not-native" },
    { parent: "foreign" }, { name: "foreign" }, { epoch: 1 }, { hostPid: 2 },
    { role: "other" }, { model: "other" }, { reasoning: "high" },
  ]) {
    const state = setup(liveTraced, { live: true, ...options });
    await state.finishText();
    await state.signals.waiter.promise;
    assert.equal(state.code.trace.health().bound, false);
    assert.equal(state.diagnosticTimers.length, 0);
    assert.equal(state.sealReceipts.length, 0);
    assert.equal(state.events.filter((event) => event.type === "publication_trace").length, 0);
  }
  const state = setup(liveTraced, { live: true });
  let foreignWrites = 0;
  state.code.trace.transition({ appendEvent() { foreignWrites++; } }, {
    applied: true, record: { ...state.record, task_id: "st_00000003" },
  });
  await state.finishText();
  await state.signals.waiter.promise;
  state.diagnosticTimers[0].callback();
  assert.equal(foreignWrites, 0);
  assert.ok(state.events.filter((event) => event.type === "publication_trace").every((event) => event.payload.task_id === state.id));
});

test("L4 live guard/error and pending isolation preserve original effects and getters", { timeout: 3000 }, async () => {
  for (const config of [
    { guard: "handle" }, { guard: "missing" }, { guard: "persisted" },
    { guard: "detached" }, { guard: "epoch" },
    { leaseError: new Error("PRIVATE_LIVE_ERROR") },
    { observerError: new Error("PRIVATE_LIVE_ERROR") },
    { storeError: new Error("PRIVATE_LIVE_ERROR") },
  ]) {
    const run = async (source) => {
      const state = setup(source, { live: true, ...config });
      await state.finishText();
      if (config.leaseError || config.observerError) await state.signals.error.promise;
      else if (!config.guard) await state.signals.waiter.promise;
      if (state.diagnosticTimers.length) state.diagnosticTimers[0].callback();
      return state;
    };
    const before = await run(baseline);
    const after = await run(liveTraced);
    assert.deepEqual(after.view(), before.view());
    assert.equal(after.report().classification, config.guard ? "GUARD_REJECTION" : "THROWN_ERROR_AT_PHASE");
    assert.ok(!JSON.stringify(after.sealReceipts).includes("PRIVATE_LIVE_ERROR"));
  }
  const runPending = async (source) => {
    const gate = Promise.withResolvers();
    const state = setup(source, { live: true, isolationGate: gate });
    await state.finishText();
    await state.signals.isolation.promise;
    if (state.diagnosticTimers.length) state.diagnosticTimers[0].callback();
    assert.equal(state.record.status, "running");
    assert.equal(state.lease, false);
    const frozen = state.code.trace?.health();
    gate.resolve();
    await state.signals.waiter.promise;
    if (frozen) assert.deepEqual(state.code.trace.health(), frozen);
    return state;
  };
  const before = await runPending(baseline);
  const after = await runPending(liveTraced);
  assert.deepEqual(after.view(), before.view());
  assert.equal(after.report().classification, "PENDING_EXISTING_AWAIT_AT_OBSERVATION");
});

test("L5 timer/writer loss, cap and unknown coverage remain fail-open", { timeout: 3000 }, async () => {
  for (const options of [
    { timerError: new Error("PRIVATE_TIMER") },
    { sealError: new Error("PRIVATE_SEAL") },
    { traceWriteFailure: new Error("PRIVATE_WRITER") },
  ]) {
    const state = setup(liveTraced, { live: true, ...options });
    await state.finishText();
    await state.signals.waiter.promise;
    if (state.diagnosticTimers.length) state.diagnosticTimers[0].callback();
    assert.equal(state.record.status, "completed");
    assert.equal(state.record.notification.notified_epoch, 0);
    assert.equal(state.report().classification, "UNKNOWN");
    assert.ok(state.code.trace.health().dropped > 0);
    assert.ok(!JSON.stringify(state.sealReceipts).includes("PRIVATE_"));
  }
  const state = setup(liveTraced, { live: true });
  for (let index = 0; index < 100; index++) state.code.trace.event(state.id, 0, "GUARD_PASS", { reason: "PASS" });
  await state.finishText();
  await state.signals.waiter.promise;
  state.diagnosticTimers[0].callback();
  assert.ok(state.events.filter((event) => event.type === "publication_trace").length <= 64);
  assert.ok(state.sealReceipts[0].health.dropped > 0);
  assert.equal(state.report().classification, "UNKNOWN");
});

test("L6 native writer and timer functions run only on controlled offline globals/FS", () => {
  const files = new Map();
  const calls = [];
  let timer;
  let opened;
  const fakeFs = {
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    realpathSync: (path) => path,
    existsSync: (path) => files.has(path),
    openSync(path, mode) {
      assert.equal(mode, "wx");
      assert.equal(files.has(path), false);
      opened = path;
      files.set(path, "");
      calls.push("open-wx");
      return 9;
    },
    writeFileSync(fd, text) { assert.equal(fd, 9); files.set(opened, text); calls.push("write"); },
    fsyncSync(fd) { assert.equal(fd, 9); calls.push("flush"); },
    closeSync(fd) { assert.equal(fd, 9); calls.push("close"); },
    renameSync(from, to) {
      assert.equal(files.has(to), false);
      files.set(to, files.get(from));
      files.delete(from);
      calls.push("publish");
    },
  };
  const factory = new vm.Script(`(${createNativeTracePorts.toString()})`).runInNewContext({
    setTimeout(callback, delay) {
      timer = { callback, delay };
      return { unref() { calls.push("unref"); } };
    },
  });
  const ports = factory(fakeFs);
  ports.schedule(() => {}, 30000);
  assert.equal(timer.delay, 30000);
  ports.writeSeal({ sanitized: true });
  assert.deepEqual(calls, ["unref", "open-wx", "write", "flush", "close", "publish"]);
  assert.deepEqual(JSON.parse(files.get(FILES.seal)), { sanitized: true });
  const snapshot = files.get(FILES.seal);
  assert.throws(() => ports.writeSeal({ overwrite: true }));
  assert.equal(files.get(FILES.seal), snapshot);
});

test("L7 future authority guards are pure; no execute/check-only branch is invoked", () => {
  const manifest = {
    schema: "publication-probe01-manifest-v1", target: TARGET,
    buildRef: BUILD_REF, manifestRef: MANIFEST_REF,
    beforeSha256: BASELINE_SHA256, selectorSha256: SELECTOR_SHA256,
    sourcePins, candidate: { path: FILES.candidate, sha256: sha256(liveTraced), bytes: Buffer.byteLength(liveTraced) },
  };
  const affected = [LIVE_SELECTOR.parentSessionId, ...Array.from({ length: 6 }, (_, index) => `held-${index}`)];
  const go = {
    decision: "GO_APPLY_PUBLICATION_PROBE01_LIVECASE",
    buildRef: BUILD_REF, manifestRef: MANIFEST_REF,
    parentSessionId: LIVE_SELECTOR.parentSessionId, target: TARGET,
    expectedBeforeSha256: BASELINE_SHA256, expectedAfterSha256: manifest.candidate.sha256,
    selectorSha256: SELECTOR_SHA256, sourcePins,
    probe: {
      taskName: LIVE_SELECTOR.taskName, runEpoch: 0, maxBindings: 1,
      role: LIVE_SELECTOR.agentType, model: LIVE_SELECTOR.resolvedModel,
      reasoning: "medium", nativeChildren: 1, ptyJobs: 0,
      modelOverrides: 0, fallback: false,
    },
    normalMaintenanceRefreshOnly: true, acceptRamHashUnknown: true,
    allowFixedDiagnosticSealAndTimer: true, affectedSessionIds: affected,
  };
  const checkpoints = {
    schema: "publication-probe01-checkpoints-v1", target: TARGET,
    beforeSha256: BASELINE_SHA256, afterSha256: manifest.candidate.sha256,
    cooperativeTargetWriteQuiescent: true, allAffectedSessionsCheckpointed: true,
    sessions: affected.map((sessionId) => ({ sessionId, path: `offline/${sessionId}`, sha256: "a".repeat(64) })),
  };
  assert.doesNotThrow(() => validateLiveAuthority(go, manifest, checkpoints));
  assert.throws(() => validateLiveAuthority(null, manifest, checkpoints), { kind: "authority" });
  assert.throws(() => validateLiveAuthority({ decision: "GO_LIVECASE_DELTA_PREPARE_ONLY" }, manifest, checkpoints), { kind: "authority" });
  assert.throws(() => validateLiveAuthority(go, manifest, null), { kind: "checkpoints" });
  assert.throws(() => validateLiveAuthority({ ...go, expectedAfterSha256: null }, manifest, checkpoints), { kind: "authority" });
  assert.throws(() => validateLiveAuthority(go, { ...manifest, target: "foreign" }, checkpoints), { kind: "manifest" });
});

test("L8 raw evidence parser retains first failure and requires native exit wrapper", () => {
  const records = [];
  const add = (suffix, exit, marker = true) => {
    const handle = `bash_${suffix}`;
    records.push(
      { message: { role: "assistant", content: [{ type: "toolCall", name: "eval", id: `start-${suffix}`, arguments: { code: `tool.monitor ${TEST_DESCRIPTION}` } }] } },
      { message: { role: "toolResult", toolCallId: `start-${suffix}`, content: [{ text: JSON.stringify({ bash_id: handle }) }] } },
      { message: { role: "assistant", content: [{ type: "toolCall", name: "bash_output", id: `out-${suffix}`, arguments: { bash_id: handle } }] } },
      { id: `record-${suffix}`, message: { role: "toolResult", toolName: "bash_output", toolCallId: `out-${suffix}`, content: [{ text: `status: completed exit_code: ${exit}\n${marker ? `N1_CANDIDATE ${JSON.stringify({ sourcePins })}\n` : "failure-before-marker\n"}` }] } },
    );
  };
  add(911, 1, false);
  assert.throws(() => collectTestEvidence(records), { kind: "test-evidence" });
  add(912, 0);
  const result = collectTestEvidence(records);
  assert.equal(result.runs.length, 2);
  assert.equal(result.runs[0].actualNumericExit, 1);
  assert.equal(result.last.actualNumericExit, 0);
  const fake = structuredClone(records);
  fake.at(-1).message.content[0].text = "program-reported-exit0\nN1_CANDIDATE {}\n";
  assert.throws(() => collectTestEvidence(fake), { kind: "test-evidence" });
});

const installEvidence = {
  memoryOnly: true, adoptedInputs: 0, executeLive: 0, checkOnly: 0,
  passed: [],
};

function installFixture(options = {}) {
  const files = new Map();
  const writes = [];
  const links = new Set();
  const aliases = new Map();
  const putJson = (path, value) => files.set(path, Buffer.from(JSON.stringify(value)));
  const manifest = {
    schema: "publication-probe01-manifest-v1", target: TARGET,
    buildRef: BUILD_REF, manifestRef: MANIFEST_REF,
    beforeSha256: BASELINE_SHA256, selectorSha256: SELECTOR_SHA256, sourcePins,
    candidate: { path: FILES.candidate, sha256: sha256(liveTraced), bytes: Buffer.byteLength(liveTraced) },
  };
  const affected = [LIVE_SELECTOR.parentSessionId, ...Array.from({ length: 6 }, (_, index) => `held-${index}`)];
  const checkpoints = {
    schema: "publication-probe01-checkpoints-v1", target: TARGET,
    beforeSha256: BASELINE_SHA256, afterSha256: manifest.candidate.sha256,
    cooperativeTargetWriteQuiescent: true, allAffectedSessionsCheckpointed: true,
    sessions: affected.map((sessionId, index) => {
      const path = `${EVIDENCE}/offline-checkpoint-${index}.json`;
      const bytes = Buffer.from(JSON.stringify({ sessionId }));
      files.set(path, bytes);
      return { sessionId, path, sha256: sha256(bytes) };
    }),
  };
  const go = {
    decision: "GO_APPLY_PUBLICATION_PROBE01_LIVECASE",
    buildRef: BUILD_REF, manifestRef: MANIFEST_REF,
    parentSessionId: LIVE_SELECTOR.parentSessionId, target: TARGET,
    expectedBeforeSha256: BASELINE_SHA256, expectedAfterSha256: manifest.candidate.sha256,
    selectorSha256: SELECTOR_SHA256, sourcePins,
    probe: {
      taskName: LIVE_SELECTOR.taskName, runEpoch: 0, maxBindings: 1,
      role: LIVE_SELECTOR.agentType, model: LIVE_SELECTOR.resolvedModel,
      reasoning: "medium", nativeChildren: 1, ptyJobs: 0, modelOverrides: 0, fallback: false,
    },
    normalMaintenanceRefreshOnly: true, acceptRamHashUnknown: true,
    allowFixedDiagnosticSealAndTimer: true, affectedSessionIds: affected,
  };
  const packagePath = TARGET.slice(0, TARGET.indexOf("/plugin/")) + "/package.json";
  files.set(TARGET, Buffer.from(baseline));
  files.set(FILES.selector, Buffer.from(selectorText()));
  files.set(FILES.candidate, Buffer.from(liveTraced));
  for (const [path, bytes] of sourceBytes) files.set(path, Buffer.from(bytes));
  putJson(packagePath, { version: "5.1.40" });
  putJson(FILES.liveGo, go);
  putJson(FILES.manifest, manifest);
  putJson(FILES.checkpoints, checkpoints);
  putJson(FILES.buildResult, {
    status: "BUILD_PREPARE_COMPLETE_NOT_APPLIED", actualPrepareProcessExit: 0,
    tests: { last: { actualNumericExit: 0 } }, manifest,
  });
  const missing = () => Object.assign(new Error("offline missing"), { code: "ENOENT" });
  const io = {
    async lstat(path) {
      if (!files.has(path)) throw missing();
      return { isFile: () => true, isSymbolicLink: () => links.has(path) };
    },
    async realpath(path) { return aliases.get(path) ?? path; },
    async readFile(path) {
      if (!files.has(path)) throw missing();
      return Buffer.from(files.get(path));
    },
    async open(path, flags) {
      assert.equal(flags, "wx");
      if (options.openError) throw options.openError;
      if (files.has(path)) throw Object.assign(new Error("offline exists"), { code: "EEXIST" });
      writes.push({ op: "open", path });
      files.set(path, Buffer.alloc(0));
      return {
        async writeFile(bytes) {
          if (options.writeError && path === STAGE) throw options.writeError;
          files.set(path, Buffer.from(bytes));
          writes.push({ op: "write", path });
        },
        async sync() { writes.push({ op: "sync", path }); },
        async close() {
          writes.push({ op: "close", path });
          options.afterClose?.(path, files);
        },
      };
    },
    async rename(from, to) {
      assert.equal(from, STAGE);
      assert.equal(to, TARGET);
      if (options.renameError) throw options.renameError;
      files.set(to, Buffer.from(files.get(from)));
      files.delete(from);
      writes.push({ op: "rename", path: to });
      options.afterRename?.(files);
    },
  };
  return {
    io, files, writes, links, aliases, manifest, checkpoints, packagePath,
    update(path, mutate) { const value = JSON.parse(files.get(path)); mutate(value); putJson(path, value); },
  };
}

async function adoptOffline(fixture) {
  installEvidence.adoptedInputs++;
  return adoptedInputs(fixture.io);
}

async function applyOffline(fixture) {
  installEvidence.executeLive++;
  return executeLive(fixture.io);
}

async function checkOffline(fixture) {
  installEvidence.checkOnly++;
  return checkOnly(fixture.io);
}

test("R0 FULL modules parse unlinked, reject syntax error, never link/evaluate", () => {
  assert.equal(fullModuleParse.length, 4);
  assert.ok(fullModuleParse.every((entry) => entry.status === "unlinked" && !entry.evaluated));
  assert.equal(fullModuleParse.find((entry) => entry.name === "live").sha256, sha256(liveTraced));
  assert.throws(() => new vm.SourceTextModule(liveTraced + "\nconst = ;"), (error) => error.name === "SyntaxError");
});

test("R1 external build reference is required in real adoption paths", async () => {
  for (const [path, field, kind] of [
    [FILES.manifest, "buildRef", "manifest"], [FILES.manifest, "manifestRef", "manifest"],
    [FILES.liveGo, "buildRef", "authority"], [FILES.liveGo, "manifestRef", "authority"],
  ]) {
    const fixture = installFixture();
    fixture.update(path, (value) => { value[field] = "different-build"; });
    await assert.rejects(adoptOffline(fixture), { kind });
    assert.equal(fixture.writes.length, 0);
  }
  installEvidence.passed.push("BUILD_REF_MANIFEST_AUTHORITY");
});

test("R2 adoptedInputs actual source/selector/candidate/checkpoint/finalization refusals", async () => {
  for (const [name, change, expected] of [
    ["MISSING_GO", (f) => f.files.delete(FILES.liveGo), { code: "ENOENT" }],
    ["MISSING_CHECKPOINTS", (f) => f.files.delete(FILES.checkpoints), { code: "ENOENT" }],
    ["UNFINALIZED_BUILD", (f) => f.update(FILES.buildResult, (v) => { v.actualPrepareProcessExit = null; }), { kind: "build-result" }],
    ["SOURCE_DRIFT", (f) => f.files.set(SOURCE_PATHS[0], Buffer.from("drift")), { kind: "source" }],
    ["SELECTOR_DRIFT", (f) => f.files.set(FILES.selector, Buffer.from("drift")), { kind: "selector" }],
    ["CANDIDATE_DRIFT", (f) => f.files.set(FILES.candidate, Buffer.from("drift")), { kind: "candidate" }],
    ["CHECKPOINT_DRIFT", (f) => f.files.set(f.checkpoints.sessions[0].path, Buffer.from("drift")), { kind: "checkpoints" }],
  ]) {
    const fixture = installFixture();
    change(fixture);
    await assert.rejects(adoptOffline(fixture), expected);
    assert.equal(fixture.writes.length, 0);
    installEvidence.passed.push(name);
  }
  const fixture = installFixture();
  const adopted = await adoptOffline(fixture);
  assert.equal(adopted.manifest.buildRef, BUILD_REF);
  assert.equal(sha256(adopted.bytes), sha256(liveTraced));
  assert.equal(fixture.writes.length, 0);
  installEvidence.passed.push("ADOPTED_INPUTS_SUCCESS");
});

test("R3 actual execute/checkOnly success, backup reuse and idempotent refusal", async () => {
  const fixture = installFixture();
  await assert.rejects(checkOffline(fixture), { kind: "readback" });
  assert.equal(fixture.writes.length, 0);
  assert.equal((await applyOffline(fixture)).state, "applied");
  assert.equal(sha256(fixture.files.get(BACKUP)), BASELINE_SHA256);
  assert.equal(sha256(fixture.files.get(TARGET)), sha256(liveTraced));
  assert.equal(fixture.files.has(STAGE), false);
  const writes = fixture.writes.length;
  assert.equal((await checkOffline(fixture)).state, "verified");
  assert.equal((await checkOffline(fixture)).state, "verified");
  await assert.rejects(applyOffline(fixture), { kind: "baseline" });
  assert.equal(fixture.writes.length, writes);
  assert.ok(fixture.writes.every((entry) => [BACKUP, STAGE, TARGET].includes(entry.path)));
  const reused = installFixture();
  reused.files.set(BACKUP, Buffer.from(baseline));
  await applyOffline(reused);
  assert.ok(!reused.writes.some((entry) => entry.path === BACKUP));
  installEvidence.passed.push("BASELINE_CHECK_REFUSAL", "APPLY_SUCCESS", "CHECK_REPEAT_READ_ONLY", "REAPPLY_REFUSED_NO_WRITE", "BACKUP_REUSE");
});

test("R4 actual backup/stage/realpath/version/drift/rename/readback failures", async () => {
  for (const [name, change, expected] of [
    ["TARGET_SYMLINK", (f) => f.links.add(TARGET), { kind: "path" }],
    ["TARGET_REALPATH", (f) => f.aliases.set(TARGET, "C:/foreign.js"), { kind: "path" }],
    ["PACKAGE_VERSION", (f) => f.update(f.packagePath, (v) => { v.version = "other"; }), { kind: "version" }],
    ["BASELINE_DRIFT", (f) => f.files.set(TARGET, Buffer.from("different-before")), { kind: "baseline" }],
    ["BACKUP_BAD", (f) => f.files.set(BACKUP, Buffer.from("foreign-backup")), { kind: "backup" }],
    ["STAGE_EXISTS", (f) => f.files.set(STAGE, Buffer.from("foreign-stage")), { kind: "existing" }],
  ]) {
    const fixture = installFixture();
    change(fixture);
    const before = Buffer.from(fixture.files.get(TARGET));
    await assert.rejects(applyOffline(fixture), expected);
    assert.equal(fixture.writes.length, 0);
    assert.deepEqual(fixture.files.get(TARGET), before);
    installEvidence.passed.push(name);
  }
  for (const [name, options, kind] of [
    ["BACKUP_READBACK", { afterClose: (path, files) => { if (path === BACKUP) files.set(BACKUP, Buffer.from("bad-backup")); } }, "backup"],
    ["STAGE_READBACK", { afterClose: (path, files) => { if (path === STAGE) files.set(STAGE, Buffer.from("bad-stage")); } }, "stage"],
    ["CONCURRENT_TARGET_DRIFT", { afterClose: (path, files) => { if (path === STAGE) files.set(TARGET, Buffer.from("concurrent-change")); } }, "baseline"],
    ["AFTER_READBACK", { afterRename: (files) => files.set(TARGET, Buffer.from("bad-after")) }, "readback"],
    ["AFTER_BACKUP_READBACK", { afterRename: (files) => files.set(BACKUP, Buffer.from("bad-after-backup")) }, "readback"],
  ]) {
    const fixture = installFixture(options);
    await assert.rejects(applyOffline(fixture), { kind });
    const renamed = fixture.writes.filter((entry) => entry.op === "rename").length;
    assert.equal(renamed, name.startsWith("AFTER_") ? 1 : 0);
    if (name === "CONCURRENT_TARGET_DRIFT") assert.equal(fixture.files.get(TARGET).toString(), "concurrent-change");
    else if (!name.startsWith("AFTER_")) assert.equal(sha256(fixture.files.get(TARGET)), BASELINE_SHA256);
    installEvidence.passed.push(name);
  }
  for (const key of ["openError", "writeError", "renameError"]) {
    const original = Object.assign(new Error(`offline-${key}`), { code: "EACCES" });
    const fixture = installFixture({ [key]: original });
    await assert.rejects(applyOffline(fixture), (error) => error === original);
    assert.equal(sha256(fixture.files.get(TARGET)), BASELINE_SHA256);
    assert.ok(!fixture.writes.some((entry) => entry.op === "rename"));
    if (key === "writeError") assert.ok(fixture.writes.some((entry) => entry.op === "close" && entry.path === STAGE));
    installEvidence.passed.push(key.toUpperCase());
  }
});

test("R5 actual checkOnly failure paths stay read-only", async () => {
  for (const [name, change, expected] of [
    ["CHECK_TARGET_BAD", (f) => f.files.set(TARGET, Buffer.from("drift")), { kind: "readback" }],
    ["CHECK_BACKUP_BAD", (f) => f.files.set(BACKUP, Buffer.from("drift")), { kind: "readback" }],
    ["CHECK_BACKUP_MISSING", (f) => f.files.delete(BACKUP), { code: "ENOENT" }],
    ["CHECK_REALPATH", (f) => f.aliases.set(TARGET, "C:/foreign.js"), { kind: "path" }],
    ["CHECK_VERSION", (f) => f.update(f.packagePath, (v) => { v.version = "other"; }), { kind: "version" }],
    ["CHECK_SOURCE_DRIFT", (f) => f.files.set(SOURCE_PATHS[2], Buffer.from("drift")), { kind: "source" }],
  ]) {
    const fixture = installFixture();
    await applyOffline(fixture);
    const writes = fixture.writes.length;
    change(fixture);
    await assert.rejects(checkOffline(fixture), expected);
    assert.equal(fixture.writes.length, writes);
    installEvidence.passed.push(name);
  }
  console.log(`N1_R1_INSTALL_CASES ${JSON.stringify(installEvidence)}`);
});
