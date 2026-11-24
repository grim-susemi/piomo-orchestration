// Records every mutating file-system call the isolated host makes, so the probe
// can report attempted external writes instead of inferring them from hashes.
// This is loaded into the host process with NODE_OPTIONS=--require.
const fs = require("node:fs");
const path = require("node:path");

const LOG = process.env.PRC_WRITE_LOG;
const ROOT = process.env.PRC_WRITE_ROOT;
if (LOG && ROOT) {
  const rawOpen = fs.openSync.bind(fs);
  const rawWriteSync = fs.writeSync.bind(fs);
  let logFd = null;
  try { logFd = rawOpen(LOG, "a"); } catch { logFd = null; }
  const rootNorm = path.resolve(ROOT).replaceAll("\\", "/").toLowerCase();
  const cwdNorm = path.resolve(process.cwd()).replaceAll("\\", "/").toLowerCase();
  const logNorm = path.resolve(LOG).replaceAll("\\", "/").toLowerCase();
  const inside = (target) => {
    if (typeof target === "number") return true;
    if (typeof target !== "string" || target.length === 0) return true;
    let resolved;
    try {
      resolved = path.resolve(process.cwd(), target).replaceAll("\\", "/").toLowerCase();
    } catch {
      return true;
    }
    if (resolved === logNorm) return true;
    return resolved === rootNorm
      || resolved.startsWith(`${rootNorm}/`)
      || resolved === cwdNorm
      || resolved.startsWith(`${cwdNorm}/`);
  };
  const record = (op, target) => {
    const isInside = inside(target);
    try {
      const payload = { op, path: String(target), inside: isInside };
      if (!isInside) {
        // Attribute external attempts to the code that made them.  The host
        // runtime cleans its own .pi-native-quarantine; the candidate must not
        // write outside the isolated root.
        payload.stack = (new Error().stack ?? "")
          .split("\n")
          .slice(1, 6)
          .map((frame) => frame.trim());
      }
      // Write through a descriptor opened before patching: both writeFileSync
      // and appendFileSync call the patched openSync/writeFileSync internally.
      if (logFd !== null) rawWriteSync(logFd, `${JSON.stringify(payload)}\n`);
    } catch {
      // The probe reads a missing log as "no attempt recorded".
    }
  };
  const wrap = (object, name, index = 0) => {
    const original = object?.[name];
    if (typeof original !== "function") return;
    object[name] = function wrapped(...args) {
      record(name, args[index]);
      return original.apply(this, args);
    };
  };
  for (const name of [
    "writeFileSync",
    "appendFileSync",
    "mkdirSync",
    "rmSync",
    "rmdirSync",
    "unlinkSync",
    "renameSync",
    "copyFileSync",
    "cpSync",
  ]) {
    wrap(fs, name, name === "copyFileSync" ? 1 : 0);
  }
  const originalOpen = fs.openSync;
  if (typeof originalOpen === "function") {
    fs.openSync = function openSyncPatched(target, flags, ...rest) {
      if (typeof flags === "string" && /[wa+]/u.test(flags)) record("openSync", target);
      return originalOpen.call(this, target, flags, ...rest);
    };
  }
  let promises = null;
  try { promises = require("node:fs/promises"); } catch { promises = null; }
  if (promises) {
    for (const name of [
      "writeFile",
      "appendFile",
      "mkdir",
      "rm",
      "rmdir",
      "unlink",
      "rename",
      "copyFile",
      "cp",
    ]) {
      wrap(promises, name, name === "copyFile" || name === "cp" ? 1 : 0);
    }
  }
}
