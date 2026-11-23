import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

export const SCHEMA = "plan-review-convergence/budget/v1";
export const DEFAULT_BUDGET = 5;
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;

export function resolveBudget(explicit) {
  if (explicit === undefined || explicit === null) return DEFAULT_BUDGET;
  if (!Number.isInteger(explicit) || explicit < 1 || explicit > 5) {
    throw new Error("INVALID_BUDGET");
  }
  return explicit;
}

export function logicalKey({ workspaceId, workspaceRoot, planPath, cwd }) {
  if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    throw new Error("WORKSPACE_ID_REQUIRED");
  }
  if (typeof planPath !== "string" || planPath.trim().length === 0) {
    throw new Error("PLAN_PATH_REQUIRED");
  }
  const root = resolve(workspaceRoot ?? cwd ?? process.cwd());
  const absolute = isAbsolute(planPath) ? planPath : resolve(cwd ?? root, planPath);
  const relativePath = relative(root, absolute).replaceAll("\\", "/");
  if (relativePath.length === 0 || relativePath.startsWith("..")) {
    throw new Error("PLAN_OUTSIDE_WORKSPACE");
  }
  const canonical = relativePath.replace(/\/+/g, "/").replace(/^\.\//, "");
  return {
    key: `${workspaceId.trim().toLowerCase()}::${canonical.toLowerCase()}`,
    canonical,
    workspaceId,
  };
}

function stateDir(root, key) {
  return join(root, createHash("sha256").update(key).digest("hex").slice(0, 16));
}

function stateFiles(root, key) {
  const dir = stateDir(root, key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^state-\d+\.json$/u.test(name))
    .sort((left, right) => Number(left.match(/\d+/u)[0]) - Number(right.match(/\d+/u)[0]));
}

function validate(state, key, revision) {
  if (!state || state.schema !== SCHEMA || state.W !== key) throw new Error("STATE_INVALID");
  if (state.revision !== revision) throw new Error("STATE_REVISION_MISMATCH");
  if (!Number.isInteger(state.B) || state.B < 1 || state.B > 5) throw new Error("STATE_INVALID");
  if (!Number.isInteger(state.U) || state.U < 0) throw new Error("STATE_INVALID");
  if (!Number.isInteger(state.autoUsed) || state.autoUsed < 0) throw new Error("STATE_INVALID");
  if (!Number.isInteger(state.manualUsed) || state.manualUsed < 0) throw new Error("STATE_INVALID");
  return state;
}

function readAll(root, key) {
  const states = [];
  for (const name of stateFiles(root, key)) {
    const revision = Number(name.match(/\d+/u)[0]);
    const path = join(stateDir(root, key), name);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      throw new Error("STATE_CORRUPT");
    }
    states.push(validate(parsed, key, revision));
  }
  return states;
}

export function readState(root, key) {
  const states = readAll(root, key);
  return states.length === 0 ? null : states[states.length - 1];
}

function withLock(root, key, fn) {
  const dir = stateDir(root, key);
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, ".lock");
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() > deadline) throw new Error("LOCK_TIMEOUT");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

function writeRevision(root, key, state) {
  const path = join(stateDir(root, key), `state-${state.revision}.json`);
  writeFileSync(path, `${JSON.stringify(state)}\n`, { flag: "wx" });
  return state;
}

export function initialize({ root, workspaceId, workspaceRoot, planPath, cwd, planSha256, explicitLimit, draftLimit }) {
  const { key } = logicalKey({ workspaceId, workspaceRoot, planPath, cwd });
  const budget = resolveBudget(explicitLimit);
  return withLock(root, key, () => {
    const existing = readState(root, key);
    if (existing) return { ok: true, state: existing, created: false };
    const state = {
      schema: SCHEMA,
      W: key,
      B: budget,
      U: 0,
      autoUsed: 0,
      manualUsed: 0,
      revision: 0,
      status: "ready",
      stopReason: null,
      roundNo: null,
      planSha256: planSha256 ?? null,
      launchKey: null,
      childReceiptId: null,
      usedOwnerEventIds: [],
    };
    // A draft's review_round_limit is deliberately ignored; only the
    // host-verified explicit 1-5 request limit can lower B.
    void draftLimit;
    writeRevision(root, key, state);
    return { ok: true, state, created: true };
  });
}

