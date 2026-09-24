/* todo-8-quota insert fragment.
 *
 * This file is NOT a standalone module. qa/quota-routing-anchor.mjs reads it and splices the
 * sections below into the beta.81 plugin/extensions/omo-task.js body *after* the slot-4
 * gateRepair splice (harness-diagnostics-improve Todo 8 lands through its own
 * patches/installed-patches.json slot `todo-8-quota`, never inside gateRepair).
 *
 * Sections:
 *   @splice-spawn-barrier -> inserted immediately before the spawn admission line
 *                            (`let p,f,m,h=u??this.#N.register(...)`) inside async #J
 *   @splice-spawn-admit   -> replaces the spawn admission call `g=wj(...),{plan:v,lease:y}=g;`
 *                            with the quota admission wrapper plus the terminal no-route return
 *   @splice-k-prune       -> inserted immediately before async #Z's record read, after the
 *                            existing guard expression (the #Z guard bytes are untouched)
 *   @splice-rp-observe    -> wraps RP's normalized-event append with the quota event observer
 *   @defs                 -> appended at the end of the bundle (ESM imports hoist)
 *
 * beta.84 re-author (P3, st_01a0cb41): the base locates the store as this.#E.store, the workpool
 * tracker as this.#O, the admission helper as wj (was tP), the record getter as #W (was #q),
 * the resident map as #R (was #P), the workpool-delete map as #j (was #R) and the replay-guard
 * method as #Z (was #K); the guard bytes themselves are byte-identical.
 *
 * Policy (harness-diagnostics-improve Todo 8, C2): freeze the resolved routing policy per
 * execution; enter the quota path ONLY on a structured 402 + insufficient_quota body; mark the
 * affected quota key (provider/model_id) exhausted - never the whole provider; reroute to the
 * first approved, capable, unvisited fallback with a reservation (the workpool lane lease);
 * keep requested_model and update resolved_model; one shared probe per unknown key; 429 and 502
 * are classified non-quota and never touch the registry; all-exhausted yields one terminal
 * no-route result. Observability events feed the stall evidence/analyzer.
 *
 * Todo 4 verdict `rerouted` (evidence/harness-diagnostics-improve/task-4-falsifier.json) decided
 * this shape: the engine's own retry-fallback already reroutes configured chains, and its
 * SelectorCooldowns/probe scheduler are per AgentSession and never persisted, so every new worker
 * re-burns the same dead key. This delta adds exactly the missing cross-worker layer around it.
 *
 * Provenance of the policy semantics:
 *   - observed error shape: task-4-falsifier.json child_error payload
 *     `402: {"message":"Your subscription token allowance is exhausted for this model and PAYG
 *     fallback is disabled.","type":"insufficient_quota","code":"insufficient_quota",
 *     "status_code":402,...}` (routeway)
 *   - per-session analogue: senpi dist/core/retry-fallback/cooldown.js (quota/billing -> 30 min
 *     suppression, runtime-only) - this delta's TTL matches that duration but persists cross-worker
 *   - admission seam: wj (was tP; T:2 @468197/@490362 on beta.81), #Z guard seam (was #K;
 *     T:2 @502452-502645 on beta.81), event observer seam RP/OP (T:2 @480905-481941) from
 *     task-1-seams.json, re-anchored on the beta.84 base (P3 st_01a0cb41)
 */
