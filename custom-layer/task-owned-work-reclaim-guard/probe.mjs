#!/usr/bin/env node
// Run only extracted lifecycle functions in a VM. No installed module is imported.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { FILE } from "./patch.mjs";

const BOUNDARIES = Object.freeze([
  ["function hF(", "async function gF("],
  ["async function vF(", "function _F("],
  ["function SW(", "function IW("],
  ["async function CJ(", "function DJ("],
  ["async function LJ(", "async function FJ("],
  ["async function FJ(", "async function qJ("],
  ["async function qJ(", "async function zJ("],
  ["function yZ(", "async function wZ("],
  ["async function wZ(", "function kZ("],
  ["async function _Z(", "function yZ("],
]);

export function extractLifecycle(text) {
  const fragments = BOUNDARIES.map(([start, end]) => {
    const begin = text.indexOf(start);
    const finish = text.indexOf(end, begin + start.length);
    if (begin < 0 || finish < 0 || text.indexOf(start, begin + start.length) >= 0) {
      throw new Error(`Unqualified lifecycle boundary: ${start}`);
    }
    return text.slice(begin, finish);
  });
  // This is the existing explicit-cancel park closure, not a new automatic entrypoint.
  const start = text.indexOf("parkTerminalResident:e=>async function");
  const end = text.indexOf(',dispose:()=>{s(),r.dispose()', start);
  if (start < 0 || end < 0) throw new Error("Unqualified terminal park boundary");
  const park = text.slice(start + "parkTerminalResident:".length, end);
  return `${fragments.join("\n")}\nconst terminalPark=${park};\n({hF,SW,CJ,LJ,wZ,_Z,terminalPark});`;
}

