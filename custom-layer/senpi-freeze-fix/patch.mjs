#!/usr/bin/env node
// Managed anchor patch for the senpi freeze fix (plan research-session-freeze-fix,
// decisions D2/D3).
//
//   patch.mjs --senpi-root <dir> (--check | --apply | --remove) [--receipt <file>]
//
// --check  read-only on any version, always exits 0, prints CHECK {json}.
// --apply  writes four files atomically (.freeze-fix.bak / .freeze-fix.new /
//          rename); exits 2 on an unsupported version or unknown file; exits 3
//          after rolling back a failed write; a second run is a no-op.
// --remove restores the pristine files from their .freeze-fix.bak backups after
//          a hash check; same exit codes.
//
// The test-only SENPI_FREEZE_FIX_TEST_FAIL_RENAME=<n> environment variable makes
// the n-th into-place rename throw, so the rollback path is exercised by
// test/patch.test.mjs. It is never set outside tests.

import { createHash } from "node:crypto";
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES_PATH = join(HERE, "baselines.json");
const PREDICATE_PATH = join(HERE, "unc-timeout-predicate.mjs");
const BACKUP_SUFFIX = ".freeze-fix.bak";
const NEW_SUFFIX = ".freeze-fix.new";

const FILE_COMMAND_PATHS =
  "dist/core/extensions/builtin/moved-path-guard/command-paths.js";