export function reserve({
  root,
  workspaceId,
  workspaceRoot,
  planPath,
  cwd,
  planSha256,
  roundNo,
  launchKey,
  kind = "auto",
  ownerEventId,
  allowStopped = false,
  beforeWrite,
  afterWrite,
}) {
  const { key } = logicalKey({ workspaceId, workspaceRoot, planPath, cwd });
  if (typeof launchKey !== "string" || launchKey.length === 0) throw new Error("LAUNCH_KEY_REQUIRED");
  return withLock(root, key, () => {
    const history = readAll(root, key);
    if (history.length === 0) return { ok: false, reason: "NO_STATE" };
    const existing = history.find((state) => state.launchKey === launchKey);
    if (existing) return { ok: true, state: existing, duplicate: true };
    const state = history[history.length - 1];
    if (state.status === "stop-unknown") {
      return { ok: false, reason: "STATE_STOPPED" };
    }
    if (state.status === "stopped" && !(kind === "manual" && allowStopped === true)) {
      return { ok: false, reason: "STATE_STOPPED" };
    }
    if (kind === "auto") {
      if (state.autoUsed >= state.B) return { ok: false, reason: "BUDGET_EXHAUSTED" };
    } else if (kind === "manual") {
      if (!ownerEventId) return { ok: false, reason: "OWNER_EVENT_REQUIRED" };
      if (state.usedOwnerEventIds.includes(ownerEventId)) return { ok: false, reason: "OWNER_EVENT_REUSED" };
      if (state.manualUsed >= 1) return { ok: false, reason: "MANUAL_EXHAUSTED" };
    } else {
      return { ok: false, reason: "INVALID_KIND" };
    }
    beforeWrite?.(state);
    const next = {
      ...state,
      revision: state.revision + 1,
      U: state.U + 1,
      autoUsed: state.autoUsed + (kind === "auto" ? 1 : 0),
      manualUsed: state.manualUsed + (kind === "manual" ? 1 : 0),
      status: "reserved",
      roundNo: roundNo ?? state.roundNo,
      planSha256: planSha256 ?? state.planSha256,
      launchKey,
      childReceiptId: null,
      usedOwnerEventIds: kind === "manual"
        ? [...state.usedOwnerEventIds, ownerEventId]
        : state.usedOwnerEventIds,
    };
    writeRevision(root, key, next);
    afterWrite?.(next);
    return { ok: true, state: next };
  });
}

export function complete({ root, workspaceId, workspaceRoot, planPath, cwd, launchKey, childReceiptId }) {
  const { key } = logicalKey({ workspaceId, workspaceRoot, planPath, cwd });
  if (typeof launchKey !== "string" || launchKey.length === 0) throw new Error("LAUNCH_KEY_REQUIRED");
  if (typeof childReceiptId !== "string" || childReceiptId.length === 0) {
    throw new Error("CHILD_RECEIPT_REQUIRED");
  }
  return withLock(root, key, () => {
    const history = readAll(root, key);
    const matches = history.filter((state) => state.launchKey === launchKey);
    if (matches.length === 0) return { ok: false, reason: "UNKNOWN_LAUNCH" };
    const completed = [...matches].reverse().find((state) => state.childReceiptId);
    if (completed) {
      return { ok: true, state: completed, duplicate: true };
    }
    const state = history[history.length - 1];
    const next = {
      ...state,
      revision: state.revision + 1,
      status: "completed",
      childReceiptId,
    };
    writeRevision(root, key, next);
    return { ok: true, state: next };
  });
}

export function markStop({ root, workspaceId, workspaceRoot, planPath, cwd, reason }) {
  const { key } = logicalKey({ workspaceId, workspaceRoot, planPath, cwd });
  return withLock(root, key, () => {
    const state = readState(root, key);
    if (!state) return { ok: false, reason: "NO_STATE" };
    const next = {
      ...state,
      revision: state.revision + 1,
      status: reason === "STOP_UNKNOWN" ? "stop-unknown" : "stopped",
      stopReason: reason,
    };
    writeRevision(root, key, next);
    return { ok: true, state: next };
  });
}