export function createFixture(text) {
  const trace = [];
  const records = new Map();
  const handles = new Map();
  let now = Date.parse("2026-10-23T00:00:00.000Z");
  let background = 0;
  let monitors = 0;
  let onClaim = () => {};
  let claimed = true;
  const ownerKey = Symbol.for("omo.agent-coordination.native.v1");
  const context = vm.createContext({
    Promise, Map, Set, WeakMap, WeakRef, Symbol, Date, Error,
    lK: new Set(["completed", "error", "cancelled", "interrupted", "lost"]),
    uZ: (n) => n === 0 || n === "unlimited",
    mZ: (items, parent) => items.filter((r) => r.parent_session_id === parent && r.residency_state === "resident"),
    gZ: class extends Error {
      constructor({ max_children, residents }) {
        super("No idle resident available");
        this.max_children = max_children;
        this.residents = residents;
      }
    },
    Yq: async (_deadline, _identity, _step, action) => action(),
    jJ: async (_id, _step, action) => action(),
    dK: (e) => new Date(e.now()).toISOString(),
    zm: (...args) => trace.push(["error", ...args]),
    vZ: () => { throw new Error("Unexpected no-handle recovery path"); },
  });
  context[ownerKey] = { runtimeOwners: new WeakMap() };
  const api = new vm.Script(extractLifecycle(text), { filename: "isolated-lifecycle-copy.js" })
    .runInContext(context, { timeout: 1000 });
  const state = {
    hostPid: 17,
    now: () => now,
    config: { resident_idle_timeout_ms: 900000, residency_max_children: 1 },
    failedTeardowns: new Set(),
    teardownStepDeadline: 1000,
    kernelToolBindings: { release: (id) => trace.push(["kernel-release", id]) },
    store: {
      list: () => ({ records: [...records.values()] }),
      load: (id) => records.get(id) ?? null,
      transition: (id, event) => {
        trace.push(["transition", id, event.type]);
        const r = records.get(id);
        if (r) r.residency_state = event.type === "persist_only" ? "persisted_only"
          : event.type === "evict" ? "evicted" : "disposed";
      },
      appendEvent: (id, event) => trace.push(["event", id, event.type]),
    },
    registry: {
      get: (id) => handles.get(id),
      hasInFlightSends: () => false,
      hasPendingSends: () => false,
      tryClaimEviction: () => { trace.push(["claim"]); onClaim(); return claimed; },
      releaseEviction: () => trace.push(["release-claim"]),
      forget: (id) => { trace.push(["forget", id]); handles.delete(id); },
    },
  };
  // The runtime property is the already-existing Senpi ownership contract, not task status.
  const runtime = {
    sessionId: "fixture-session",
    model: {},
    get isSessionBusy() { return background > 0 || monitors > 0; },
    getLastAssistantText: () => "completed answer",
    subscribe: () => () => {},
    abort: async () => { trace.push(["abort"]); },
    extensionRunner: {
      hasHandlers: () => true,
      emit: async (event) => trace.push(["shutdown", event.reason]),
    },
    dispose: () => trace.push(["dispose"]),
  };
  const native = api.hF("st_fixture", runtime).handle;
  const resident = api.SW(native);
  function reset({ busyBackground = 0, busyMonitors = 0, status = "completed" } = {}) {
    trace.length = 0;
    records.clear();
    handles.clear();
    now = Date.parse("2026-10-23T00:00:00.000Z");
    background = busyBackground;
    monitors = busyMonitors;
    onClaim = () => {};
    claimed = true;
    records.set("st_fixture", {
      task_id: "st_fixture", parent_session_id: "root", status,
      residency_state: "resident", host_pid: 17,
      updated_at: new Date(now).toISOString(),
    });
    // A fresh handle for every case: native disposal is intentionally one-shot.
    handles.set("st_fixture", api.SW(api.hF("st_fixture", runtime).handle));
  }
  reset();
  return {
    api, context, state, trace, records, native, resident, runtime, reset,
    advance: (milliseconds) => { now += milliseconds; },
    owned: (bg, mon) => { background = bg; monitors = mon; },
    claim: (action) => { onClaim = action; },
    refuseClaim: () => { claimed = false; },
    idle: () => { context.t = state; return api.wZ(state); },
    capacity: () => api._Z(state, "root"),
    // terminalPark closes over t, just as the installed lifecycle factory does.
    cancelPark: () => { context.t = state; return api.terminalPark("st_fixture"); },
    cancel: () => api.LJ(state, "st_fixture", "cancel"),
    shutdown: () => api.CJ(state, state.registry.get("st_fixture"), "shutdown"),
  };
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export async function evaluateText(text) {
  const checks = {};
  try {
    const f = createFixture(text);
    async function check(name, action) {
      try {
        const passed = await action() === true;
        const errors = f.trace.filter(([event]) => event === "error");
        checks[name] = errors.length > 0 ? { error: JSON.stringify(errors) } : passed;
      }
      catch (error) { checks[name] = { error: String(error) }; }
    }
    const untouched = () => !f.trace.some(([event]) => ["abort", "dispose", "forget", "kernel-release"].includes(event));
    const disposed = () => f.trace.some(([event]) => event === "dispose");
    await check("liveBackground", async () => {
      f.reset({ busyBackground: 1 }); f.advance(900001);
      return same(await f.idle(), []) && untouched();
    });
    await check("monitorOnly", async () => {
      f.reset({ busyMonitors: 1 }); f.advance(900001);
      return same(await f.idle(), []) && untouched();
    });
    await check("settledWorkReclaims", async () => {
      f.reset({ busyBackground: 1, busyMonitors: 1 }); f.advance(900001);
      await f.idle(); f.owned(0, 0);
      return same(await f.idle(), ["st_fixture"]) && disposed();
    });
    await check("ordinaryIdleReclaims", async () => {
      f.reset(); f.advance(900001);
      return same(await f.idle(), ["st_fixture"]) && disposed();
    });
    await check("idleClaimRace", async () => {
      f.reset(); f.advance(900001); f.claim(() => f.owned(1, 0));
      return same(await f.idle(), []) && untouched();
    });
    await check("capacityBusyRefuses", async () => {
      f.reset({ busyBackground: 1 });
      return (await f.capacity()).kind === "rejected" && untouched();
    });
    await check("capacityIdleEvicts", async () => {
      f.reset();
      return (await f.capacity()).kind === "evicted" && disposed();
    });
    await check("capacityClaimRace", async () => {
      f.reset(); f.claim(() => f.owned(0, 1));
      return (await f.capacity()).kind === "rejected" && untouched();
    });
    await check("capacityClaimRefused", async () => {
      f.reset(); f.refuseClaim();
      return (await f.capacity()).kind === "rejected" && untouched();
    });
    await check("automaticParkGuard", async () => {
      f.reset({ busyMonitors: 1 }); f.advance(900001);
      await f.idle();
      return f.records.get("st_fixture").residency_state === "resident" && untouched();
    });
    await check("explicitCancelPreserved", async () => {
      f.reset({ busyBackground: 1 }); await f.cancel();
      return disposed() && f.trace.some(([event]) => event === "abort");
    });
    await check("explicitCancelParkPreserved", async () => {
      f.reset({ busyMonitors: 1 });
      return await f.cancelPark() === true && disposed();
    });
    await check("shutdownPreserved", async () => {
      f.reset({ busyBackground: 1, busyMonitors: 1 }); await f.shutdown();
      return disposed();
    });
    await check("nativeAndAdapterStayLive", async () => {
      f.owned(1, 0);
      if (f.native.isSessionBusy?.() !== true || f.resident.isSessionBusy?.() !== true) return false;
      f.owned(0, 0);
      return f.native.isSessionBusy() === false && f.resident.isSessionBusy() === false;
    });
    const controls = ["ordinaryIdleReclaims", "capacityIdleEvicts", "explicitCancelPreserved",
      "explicitCancelParkPreserved", "shutdownPreserved"];
    const allPass = Object.values(checks).every((result) => result === true);
    const hasUnexpectedErrors = Object.values(checks).some((result) => typeof result !== "boolean");
    const controlsPass = controls.every((key) => checks[key] === true);
    const reproduced = checks.liveBackground === false && checks.monitorOnly === false
      && checks.automaticParkGuard === false;
    return { verdict: hasUnexpectedErrors ? "needs-review" : allPass ? "defect-absent" : controlsPass && reproduced ? "defect-present" : "needs-review", checks };
  } catch (error) {
    return { verdict: "needs-review", reason: String(error), checks };
  }
}

export async function probeTree(root) {
  return { root, ...await evaluateText(await readFile(join(root, FILE), "utf8")) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--omo-root" || !args[1]) {
    console.error("Use --omo-root <package-root>");
    process.exitCode = 2;
  } else {
    probeTree(resolve(args[1])).then((result) => {
      console.log(`PROBE ${JSON.stringify(result)}`);
      if (result.verdict === "needs-review") process.exitCode = 3;
    }).catch((error) => {
      console.error(error);
      process.exitCode = 2;
    });
  }
}
