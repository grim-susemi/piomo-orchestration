// omo custom layer: Windows task-record publication retry (proposed, owner decision 18=A)
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const INSTALLED = Symbol.for("omo.custom.taskRecordPublishRetry.v1");
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const TMP_RE = /^(.*[\\/]senpi-task[\\/]tasks[\\/]st_[0-9a-z]+\.json)\.\d+\.[0-9a-f]{8}\.tmp$/i;
export const DELAYS_MS = Object.freeze([10, 20, 40, 80, 160, 250, 250, 250, 250, 250]);
const EXHAUSTED_LIMIT = 64;

export function isTaskRecordPublication(src, dest) {
  if (typeof src !== "string" || typeof dest !== "string") return false;
  const m = TMP_RE.exec(src);
  return m !== null && path.resolve(m[1]) === path.resolve(dest);
}

export function createRetryingRename({ rename, sleep, delays = DELAYS_MS, platform = process.platform }) {
  const exhausted = new Set();
  return function renameSync(src, dest) {
    if (platform !== "win32" || !isTaskRecordPublication(src, dest) || exhausted.has(src)) return rename(src, dest);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return rename(src, dest);
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (!RETRYABLE.has(code)) throw error;
        if (attempt >= delays.length) {
          exhausted.add(src);
          if (exhausted.size > EXHAUSTED_LIMIT) exhausted.delete(exhausted.values().next().value);
          throw error;
        }
        sleep(delays[attempt]);
      }
    }
  };
}

export function install() {
  if (fs.renameSync[INSTALLED] === true) return false;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  const wrapped = createRetryingRename({ rename: fs.renameSync.bind(fs), sleep: (ms) => Atomics.wait(cell, 0, 0, ms) });
  Object.defineProperty(wrapped, INSTALLED, { value: true });
  fs.renameSync = wrapped;
  syncBuiltinESMExports();
  return true;
}

export default function omoTaskRecordPublishRetry() {
  install();
}
