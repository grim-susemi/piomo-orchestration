// omo custom layer: Windows task-record publication retry (elapsed-time-bounded, plan D9 r4).
//
// A task-record save (tmp + renameSync onto senpi-task/tasks/st_*.json) can hit
// momentary EPERM/EBUSY/EACCES when a watcher or a second session holds the
// target. This wrapper retries the rename with sleeps, but never starts a sleep
// or an attempt that would end past `budgetMs` (default 1000 ms), judged by the
// slowest attempt measured so far in the same call (`maxAttempt`) and by a
// sleep-overshoot reserve (`max(20, maxOvershoot)`). On exhaustion it schedules
// one JSON log line asynchronously (setImmediate) and rethrows at once, so the
// log never blocks the calling thread.
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

export const INSTALLED = Symbol.for("omo.custom.taskRecordPublishRetry.v1");
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const TMP_RE = /^(.*[\\/]senpi-task[\\/]tasks[\\/]st_[0-9a-z]+\.json)\.\d+\.[0-9a-f]{8}\.tmp$/i;
export const DELAYS_MS = Object.freeze([5, 10, 20, 40, 60, 80, 100, 120, 140, 160, 165]);
const BUDGET_MS = 1000;
// Circuit breaker, per destination record: after one call on a record exhausts its budget (a lock
// that outlasts it is persistent, and callers retry in a tight loop), later publications of THAT
// record within this window make a single attempt with no sleep, i.e. the stock behaviour. Other
// records keep the full retry budget. Blocking is bounded to ~one budget per record per cooldown.
const COOLDOWN_MS = 10000;
const ROTATE_BYTES = 1024 * 1024;

export function isTaskRecordPublication(src, dest) {
  if (typeof src !== "string" || typeof dest !== "string") return false;
  const m = TMP_RE.exec(src);
  return m !== null && path.resolve(m[1]) === path.resolve(dest);
}

function agentLogDir() {
  return process.env.OMO_CODING_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR;
}

export async function defaultLog(info) {
  const agentDir = agentLogDir();
  if (!agentDir) throw new Error("no agent dir (OMO_CODING_AGENT_DIR/PI_CODING_AGENT_DIR)");
  const dir = path.join(agentDir, "logs");
  const file = path.join(dir, "task-record-publish-retry.log");
  await fs.promises.mkdir(dir, { recursive: true });
  try {
    const st = await fs.promises.stat(file);
    if (st.size > ROTATE_BYTES) await fs.promises.rename(file, `${file}.1`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.promises.appendFile(file, `${JSON.stringify(info)}\n`, "utf8");
}

function exhaustionInfo({ src, code, attempts, start, maxAttempt, now }) {
  return {
    ts: new Date().toISOString(),
    event: "publish_retry_exhausted",
    src,
    code,
    attempts,
    elapsedMs: now() - start,
    maxAttemptMs: maxAttempt,
  };
}

export function createRetryingRename({
  rename,
  sleep,
  now = () => performance.now(),
  log = defaultLog,
  budgetMs = BUDGET_MS,
  cooldownMs = COOLDOWN_MS,
  delays = DELAYS_MS,
  platform = process.platform,
} = {}) {
  const state = { installed: false, pendingLog: null, logFailures: 0, lastLogError: null, exhaustedAt: new Map(), tripped: 0 };

  const recordKey = (dest) => path.resolve(dest).toLowerCase();

  function scheduleExhaustionLog(info, dest) {
    const key = recordKey(dest);
    state.exhaustedAt.set(key, now());
    if (state.exhaustedAt.size > 256) {
      for (const [k, at] of state.exhaustedAt) if (now() - at >= cooldownMs) state.exhaustedAt.delete(k);
    }
    state.pendingLog = new Promise((resolve) => {
      setImmediate(() => {
        Promise.resolve()
          .then(() => log(info))
          .catch((error) => {
            state.logFailures += 1;
            state.lastLogError = error instanceof Error ? error.message : String(error);
          })
          .then(resolve);
      });
    });
  }

  function renameSync(src, dest) {
    if (platform !== "win32" || !isTaskRecordPublication(src, dest)) return rename(src, dest);
    const start = now();
    const exhaustedAt = state.exhaustedAt.get(recordKey(dest));
    if (exhaustedAt !== undefined && start - exhaustedAt < cooldownMs) {
      state.tripped += 1;
      const result = rename(src, dest);
      state.exhaustedAt.delete(recordKey(dest));
      return result;
    }
    let maxAttempt = 0;
    let maxOvershoot = 0;
    let sleepIndex = 0;
    let attempts = 0;
    for (;;) {
      const t0 = now();
      attempts += 1;
      try {
        return rename(src, dest);
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (!RETRYABLE.has(code)) throw error;
        maxAttempt = Math.max(maxAttempt, now() - t0);
        const reserve = Math.max(20, maxOvershoot);
        const nextDelay = delays[Math.min(sleepIndex, delays.length - 1)];
        const allowance = Math.min(nextDelay, budgetMs - (now() - start) - maxAttempt - reserve);
        if (allowance <= 0) {
          scheduleExhaustionLog(exhaustionInfo({ src, code, attempts, start, maxAttempt, now }), dest);
          throw error;
        }
        const sleepStart = now();
        sleep(allowance);
        maxOvershoot = Math.max(maxOvershoot, now() - sleepStart - allowance);
        sleepIndex += 1;
        if (budgetMs - (now() - start) - maxAttempt <= 0) {
          scheduleExhaustionLog(exhaustionInfo({ src, code, attempts, start, maxAttempt, now }), dest);
          throw error;
        }
      }
    }
  }

  renameSync.state = state;
  return renameSync;
}

export function install() {
  if (fs.renameSync[INSTALLED] === true) return false;
  const existing = globalThis[INSTALLED];
  if (existing !== undefined && existing !== null && existing.installed === true) return false;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const wrapped = createRetryingRename({
    rename: fs.renameSync.bind(fs),
    sleep: (ms) => {
      Atomics.wait(cell, 0, 0, ms);
    },
    now: () => performance.now(),
    log: defaultLog,
  });
  wrapped.state.installed = true;
  Object.defineProperty(wrapped, INSTALLED, { value: true });
  fs.renameSync = wrapped;
  syncBuiltinESMExports();
  globalThis[INSTALLED] = wrapped.state;
  return true;
}

export default function omoTaskRecordPublishRetry() {
  install();
}