const FILE_FILESYSTEM_POLICY = "dist/core/tools/filesystem-policy.js";
const FILE_CHUNK = "dist/bundle/chunks/chunk-35M5MVUZ.js";
const FILE_SESSION_WORKER = "dist/bundle/chunks/session-worker.js";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function countOccurrences(text, needle) {
  let count = 0;
  let index = 0;
  for (;;) {
    index = text.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

function lines(...parts) {
  return parts.join("\n");
}

/** The predicate body shipped by unc-timeout-predicate.mjs, export removed. */
async function predicateSource() {
  const text = await readFile(PREDICATE_PATH, "utf8");
  return text.replace(/^export /m, "").trim();
}

const EMBEDDED_PATHS_GUARD = lines(
  '        if (`${match[1] ?? ""}${match[2] ?? ""}`.startsWith("//") && /[A-Za-z][A-Za-z0-9+.-]*:$/.test(command.slice(0, match.index)))',
  "            return [];"
);

const WORDS_GUARD = lines(
  "            if (/^[A-Za-z][A-Za-z0-9+.-]*:\\/\\//.test(word))",
  "                continue;"
);

/** Bundled copies name the flatMap parameter differently (match, match3), so the guard takes it as an argument. */
function embeddedPathsBundleGuard(param) {
  return 'if(`${' + param + '[1]??""}${' + param + '[2]??""}`.startsWith("//")&&/[A-Za-z][A-Za-z0-9+.-]*:$/.test(command.slice(0,' + param + '.index)))return[];';
}

const WORDS_BUNDLE_GUARD =
  "if(/^[A-Za-z][A-Za-z0-9+.-]*:\\/\\//.test(word))continue;";

/** Every target file and its byte-exact anchored edits, per D2. */
async function buildTargets() {
  const predicate = await predicateSource();

  return [
    {
      file: FILE_COMMAND_PATHS,
      edits: [
        {
          name: "embeddedPaths",
          anchor: lines(
            "    return [...command.matchAll(EMBEDDED_PATH)].flatMap((match) => {"
          ),
          replacement: lines(
            "    return [...command.matchAll(EMBEDDED_PATH)].flatMap((match) => {",
            EMBEDDED_PATHS_GUARD
          ),
        },
        {
          name: "commandPaths",
          anchor: lines(
            "        for (const word of words(segment)) {",
            "            const anchored = anchoredPath(word);"
          ),
          replacement: lines(
            "        for (const word of words(segment)) {",
            WORDS_GUARD,
            "            const anchored = anchoredPath(word);"
          ),
        },
      ],
    },
    {
      file: FILE_FILESYSTEM_POLICY,
      edits: [
        {
          name: "canonicalizeFilesystemPath",
          anchor: lines(
            "export async function canonicalizeFilesystemPath(filePath) {",
            "    const absolutePath = resolve(filePath);",
            "    const canonicalPath = await withResolutionDeadline(canonicalizeByOpening(absolutePath));",
            "    if (canonicalPath !== RESOLUTION_TIMED_OUT)",
            "        return canonicalPath;",
            "    return realpathWithoutOpenStrict(absolutePath);",
            "}"
          ),
          replacement: lines(
            predicate,
            "",
            "export async function canonicalizeFilesystemPath(filePath) {",
            "    const absolutePath = resolve(filePath);",
            "    const canonicalPath = await withResolutionDeadline(canonicalizeByOpening(absolutePath));",
            "    if (canonicalPath !== RESOLUTION_TIMED_OUT)",
            "        return canonicalPath;",
            "    if (omoFreezeFixUncTimeout(absolutePath))",
            '        throw Object.assign(new Error("ETIMEDOUT: UNC path did not resolve within the deadline"), { code: "ETIMEDOUT", path: absolutePath, omoFreezeFix: true });',
            "    return realpathWithoutOpenStrict(absolutePath);",
            "}"
          ),
        },
      ],
    },
    {
      file: FILE_CHUNK,
      edits: [
        {
          name: "embeddedPaths",
          anchor:
            "function embeddedPaths(command){return[...command.matchAll(EMBEDDED_PATH)].flatMap(match=>{let path13=",
          replacement:
            "function embeddedPaths(command){return[...command.matchAll(EMBEDDED_PATH)].flatMap(match=>{" +
            embeddedPathsBundleGuard("match") +
            "let path13=",
        },
        {
          name: "commandPaths",
          anchor: "for(let word of words(segment)){let anchored=anchoredPath(word);",
          replacement:
            "for(let word of words(segment)){" +
            WORDS_BUNDLE_GUARD +
            "let anchored=anchoredPath(word);",
        },
        {
          name: "canonicalizeFilesystemPath",
          anchor:
            "async function canonicalizeFilesystemPath(filePath){let absolutePath=resolve6(filePath),canonicalPath2=await withResolutionDeadline(canonicalizeByOpening(absolutePath));return canonicalPath2!==RESOLUTION_TIMED_OUT?canonicalPath2:realpathWithoutOpenStrict(absolutePath)}",
          replacement: lines(
            predicate,
            'async function canonicalizeFilesystemPath(filePath){let absolutePath=resolve6(filePath),canonicalPath2=await withResolutionDeadline(canonicalizeByOpening(absolutePath));if(canonicalPath2!==RESOLUTION_TIMED_OUT)return canonicalPath2;if(omoFreezeFixUncTimeout(absolutePath))throw Object.assign(new Error("ETIMEDOUT: UNC path did not resolve within the deadline"),{code:"ETIMEDOUT",path:absolutePath,omoFreezeFix:!0});return realpathWithoutOpenStrict(absolutePath)}'
          ),
        },
      ],
    },
    {
      file: FILE_SESSION_WORKER,
      edits: [
        {
          name: "embeddedPaths",
          anchor:
            "function embeddedPaths(command){return[...command.matchAll(EMBEDDED_PATH)].flatMap(match3=>{let path28=",
          replacement:
            "function embeddedPaths(command){return[...command.matchAll(EMBEDDED_PATH)].flatMap(match3=>{" +
            embeddedPathsBundleGuard("match3") +
            "let path28=",
        },
        {
          name: "commandPaths",
          anchor:
            "for(let word of words(segment2)){let anchored2=anchoredPath(word);",
          replacement:
            "for(let word of words(segment2)){" +
            WORDS_BUNDLE_GUARD +
            "let anchored2=anchoredPath(word);",
        },
        {
          name: "canonicalizeFilesystemPath",
          anchor:
            "async function canonicalizeFilesystemPath(filePath){let absolutePath=resolve23(filePath),canonicalPath3=await withResolutionDeadline(canonicalizeByOpening(absolutePath));return canonicalPath3!==RESOLUTION_TIMED_OUT?canonicalPath3:realpathWithoutOpenStrict(absolutePath)}",
          replacement: lines(
            predicate,
            'async function canonicalizeFilesystemPath(filePath){let absolutePath=resolve23(filePath),canonicalPath3=await withResolutionDeadline(canonicalizeByOpening(absolutePath));if(canonicalPath3!==RESOLUTION_TIMED_OUT)return canonicalPath3;if(omoFreezeFixUncTimeout(absolutePath))throw Object.assign(new Error("ETIMEDOUT: UNC path did not resolve within the deadline"),{code:"ETIMEDOUT",path:absolutePath,omoFreezeFix:!0});return realpathWithoutOpenStrict(absolutePath)}'
          ),
        },
      ],
    },
  ];
}

function editStates(text, edits) {
  return edits.map((edit) => ({
    name: edit.name,
    pristine: countOccurrences(text, edit.anchor),
    patched: countOccurrences(text, edit.replacement),
  }));
}

/** "pristine", "patched", or "unknown" for one file's edit set. */
function classifyText(text, edits) {
  const states = editStates(text, edits);
  if (states.every((state) => state.patched === 1)) return "patched";
  if (states.every((state) => state.pristine === 1 && state.patched === 0)) {
    return "pristine";
  }
  return "unknown";
}

/** Apply the anchored edits in order; throw unless each anchor occurs exactly once. */
function applyEdits(text, edits) {
  let output = text;
  for (const edit of edits) {
    const already = countOccurrences(output, edit.replacement);
    if (already === 1) continue;
    if (already > 1) {
      throw new Error(
        `${edit.name}: patched text occurs ${already} times, expected at most 1`
      );
    }
    const found = countOccurrences(output, edit.anchor);
    if (found !== 1) {
      throw new Error(
        `${edit.name}: anchor occurs ${found} times, expected exactly 1`
      );
    }
    output = output.replace(edit.anchor, () => edit.replacement);
  }
  return output;
}

async function loadBaselines() {
  return JSON.parse(await readFile(BASELINES_PATH, "utf8"));
}

function print(prefix, payload) {
  process.stdout.write(`${prefix} ${JSON.stringify(payload)}\n`);
}

function usage() {
  process.stderr.write(
    "usage: patch.mjs --senpi-root <dir> (--check | --apply | --remove) [--receipt <file>]\n"
  );
  process.exit(2);
}

function parseArgs(argv) {
  let senpiRoot;
  let mode;
  let receipt;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--senpi-root") senpiRoot = argv[++index];
    else if (arg === "--receipt") receipt = argv[++index];
    else if (arg === "--check" || arg === "--apply" || arg === "--remove") {
      if (mode) usage();
      mode = arg.slice(2);
    } else usage();
  }
  if (!senpiRoot || !mode) usage();
  return { senpiRoot: resolve(senpiRoot), mode, receipt };
}

async function checkTree(senpiRoot) {
  const targets = await buildTargets();
  const payload = {
    version: "unsupported",
    detectedVersion: undefined,
    supported: false,
    senpiRoot,
    files: {},
  };
  let baselines;
  try {
    baselines = await loadBaselines();
  } catch (error) {
    payload.error = `baselines.json: ${error.message}`;
    return payload;
  }
  let detectedVersion;
  try {
    detectedVersion = JSON.parse(
      await readFile(join(senpiRoot, "package.json"), "utf8")
    ).version;
  } catch (error) {
    payload.error = `package.json: ${error.message}`;
    return payload;
  }
  payload.detectedVersion = detectedVersion;
  const versionEntry = baselines.versions?.[detectedVersion];
  payload.supported = Boolean(versionEntry);
  if (versionEntry) payload.version = detectedVersion;

  for (const target of targets) {
    const absolute = join(senpiRoot, target.file);
    let buffer;
    try {
      buffer = await readFile(absolute);
    } catch (error) {
      payload.files[target.file] = {
        state: "unknown",
        missing: true,
        error: error.code ?? error.message,
      };
      continue;
    }
    const text = buffer.toString("utf8");
    const states = editStates(text, target.edits);
    const anchorsFound = Object.fromEntries(
      states.map((state) => [state.name, state.pristine])
    );
    const patchesFound = Object.fromEntries(
      states.map((state) => [state.name, state.patched])
    );
    const entry = versionEntry?.files?.[target.file];
    if (!entry) {
      payload.files[target.file] = {
        state: "unknown",
        sha256: sha256(buffer),
        anchorsFound,
        patchesFound,
      };
      continue;
    }
    const hash = sha256(buffer);
    const state =
      hash === entry.patched
        ? "patched"
        : hash === entry.pristine
          ? "pristine"
          : "unknown";
    payload.files[target.file] = { state, sha256: hash, anchorsFound, patchesFound };
  }
  return payload;
}

async function writeReceipt(receiptPath, payload) {
  if (!receiptPath) return;
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function runApply(senpiRoot, receiptPath) {
  const targets = await buildTargets();
  const baselines = await loadBaselines();
  const version = JSON.parse(
    await readFile(join(senpiRoot, "package.json"), "utf8")
  ).version;
  const versionEntry = baselines.versions?.[version];
  if (!versionEntry) {
    print("ERROR", { reason: "unsupported-version", version: "unsupported", detectedVersion: version });
    process.exit(2);
  }

  const plans = [];
  for (const target of targets) {
    const absolute = join(senpiRoot, target.file);
    const entry = versionEntry.files?.[target.file];
    if (!entry) {
      print("ERROR", { reason: "unknown-file", file: target.file });
      process.exit(2);
    }
    let buffer;
    try {
      buffer = await readFile(absolute);
    } catch (error) {
      print("ERROR", { reason: "unknown-file", file: target.file, error: error.code });
      process.exit(2);
    }
    const hash = sha256(buffer);
    if (hash === entry.patched) continue;
    if (hash !== entry.pristine) {
      print("ERROR", { reason: "unknown-file", file: target.file, sha256: hash });
      process.exit(2);
    }
    const text = buffer.toString("utf8");
    if (classifyText(text, target.edits) !== "pristine") {
      print("ERROR", {
        reason: "anchor-mismatch",
        file: target.file,
        states: editStates(text, target.edits),
      });
      process.exit(2);
    }
    let patchedText;
    try {
      patchedText = applyEdits(text, target.edits);
    } catch (error) {
      print("ERROR", { reason: "anchor-mismatch", file: target.file, error: error.message });
      process.exit(2);
    }
    plans.push({
      file: target.file,
      absolute,
      before: hash,
      original: buffer,
      patched: Buffer.from(patchedText, "utf8"),
    });
  }

  if (plans.length === 0) {
    print("APPLY", { status: "no-op", version });
    await writeReceipt(receiptPath, {
      tool: "senpi-freeze-fix/patch.mjs",
      mode: "apply",
      status: "no-op",
      version,
      senpiRoot,
      timestamp: new Date().toISOString(),
      files: {},
    });
    process.exit(0);
  }

  const replaced = [];
  const failAt = Number(process.env.SENPI_FREEZE_FIX_TEST_FAIL_RENAME ?? "0");
  let renameCount = 0;
  try {
    for (const plan of plans) {
      await writeFile(`${plan.absolute}${BACKUP_SUFFIX}`, plan.original);
    }
    for (const plan of plans) {
      await writeFile(`${plan.absolute}${NEW_SUFFIX}`, plan.patched);
    }
    for (const plan of plans) {
      renameCount += 1;
      if (failAt > 0 && renameCount === failAt) {
        throw new Error(`injected rename failure at file ${renameCount}`);
      }
      await rename(`${plan.absolute}${NEW_SUFFIX}`, plan.absolute);
      replaced.push(plan);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const plan of replaced) {
      try {
        await writeFile(plan.absolute, plan.original);
      } catch (restoreError) {
        rollbackErrors.push({ file: plan.file, error: restoreError.message });
      }
    }
    for (const plan of plans) {
      try {
        await unlink(`${plan.absolute}${NEW_SUFFIX}`);
      } catch {
        // The .new file may never have been written or may already be renamed.
      }
    }
    print("APPLY", {
      status: "rolled-back",
      version,
      error: error.message,
      rollbackErrors,
    });
    process.exit(3);
  }

  const files = Object.fromEntries(
    plans.map((plan) => [
      plan.file,
      {
        before: plan.before,
        after: sha256(plan.patched),
        backup: `${plan.file}${BACKUP_SUFFIX}`,
      },
    ])
  );
  print("APPLY", { status: "applied", version, files });
  try {
    await writeReceipt(receiptPath, {
      tool: "senpi-freeze-fix/patch.mjs",
      mode: "apply",
      status: "applied",
      version,
      senpiRoot,
      timestamp: new Date().toISOString(),
      files,
    });
  } catch (error) {
    print("APPLY", {
      status: "applied",
      version,
      files,
      receiptError: error.message,
    });
    process.exit(3);
  }
  process.exit(0);
}

async function runRemove(senpiRoot, receiptPath) {
  const targets = await buildTargets();
  const baselines = await loadBaselines();
  const version = JSON.parse(
    await readFile(join(senpiRoot, "package.json"), "utf8")
  ).version;
  const versionEntry = baselines.versions?.[version];
  if (!versionEntry) {
    print("ERROR", { reason: "unsupported-version", version: "unsupported", detectedVersion: version });
    process.exit(2);
  }

  const plans = [];
  for (const target of targets) {
    const absolute = join(senpiRoot, target.file);
    const entry = versionEntry.files?.[target.file];
    if (!entry) {
      print("ERROR", { reason: "unknown-file", file: target.file });
      process.exit(2);
    }
    let buffer;
    try {
      buffer = await readFile(absolute);
    } catch (error) {
      print("ERROR", { reason: "unknown-file", file: target.file, error: error.code });
      process.exit(2);
    }
    const hash = sha256(buffer);
    if (hash === entry.pristine) continue;
    if (hash !== entry.patched) {
      print("ERROR", { reason: "unknown-file", file: target.file, sha256: hash });
      process.exit(2);
    }
    let backup;
    try {
      backup = await readFile(`${absolute}${BACKUP_SUFFIX}`);
    } catch (error) {
      print("ERROR", { reason: "backup-missing", file: target.file, error: error.code });
      process.exit(2);
    }
    if (sha256(backup) !== entry.pristine) {
      print("ERROR", { reason: "backup-mismatch", file: target.file });
      process.exit(2);
    }
    plans.push({
      file: target.file,
      absolute,
      restored: backup,
      patched: buffer,
    });
  }

  if (plans.length === 0) {
    print("REMOVE", { status: "no-op", version });
    await writeReceipt(receiptPath, {
      tool: "senpi-freeze-fix/patch.mjs",
      mode: "remove",
      status: "no-op",
      version,
      senpiRoot,
      timestamp: new Date().toISOString(),
      files: {},
    });
    process.exit(0);
  }

  const replaced = [];
  try {
    for (const plan of plans) {
      await writeFile(`${plan.absolute}${NEW_SUFFIX}`, plan.restored);
    }
    for (const plan of plans) {
      await rename(`${plan.absolute}${NEW_SUFFIX}`, plan.absolute);
      replaced.push(plan);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const plan of replaced) {
      try {
        await writeFile(plan.absolute, plan.patched);
      } catch (restoreError) {
        rollbackErrors.push({ file: plan.file, error: restoreError.message });
      }
    }
    for (const plan of plans) {
      try {
        await unlink(`${plan.absolute}${NEW_SUFFIX}`);
      } catch {
        // Already renamed or never written.
      }
    }
    print("REMOVE", {
      status: "rolled-back",
      version,
      error: error.message,
      rollbackErrors,
    });
    process.exit(3);
  }

  const warnings = [];
  for (const plan of plans) {
    try {
      await unlink(`${plan.absolute}${BACKUP_SUFFIX}`);
    } catch (error) {
      warnings.push({ file: plan.file, error: error.message });
    }
  }
  const files = Object.fromEntries(
    plans.map((plan) => [
      plan.file,
      { after: sha256(plan.restored), removedBackup: `${plan.file}${BACKUP_SUFFIX}` },
    ])
  );
  print("REMOVE", { status: "removed", version, files, warnings });
  try {
    await writeReceipt(receiptPath, {
      tool: "senpi-freeze-fix/patch.mjs",
      mode: "remove",
      status: "removed",
      version,
      senpiRoot,
      timestamp: new Date().toISOString(),
      files,
    });
  } catch (error) {
    print("REMOVE", {
      status: "removed",
      version,
      files,
      warnings,
      receiptError: error.message,
    });
    process.exit(3);
  }
  process.exit(0);
}

async function main() {
  const { senpiRoot, mode, receipt } = parseArgs(process.argv.slice(2));
  if (mode === "check") {
    let payload;
    try {
      payload = await checkTree(senpiRoot);
    } catch (error) {
      payload = {
        version: "unsupported",
        supported: false,
        senpiRoot,
        files: {},
        error: error.message,
      };
    }
    print("CHECK", payload);
    process.exit(0);
  }
  try {
    if (mode === "apply") await runApply(senpiRoot, receipt ? resolve(receipt) : undefined);
    else await runRemove(senpiRoot, receipt ? resolve(receipt) : undefined);
  } catch (error) {
    print("ERROR", { reason: "unexpected", error: error.message });
    process.exit(2);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();

export { applyEdits, buildTargets, classifyText, countOccurrences, sha256 };