// ==== @splice-spawn-barrier
await omoQuotaAdmissionBarrier(this.#E.store,t,d.task_id);
// ==== @splice-spawn-admit
g=omoQuotaAdmit(this.#E.store,t,this.#O,d.task_id,d.notification.run_epoch),{plan:v,lease:y}=g;if(void 0!==g.omoQuotaNoRoute)return omoQuotaNoRouteResult(this.#E.store,{taskId:d.task_id,name:h.name,category:d.category,executionMode:l,model:t.model,resolvedModel:t.resolved_model,runInBackground:!0===e.run_in_background,noRoute:g.omoQuotaNoRoute},()=>{try{y?.release()}catch{}try{h.name!==d.name&&this.#N.release(e.parent_session_id,h.name)}catch{}this.#j.delete(d.task_id)});
// ==== @splice-k-prune
omoQuotaObserveRuntimeFailure(this.#E.store,this.#W(e.taskId),e.outcome?.failure);
// ==== @splice-rp-observe
void 0!==r&&(omoQuotaObserveEvent(e,t,n,r),e.appendEvent(t,r))}
// ==== @defs
// ==== omoQuota:defs:begin
// ---------------------------------------------------------------------------
// omoQuota - hard-cap quota routing policy + observability (Todo 8, slot todo-8-quota).
// Self-contained: all engine state arrives through the `store` argument
// ({stateDir,load,replace,appendEvent,transition}); no engine-local symbol is referenced.
// ---------------------------------------------------------------------------
import { readFileSync as oqReadFileSync, writeFileSync as oqWriteFileSync, mkdirSync as oqMkdirSync, renameSync as oqRenameSync, rmSync as oqRmSync, statSync as oqStatSync } from "node:fs";
import { join as oqJoin, dirname as oqDirname } from "node:path";
import { createHash as oqCreateHash } from "node:crypto";

var omoQuotaSchema = "omo/quota-routing/keys/v1";
// Same duration the engine's own (per-session, non-persisted) quota cooldown uses
// (dist/core/retry-fallback/cooldown.js: quota|billing -> 30 min), persisted here so the
// next worker sees it. After expiry the key is unknown again and one shared probe re-tests it.
var omoQuotaTtlMs = 1800000;
// A successful probe marks the key available for a short window so a burst of workers that
// arrive together does not each become a probe owner.
var omoQuotaAvailableMs = 120000;
// Bounded wait for another task/process's in-flight probe. On timeout the waiter proceeds
// (fail-open) and records the timeout; correctness never depends on the wait.
var omoQuotaProbeWaitMs = 30000;
var omoQuotaProbeStaleMs = 60000;
var omoQuotaMaxKeys = 256;
var omoQuotaInProcess = { registries: new Map(), probes: new Map(), snapshots: new Map() };

function omoQuotaNow() { return Date.now(); }
function omoQuotaLower(value) { return "string" == typeof value ? value.trim().toLowerCase() : ""; }
function omoQuotaFirstString() { for (var i = 0; i < arguments.length; i += 1) { var value = arguments[i]; if ("string" == typeof value && value.length > 0) return value; } }
function omoQuotaSelectorParts(selector) {
  var text = "string" == typeof selector ? selector.trim() : "";
  var cut = text.indexOf("/");
  if (cut <= 0 || cut === text.length - 1) return;
  var provider = omoQuotaLower(text.slice(0, cut));
  var rest = text.slice(cut + 1);
  var colon = rest.lastIndexOf(":");
  var model = colon > 0 ? rest.slice(0, colon) : rest;
  if (provider.length === 0 || model.length === 0) return;
  return { provider: provider, model: model, selector: provider + "/" + model };
}
function omoQuotaEntryOf(value) {
  if (null === value || "object" != typeof value) return;
  var provider = omoQuotaLower(value.provider);
  var model = omoQuotaFirstString(value.model_id, value.model);
  var display = omoQuotaFirstString(value.display, value.model);
  if ("string" == typeof model && model.indexOf("/") > 0 && provider.length === 0) {
    var parsed = omoQuotaSelectorParts(model);
    if (undefined !== parsed) { provider = parsed.provider; model = model.slice(model.indexOf("/") + 1); }
  }
  if (provider.length === 0 || "string" != typeof model || model.length === 0) return;
  var selector = provider + "/" + model;
  return { provider: provider, model: model, display: display ?? selector, selector: selector, raw: value };
}
function omoQuotaKeyOfRecord(record) {
  if (null === record || "object" != typeof record) return;
  var entry = omoQuotaEntryOf(record.resolved_model) ?? omoQuotaEntryOf({ provider: undefined, model: record.model });
  return undefined === entry ? undefined : entry.selector;
}
function omoQuotaPlanEntries(plan) {
  var list = [];
  if (null === plan || "object" != typeof plan) return list;
  var head = omoQuotaEntryOf(plan.resolved_model) ?? omoQuotaEntryOf({ model: plan.model });
  if (undefined !== head) list.push({ index: 0, entry: head, model: plan.model ?? head.selector, resolved: plan.resolved_model });
  var chain = Array.isArray(plan.fallback_models) ? plan.fallback_models : [];
  for (var i = 0; i < chain.length; i += 1) {
    var entry = omoQuotaEntryOf(chain[i]);
    if (undefined === entry) continue;
    list.push({ index: i + 1, entry: entry, model: entry.display ?? entry.selector, resolved: chain[i] });
  }
  return list;
}
// Same enumeration, order and lane dedup as the existing admission helper wj (was tP on beta.81).
function omoQuotaCandidates(plan, tracker) {
  var raw = [];
  var head = omoQuotaEntryOf(plan?.resolved_model) ?? omoQuotaEntryOf({ model: plan?.model });
  if (undefined !== head) raw.push({ model: plan.model, resolved: plan.resolved_model, entry: head, chainIndex: -1 });
  var chain = Array.isArray(plan?.fallback_models) ? plan.fallback_models : [];
  for (var i = 0; i < chain.length; i += 1) {
    var entry = omoQuotaEntryOf(chain[i]);
    if (undefined === entry) continue;
    raw.push({ model: entry.display ?? entry.selector, resolved: chain[i], entry: entry, chainIndex: i });
  }
  var seen = new Set();
  var out = [];
  for (var j = 0; j < raw.length; j += 1) {
    var item = raw[j];
    var key = "string" == typeof item.model ? item.model : item.entry.selector;
    var lane = null !== tracker && "object" == typeof tracker && "function" == typeof tracker.getKey ? tracker.getKey(key) : key;
    if (seen.has(lane)) continue;
    seen.add(lane);
    out.push({ index: j, model: key, resolved: item.resolved, entry: item.entry, chainIndex: item.chainIndex, selector: item.entry.selector });
  }
  return out;
}
function omoQuotaRegistryFile(store) {
  var stateDir = store?.stateDir;
  if ("string" != typeof stateDir || stateDir.length === 0) return;
  return oqJoin(stateDir, "quota-routing", "keys.json");
}
function omoQuotaEmptyRegistry() { return { schema: omoQuotaSchema, revision: 0, updatedAtMs: 0, keys: {}, probes: {} }; }
function omoQuotaNormalizeRegistry(value, now) {
  var out = omoQuotaEmptyRegistry();
  if (null === value || "object" != typeof value || Array.isArray(value)) return out;
  out.revision = "number" == typeof value.revision && value.revision >= 0 ? Math.floor(value.revision) : 0;
  out.updatedAtMs = "number" == typeof value.updatedAtMs && value.updatedAtMs > 0 ? value.updatedAtMs : 0;
  var keys = null !== value.keys && "object" == typeof value.keys && !Array.isArray(value.keys) ? value.keys : {};
  var kept = 0;
  for (var key of Object.keys(keys)) {
    if (kept >= omoQuotaMaxKeys) break;
    var item = keys[key];
    if (null === item || "object" != typeof item) continue;
    var selector = omoQuotaSelectorParts(key) ?? omoQuotaSelectorParts(item.selector);
    if (undefined === selector) continue;
    var expiresAtMs = "number" == typeof item.expiresAtMs ? item.expiresAtMs : 0;
    var availableUntilMs = "number" == typeof item.availableUntilMs ? item.availableUntilMs : 0;
    if (expiresAtMs > 0 && expiresAtMs <= now && availableUntilMs <= now) continue; // expired -> unknown again
    kept += 1;
    out.keys[selector.selector] = {
      provider: selector.provider, model: selector.model, selector: selector.selector,
      exhaustedAtMs: "number" == typeof item.exhaustedAtMs && item.exhaustedAtMs > 0 ? item.exhaustedAtMs : 0,
      expiresAtMs: expiresAtMs, availableAtMs: "number" == typeof item.availableAtMs && item.availableAtMs > 0 ? item.availableAtMs : 0,
      availableUntilMs: availableUntilMs,
      sourceTaskId: "string" == typeof item.sourceTaskId ? item.sourceTaskId : null,
      evidence: null !== item.evidence && "object" == typeof item.evidence ? item.evidence : null
    };
  }
  var probes = null !== value.probes && "object" == typeof value.probes && !Array.isArray(value.probes) ? value.probes : {};
  for (var probeKey of Object.keys(probes)) {
    var probe = probes[probeKey];
    if (null === probe || "object" != typeof probe) continue;
    if ("number" == typeof probe.startedAtMs && probe.startedAtMs > 0 && now - probe.startedAtMs < omoQuotaProbeStaleMs) {
      probes[probeKey] = { taskId: "string" == typeof probe.taskId ? probe.taskId : null, pid: "number" == typeof probe.pid ? probe.pid : null, startedAtMs: probe.startedAtMs };
      out.probes[probeKey] = probes[probeKey];
    }
  }
  return out;
}
function omoQuotaLoad(store, options) {
  var file = omoQuotaRegistryFile(store);
  var now = omoQuotaNow();
  if (undefined === file) return omoQuotaEmptyRegistry();
  var mtimeMs = -1;
  try { mtimeMs = oqStatSync(file).mtimeMs; } catch { mtimeMs = -2; }
  var cached = omoQuotaInProcess.registries.get(file);
  if (!0 !== options?.fresh && undefined !== cached && cached.mtimeMs === mtimeMs) return cached.registry;
  var registry = omoQuotaEmptyRegistry();
  if (mtimeMs > 0) {
    try { registry = omoQuotaNormalizeRegistry(JSON.parse(oqReadFileSync(file, "utf8")), now); }
    catch { registry = omoQuotaEmptyRegistry(); } // malformed registry is ignored, never fatal
  }
  omoQuotaInProcess.registries.set(file, { mtimeMs: mtimeMs, registry: registry });
  return registry;
}
var omoQuotaSaveSeq = 0;
function omoQuotaSave(store, registry) {
  var file = omoQuotaRegistryFile(store);
  if (undefined === file) return false;
  try {
    oqMkdirSync(oqDirname(file), { recursive: true });
    var next = { ...registry, schema: omoQuotaSchema, revision: (registry.revision ?? 0) + 1, updatedAtMs: omoQuotaNow() };
    var temp = file + "." + process.pid + "." + (omoQuotaSaveSeq += 1) + ".tmp";
    try {
      oqWriteFileSync(temp, JSON.stringify(next) + "\n", "utf8");
      oqRenameSync(temp, file);
    } catch { try { oqRmSync(temp, { force: true }); } catch {} return false; }
    registry.revision = next.revision;
    registry.updatedAtMs = next.updatedAtMs;
    var mtimeMs = -1;
    try { mtimeMs = oqStatSync(file).mtimeMs; } catch { mtimeMs = -1; }
    omoQuotaInProcess.registries.set(file, { mtimeMs: mtimeMs, registry: registry });
    return true;
  } catch { return false; }
}
function omoQuotaStateOf(registry, selector, now) {
  if ("string" != typeof selector || selector.length === 0) return "unknown";
  var item = registry.keys[selector];
  if (undefined === item) return "unknown";
  if ("number" == typeof item.expiresAtMs && item.expiresAtMs > now) return "exhausted";
  if ("number" == typeof item.availableUntilMs && item.availableUntilMs > now) return "available";
  return "unknown";
}
// Strict structured classifier. Only a 402 body that itself carries insufficient_quota enters
// the quota path; 429 and 502 are non-quota by construction; an unstructured 402 stays unknown.
function omoQuotaExtractObject(value) {
  if (null !== value && "object" == typeof value && !Array.isArray(value)) {
    if (null !== value.error && "object" == typeof value.error) return value.error;
    return value;
  }
  if ("string" != typeof value) return;
  var start = value.indexOf("{");
  var end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return;
  try { return JSON.parse(value.slice(start, end + 1)); } catch { return; }
}
function omoQuotaStatusOf(body, fallback) {
  var nested = null !== body && "object" == typeof body && null !== body.error && "object" == typeof body.error ? body.error : undefined;
  var candidates = [body?.status_code, body?.statusCode, body?.status, body?.httpStatus, nested?.status_code, nested?.statusCode, nested?.status, nested?.httpStatus];
  for (var i = 0; i < candidates.length; i += 1) {
    var value = candidates[i];
    if ("number" == typeof value && Number.isFinite(value)) return value;
    if ("string" == typeof value && value.length > 0) { var parsed = Number(value); if (Number.isFinite(parsed)) return parsed; }
  }
  return fallback;
}
function omoQuotaCodeOf(body) {
  var nested = null !== body && "object" == typeof body && null !== body.error && "object" == typeof body.error ? body.error : undefined;
  return omoQuotaFirstString(body?.code, body?.type, body?.error_code, nested?.code, nested?.type, nested?.error_code);
}
function omoQuotaClassify(value) {
  var raw;
  var body;
  if ("string" == typeof value) {
    raw = value;
    body = omoQuotaExtractObject(raw);
  } else if (null !== value && "object" == typeof value && !Array.isArray(value)) {
    if ("string" == typeof value.message && value.message.length > 0) {
      raw = value.message;
      body = omoQuotaExtractObject(raw);
    } else {
      body = omoQuotaExtractObject(value);
      raw = JSON.stringify(value);
    }
  } else {
    raw = "";
    body = undefined;
  }
  if (("string" != typeof raw || raw.length === 0) && undefined === body) return { kind: "unknown", reason: "no-message", status: undefined, code: undefined };
  var leading;
  var head = /^\s*(\d{3})\s*[:)]?/.exec("string" == typeof raw ? raw : "");
  if (null !== head) leading = Number(head[1]);
  var status = omoQuotaStatusOf(body, leading);
  var code = omoQuotaCodeOf(body);
  if (429 === status) return { kind: "non_quota", status: 429, code: code ?? null, reason: "rate-limit", structured: undefined !== body };
  if (502 === status) return { kind: "non_quota", status: 502, code: code ?? null, reason: "upstream-gateway", structured: undefined !== body };
  if (402 !== status) return { kind: "non_quota", status: status ?? null, code: code ?? null, reason: "other-status", structured: undefined !== body };
  if ("insufficient_quota" === code) {
    return {
      kind: "quota", status: 402, code: code, structured: true,
      errorDigest: "sha256:" + oqCreateHash("sha256").update(raw).digest("hex"),
      sample: raw.slice(0, 240)
    };
  }
  return { kind: "unknown", status: 402, code: code ?? null, reason: "402-without-insufficient_quota", structured: undefined !== body };
}
function omoQuotaEvent(store, taskId, type, payload) {
  try { store.appendEvent(taskId, { type: type, payload: payload }); } catch {}
}
function omoQuotaSafeLoad(store, taskId) {
  try { return store.load(taskId); } catch { return undefined; }
}
function omoQuotaMarkExhausted(store, registry, selector, taskId, classification) {
  var entry = omoQuotaSelectorParts(selector);
  if (undefined === entry) return false;
  var now = omoQuotaNow();
  registry.keys[entry.selector] = {
    provider: entry.provider, model: entry.model, selector: entry.selector,
    exhaustedAtMs: now, expiresAtMs: now + omoQuotaTtlMs, availableAtMs: 0, availableUntilMs: 0,
    sourceTaskId: "string" == typeof taskId ? taskId : null,
    evidence: { status: 402, code: "insufficient_quota", structured: true, errorDigest: classification?.errorDigest ?? null, sample: classification?.sample ?? null }
  };
  omoQuotaSave(store, registry);
  omoQuotaEvent(store, taskId, "quota_key_exhausted", {
    key: entry.selector, provider: entry.provider, model: entry.model,
    expiresAtMs: registry.keys[entry.selector].expiresAtMs, ttlMs: omoQuotaTtlMs, sourceTaskId: taskId
  });
  return true;
}
function omoQuotaMarkAvailable(store, registry, selector, taskId, owner) {
  var entry = omoQuotaSelectorParts(selector);
  if (undefined === entry) return false;
  var now = omoQuotaNow();
  registry.keys[entry.selector] = {
    provider: entry.provider, model: entry.model, selector: entry.selector,
    exhaustedAtMs: 0, expiresAtMs: 0, availableAtMs: now, availableUntilMs: now + omoQuotaAvailableMs,
    sourceTaskId: "string" == typeof taskId ? taskId : null, evidence: null
  };
  omoQuotaSave(store, registry);
  return true;
}
// ---- shared probe -------------------------------------------------------------------------
// One probe per quota key: the first unknown-state worker claims it and its real provider
// request IS the probe; concurrent workers wait (bounded) for that resolution instead of
// firing their own burst. Claims live in-process AND in the registry file (cross-process).
function omoQuotaProbeHolder(registry, selector, now) {
  var claim = registry.probes[selector];
  if (undefined === claim) return;
  if ("number" != typeof claim.startedAtMs || now - claim.startedAtMs >= omoQuotaProbeStaleMs) return;
  return claim;
}
function omoQuotaProbeClaim(store, registry, selector, taskId) {
  var now = omoQuotaNow();
  var holder = omoQuotaProbeHolder(registry, selector, now);
  if (undefined !== holder && holder.taskId !== taskId) return { kind: "held", holder: holder };
  registry.probes[selector] = { taskId: "string" == typeof taskId ? taskId : null, pid: process.pid, startedAtMs: now };
  omoQuotaSave(store, registry);
  return { kind: "claimed", holder: registry.probes[selector] };
}
function omoQuotaProbeRelease(store, registry, selector, outcome, taskId) {
  if ("string" != typeof selector || selector.length === 0) return false;
  var holder = registry.probes[selector];
  var waiters = omoQuotaInProcess.probes.get(selector);
  if (undefined === holder && undefined === waiters) return false;
  if (undefined !== holder) {
    delete registry.probes[selector];
    omoQuotaSave(store, registry);
  }
  if (undefined !== waiters) {
    omoQuotaInProcess.probes.delete(selector);
    for (var waiter of waiters) {
      if (!0 === waiter.settled) continue;
      waiter.settled = true;
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      try { waiter.resolve({ kind: "resolved", selector: selector, outcome: outcome }); } catch {}
    }
  }
  omoQuotaEvent(store, taskId ?? holder?.taskId ?? null, "quota_probe_result", {
    key: selector, outcome: outcome, ownerTaskId: holder?.taskId ?? null, ownerPid: holder?.pid ?? null
  });
  return true;
}
function omoQuotaProbeWait(store, selector, taskId) {
  var waiters = omoQuotaInProcess.probes.get(selector);
  if (undefined === waiters) { waiters = []; omoQuotaInProcess.probes.set(selector, waiters); }
  return new Promise(function (resolve) {
    var waiter = { taskId: taskId, settled: false, resolve: resolve, timer: undefined };
    waiters.push(waiter);
    waiter.timer = setTimeout(function () {
      if (!0 === waiter.settled) return;
      waiter.settled = true;
      omoQuotaEvent(store, taskId, "quota_probe_wait_timeout", { key: selector, waitMs: omoQuotaProbeWaitMs });
      resolve({ kind: "timeout", selector: selector });
    }, omoQuotaProbeWaitMs);
    if (undefined !== waiter.timer && "function" == typeof waiter.timer.unref) waiter.timer.unref();
  });
}
async function omoQuotaAdmissionBarrier(store, plan, taskId) {
  try {
    if (undefined === omoQuotaRegistryFile(store)) return;
    var head = omoQuotaEntryOf(plan?.resolved_model) ?? omoQuotaEntryOf({ model: plan?.model });
    if (undefined === head) return;
    var started = omoQuotaNow();
    for (;;) {
      var registry = omoQuotaLoad(store, { fresh: true });
      if ("unknown" !== omoQuotaStateOf(registry, head.selector, omoQuotaNow())) return; // resolved meanwhile
      var holder = omoQuotaProbeHolder(registry, head.selector, omoQuotaNow());
      if (undefined === holder || holder.taskId === taskId) return; // nothing to wait for (or self)
      var remaining = omoQuotaProbeWaitMs - (omoQuotaNow() - started);
      if (remaining <= 0) {
        omoQuotaEvent(store, taskId, "quota_probe_wait_timeout", { key: head.selector, waitMs: omoQuotaProbeWaitMs, holderTaskId: holder.taskId ?? null });
        return;
      }
      omoQuotaEvent(store, taskId, "quota_probe_waited", { key: head.selector, holderTaskId: holder.taskId ?? null, holderPid: holder.pid ?? null });
      if (holder.pid === process.pid) {
        await omoQuotaProbeWait(store, head.selector, taskId); // same-process resolution is event-driven
      } else {
        await new Promise(function (resolve) { var timer = setTimeout(resolve, 250); if ("function" == typeof timer.unref) timer.unref(); }); // cross-process: poll the registry state
      }
    }
  } catch {}
}
// ---- freeze + admission -------------------------------------------------------------------
function omoQuotaFreeze(store, registry, plan, taskId, epoch) {
  var now = omoQuotaNow();
  var entries = omoQuotaPlanEntries(plan);
  var snapshot = {
    taskId: taskId, epoch: epoch, revision: registry.revision, frozenAtMs: now,
    requestedModel: plan?.requested_model ?? null,
    resolved: undefined !== entries[0] ? entries[0].entry.selector : null,
    chain: entries.map(function (item) { return { index: item.index, key: item.entry.selector, display: item.model }; }),
    keyStates: entries.map(function (item) { return { key: item.entry.selector, state: omoQuotaStateOf(registry, item.entry.selector, now) }; }),
    approvedProviders: [...new Set(entries.map(function (item) { return item.entry.provider; }))],
    ttlMs: omoQuotaTtlMs, probeWaitMs: omoQuotaProbeWaitMs, schema: omoQuotaSchema
  };
  omoQuotaInProcess.snapshots.set(taskId + ":" + epoch, snapshot);
  omoQuotaEvent(store, taskId, "quota_policy_frozen", {
    epoch: epoch, revision: snapshot.revision, requested_model: snapshot.requestedModel, resolved: snapshot.resolved,
    chain: snapshot.chain, key_states: snapshot.keyStates, ttl_ms: omoQuotaTtlMs
  });
  return snapshot;
}
function omoQuotaRewritePlan(plan, candidates, selected) {
  var after = candidates.filter(function (item) { return item.index > selected.index; }).map(function (item) { return item.resolved ?? item.entry.raw; });
  if (selected.index === 0) {
    var chain = Array.isArray(plan?.fallback_models) ? plan.fallback_models : [];
    if (after.length > 0) return { ...plan, fallback_models: after };
    if (chain.length === 0) return plan;
    return { ...plan, fallback_models: [] };
  }
  return { ...plan, model: selected.model, resolved_model: selected.resolved ?? selected.entry.raw, fallback_models: after };
}
function omoQuotaLeaseLane(result) {
  try {
    var plan = result?.plan;
    return "string" == typeof plan?.model ? plan.model : null;
  } catch { return null; }
}
function omoQuotaAdmit(store, plan, tracker, taskId, epoch) {
  try {
    if (undefined === omoQuotaRegistryFile(store)) return wj(plan, tracker, taskId, epoch);
    var registry = omoQuotaLoad(store);
    var snapshot = omoQuotaFreeze(store, registry, plan, taskId, epoch);
    var candidates = omoQuotaCandidates(plan, tracker);
    if (candidates.length === 0) return wj(plan, tracker, taskId, epoch);
    var now = omoQuotaNow();
    var filtered = [];
    var skipped = [];
    for (var item of candidates) {
      if ("exhausted" === omoQuotaStateOf(registry, item.selector, now)) { skipped.push(item); continue; }
      filtered.push(item);
    }
    if (filtered.length === 0) {
      var keys = candidates.map(function (entry) { return entry.selector; });
      omoQuotaEvent(store, taskId, "quota_no_route", {
        epoch: epoch, keys: keys, requested_model: snapshot.requestedModel, revision: registry.revision,
        key_states: snapshot.keyStates, ttl_ms: omoQuotaTtlMs
      });
      return { plan: plan, lease: undefined, omoQuotaNoRoute: { kind: "quota_no_route", keys: keys, requestedModel: snapshot.requestedModel, epoch: epoch, revision: registry.revision } };
    }
    for (var visit of skipped) {
      omoQuotaEvent(store, taskId, "quota_route_skipped", {
        key: visit.selector, index: visit.index, reason: "exhausted", revision: registry.revision,
        expiresAtMs: registry.keys[visit.selector]?.expiresAtMs ?? null
      });
    }
    if (filtered.length === candidates.length) {
      var base = wj(plan, tracker, taskId, epoch);
      omoQuotaAfterAdmit(store, registry, snapshot, base, taskId, epoch, false);
      return base;
    }
    var prunedPlan = omoQuotaRewritePlan(plan, filtered, filtered[0]);
    var baseFiltered = wj(prunedPlan, tracker, taskId, epoch);
    omoQuotaEvent(store, taskId, "quota_route_selected", {
      mode: "preskip", from: candidates[0].selector, to: filtered[0].selector, to_index: filtered[0].index,
      lease_lane: omoQuotaLeaseLane(baseFiltered), revision: registry.revision
    });
    omoQuotaAfterAdmit(store, registry, snapshot, baseFiltered, taskId, epoch, true);
    return baseFiltered;
  } catch {
    return wj(plan, tracker, taskId, epoch); // policy must never break admission
  }
}
function omoQuotaAfterAdmit(store, registry, snapshot, base, taskId, epoch, rewrote) {
  try {
    var lane = omoQuotaLeaseLane(base);
    var selector = omoQuotaSelectorParts(lane);
    if (undefined !== selector) {
      if (undefined !== base?.lease) {
        omoQuotaEvent(store, taskId, "quota_route_reserved", {
          key: selector.selector, lane: lane, epoch: epoch, index_in_frozen_chain: snapshot.chain.findIndex(function (item) { return item.key === selector.selector; })
        });
      }
      var fresh = omoQuotaLoad(store);
      if ("unknown" === omoQuotaStateOf(fresh, selector.selector, omoQuotaNow())) {
        var claim = omoQuotaProbeClaim(store, fresh, selector.selector, taskId);
        omoQuotaEvent(store, taskId, "quota_probe", {
          key: selector.selector, role: claim.kind === "claimed" ? "owner" : "waiter-after-wait",
          rewrote: !0 === rewrote, epoch: epoch, holderTaskId: claim.kind === "held" ? claim.holder.taskId ?? null : taskId
        });
      }
    }
  } catch {}
}
// ---- runtime failure + engine event observation -------------------------------------------
function omoQuotaPruneRecord(record, registry, now) {
  if (null === record || "object" != typeof record) return record;
  var chain = Array.isArray(record.fallback_models) ? record.fallback_models : [];
  var kept = chain.filter(function (entry) { var parsed = omoQuotaEntryOf(entry); return undefined === parsed || "exhausted" !== omoQuotaStateOf(registry, parsed.selector, now); });
  if (kept.length === chain.length) return record;
  return { ...record, fallback_models: kept };
}
function omoQuotaObserveRuntimeFailure(store, record, failure) {
  try {
    if (null == record || "object" != typeof record) return;
    var classification = omoQuotaClassify(failure);
    if ("quota" === classification.kind) {
      var registry = omoQuotaLoad(store);
      var key = omoQuotaKeyOfRecord(record);
      omoQuotaMarkExhausted(store, registry, key, record.task_id, classification);
      var pruned = omoQuotaPruneRecord(record, registry, omoQuotaNow());
      if (pruned !== record) {
        try { store.replace(pruned); } catch {}
        if (Array.isArray(pruned.fallback_models) && pruned.fallback_models.length === 0) {
          omoQuotaEvent(store, record.task_id, "quota_chain_spent", { key: key, runtime_chain_empty: true });
        }
      }
      omoQuotaProbeRelease(store, registry, key, "exhausted", record.task_id);
    } else if (429 === classification.status || 502 === classification.status || (402 === classification.status && "unknown" === classification.kind)) {
      // Observability only: 429/502 never enter the quota path; an unstructured 402 is unknown.
      omoQuotaEvent(store, record.task_id, "quota_classified_non_quota", {
        key: omoQuotaKeyOfRecord(record) ?? null, status: classification.status ?? null, kind: classification.kind,
        reason: classification.reason ?? null, structured: !0 === classification.structured
      });
    }
  } catch {}
}
function omoQuotaObserveEvent(store, taskId, raw, event) {
  try {
    if (undefined === omoQuotaRegistryFile(store)) return;
    var type = event?.type;
    if ("child_error" === type) {
      var classification = omoQuotaClassify(event?.payload?.message ?? event?.payload);
      var record = omoQuotaSafeLoad(store, taskId);
      var key = omoQuotaKeyOfRecord(record);
      if ("quota" === classification.kind) {
        var registry = omoQuotaLoad(store);
        omoQuotaMarkExhausted(store, registry, key, taskId, classification);
        omoQuotaProbeRelease(store, registry, key, "exhausted", taskId);
      } else if (429 === classification.status || 502 === classification.status || (402 === classification.status && "unknown" === classification.kind)) {
        omoQuotaEvent(store, taskId, "quota_classified_non_quota", {
          key: key ?? null, status: classification.status ?? null, kind: classification.kind,
          reason: classification.reason ?? null, structured: !0 === classification.structured
        });
        if (429 === classification.status || 502 === classification.status) {
          omoQuotaProbeRelease(store, omoQuotaLoad(store), key, "available", taskId);
        }
      }
      return;
    }
    if ("assistant_message" === type) {
      var answered = omoQuotaSafeLoad(store, taskId);
      var answeredKey = omoQuotaKeyOfRecord(answered);
      if (undefined !== answeredKey) {
        var registryAnswered = omoQuotaLoad(store);
        // A served turn is proof the key works: unknown -> available (an exhausted mark is kept
        // until its TTL expires, so a stray engine-side use cannot silently clear exhaustion).
        if ("unknown" === omoQuotaStateOf(registryAnswered, answeredKey, omoQuotaNow())) omoQuotaMarkAvailable(store, registryAnswered, answeredKey, taskId, false);
        omoQuotaProbeRelease(store, registryAnswered, answeredKey, "available", taskId);
      }
      return;
    }
    if ("retry_fallback_applied" === type) {
      var to = omoQuotaSelectorParts(event?.payload?.to);
      if (undefined === to) return;
      var current = omoQuotaKeyOfRecord(omoQuotaSafeLoad(store, taskId));
      var registryTo = omoQuotaLoad(store);
      omoQuotaMarkAvailable(store, registryTo, to.selector, taskId, true);
      omoQuotaProbeRelease(store, registryTo, to.selector, "available", taskId);
      if (undefined !== current && current !== to.selector) omoQuotaProbeRelease(store, registryTo, current, "exhausted", taskId);
      omoQuotaEvent(store, taskId, "quota_route_transition", {
        from: event?.payload?.from ?? null, to: to.selector, reason: event?.payload?.reason ?? null,
        chain_key: event?.payload?.chain_key ?? null, pin: "engine-retry-fallback"
      });
    }
  } catch {}
}
function omoQuotaNoRouteResult(store, info, release) {
  try { if ("function" == typeof release) release(); } catch {}
  var timestamp = omoQuotaNow();
  var keys = Array.isArray(info?.noRoute?.keys) ? info.noRoute.keys : [];
  var message = "quota_no_route: every approved route for this execution is quota-exhausted (" + keys.join(", ") + ")";
  try { store.transition(info.taskId, { type: "start", timestamp: timestamp }); } catch {}
  try { store.transition(info.taskId, { type: "fail", timestamp: timestamp, error_message: message }); } catch {}
  omoQuotaEvent(store, info.taskId, "quota_no_route_terminal", {
    keys: keys, requested_model: info.noRoute?.requestedModel ?? null, epoch: info.noRoute?.epoch ?? null,
    revision: info.noRoute?.revision ?? null, message: message
  });
  return {
    kind: "start_failed", task_id: info.taskId, name: info.name,
    ...(undefined !== info.category ? { category: info.category } : {}),
    execution_mode: info.executionMode, model: info.model,
    ...(undefined !== info.resolvedModel ? { resolved_model: info.resolvedModel } : {}),
    run_in_background: !0 === info.runInBackground, error_message: message
  };
}
// ==== omoQuota:defs:end
