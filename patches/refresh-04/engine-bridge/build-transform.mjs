#!/usr/bin/env node
/**
 * stage-beta88 / lane engine-bridge: count-asserted staged-engine transform builder.
 *
 * Reads ONLY the immutable pinned base (stage-beta88/base/senpi), verifies the package
 * version, every input file sha256/bytes and every anchor/marker count, and only then
 * writes the transformed outputs plus a deterministic manifest under
 * stage-beta88/target/engine-bridge. Never touches base/, pristine/, installed trees,
 * other lanes, or the package as a whole (outputs are exactly the pinned file set).
 *
 * Modes (node builtins only, no dependencies):
 *   node build-transform.mjs            # emit: verify, then write missing/identical outputs
 *   node build-transform.mjs --check    # verify base pins + existing outputs, write nothing
 *   node build-transform.mjs --rollback # delete only manifest-verified generated outputs
 *
 * Refusal contract: any version / sha / bytes / anchor-count / marker drift, or any
 * divergent pre-existing output, exits 2 BEFORE any output byte is written. A rerun on
 * an intact output tree is a byte-identical no-op (deterministic manifest, no timestamps).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const STAGE_ROOT = resolve(SCRIPT_DIR, "..", "..", "..");
const PIN_SCHEMA = "omo-beta88-engine-bridge/pins/v1";
const MANIFEST_SCHEMA = "omo-beta88-engine-bridge/manifest/v1";

const argv = process.argv.slice(2);
if (argv.includes("--help")) {
  console.log("usage: node build-transform.mjs [--emit|--check|--rollback]");
  process.exit(0);
}
const mode = argv.includes("--rollback") ? "rollback" : argv.includes("--check") ? "check" : "emit";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const preview = (value) => (value.length > 72 ? `${value.slice(0, 69)}...` : value);
const countOccurrences = (hay, needle) => {
  let count = 0;
  let index = hay.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = hay.indexOf(needle, index + 1);
  }
  return count;
};
const refuse = (code, detail) => {
  console.error(`REFUSED ${code}: ${detail}`);
  process.exit(2);
};
const fail = (detail) => {
  console.error(`FAIL ${detail}`);
  process.exit(1);
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return refuse("READ_FAIL", `${path}: ${err.message}`);
  }
}

const pins = readJson(join(SCRIPT_DIR, "pins.json"));
if (pins.schema !== PIN_SCHEMA) refuse("PIN_SCHEMA_DRIFT", `pins.json schema ${pins.schema} != ${PIN_SCHEMA}`);
for (const key of ["baseRoot", "outputRoot", "manifestRel", "package", "files"]) {
  if (pins[key] === undefined) refuse("PIN_SHAPE_DRIFT", `pins.json missing ${key}`);
}
if (!Array.isArray(pins.files) || pins.files.length === 0) refuse("PIN_SHAPE_DRIFT", "pins.files must be a non-empty array");

const baseRoot = resolve(STAGE_ROOT, pins.baseRoot);
const outputRoot = resolve(STAGE_ROOT, pins.outputRoot);
const manifestPath = join(outputRoot, pins.manifestRel);

function outputPathFor(relpath) {
  if (typeof relpath !== "string" || relpath.length === 0 || relpath.includes("..") || relpath.startsWith("/") || relpath.startsWith("\\")) {
    refuse("OUTPUT_PATH_INVALID", `pins output relpath ${JSON.stringify(relpath)}`);
  }
  const abs = resolve(outputRoot, relpath);
  if (abs !== outputRoot && !abs.startsWith(outputRoot + sep)) refuse("OUTPUT_PATH_ESCAPE", `${abs} is outside ${outputRoot}`);
  return abs;
}

function buildPlan() {
  const pkg = readJson(join(baseRoot, "package.json"));
  if (pkg.name !== pins.package.name) refuse("VERSION_DRIFT", `base package name ${pkg.name} != pinned ${pins.package.name}`);
  if (pkg.version !== pins.package.version) refuse("VERSION_DRIFT", `base package version ${pkg.version} != pinned ${pins.package.version}`);

  const plans = [];
  const inputPins = [];
  for (const file of pins.files) {
    const inPath = join(baseRoot, file.relpath);
    if (!existsSync(inPath)) refuse("BASE_FILE_MISSING", inPath);
    const inBuf = readFileSync(inPath);
    const inSha = sha256(inBuf);
    if (inSha !== file.sha256) refuse("FILE_SHA_DRIFT", `${file.relpath} observed ${inSha} pinned ${file.sha256}`);
    if (inBuf.length !== file.bytes) refuse("FILE_BYTES_DRIFT", `${file.relpath} observed ${inBuf.length} pinned ${file.bytes}`);
    let text = inBuf.toString("utf8");
    for (const transform of file.transforms ?? []) {
      if (typeof transform.expectedCount !== "number") refuse("PIN_SHAPE_DRIFT", `${file.relpath}: expectedCount must be a number`);
      const anchorCount = countOccurrences(text, transform.anchor);
      if (anchorCount !== transform.expectedCount) {
        refuse("ANCHOR_COUNT_DRIFT", `${file.relpath} anchor ${JSON.stringify(preview(transform.anchor))} found ${anchorCount} expected ${transform.expectedCount}`);
      }
      const markerBefore = countOccurrences(text, transform.insertMarker);
      if (markerBefore !== (transform.insertMarkerInInput ?? 0)) {
        refuse("INSERT_MARKER_DRIFT", `${file.relpath} marker ${JSON.stringify(preview(transform.insertMarker))} found ${markerBefore} in input, expected ${transform.insertMarkerInInput ?? 0}`);
      }
      text = text.split(transform.anchor).join(transform.replacement);
    }
    for (const transform of file.transforms ?? []) {
      const markerAfter = countOccurrences(text, transform.insertMarker);
      if (markerAfter !== transform.insertMarkerInOutput) {
        refuse("OUTPUT_MARKER_DRIFT", `${file.relpath} marker ${JSON.stringify(preview(transform.insertMarker))} found ${markerAfter} in output, expected ${transform.insertMarkerInOutput}`);
      }
      const replacementAfter = countOccurrences(text, transform.replacement);
      if (replacementAfter !== transform.expectedCount) {
        refuse("REPLACEMENT_COUNT_DRIFT", `${file.relpath} replacement ${JSON.stringify(preview(transform.replacement))} found ${replacementAfter} in output, expected ${transform.expectedCount}`);
      }
    }
    if (file.tokenFn) {
      const declCount = countOccurrences(text, file.tokenFnDeclaration);
      if (declCount !== 1) {
        refuse("TOKEN_FN_DECLARATION_DRIFT", `${file.relpath} ${JSON.stringify(file.tokenFnDeclaration)} found ${declCount}, expected 1`);
      }
    }
    const outBuf = Buffer.from(text, "utf8");
    plans.push({ relpath: file.relpath, outPath: outputPathFor(file.relpath), outBuf, sha256: sha256(outBuf), bytes: outBuf.length });
    inputPins.push({ relpath: file.relpath, sha256: file.sha256, bytes: file.bytes });
  }
  return { plans, inputPins };
}

function buildManifest(inputPins, plans) {
  const manifest = {
    schema: MANIFEST_SCHEMA,
    lane: pins.lane,
    task: pins.task,
    baseRoot: pins.baseRoot,
    package: { name: pins.package.name, version: pins.package.version },
    inputs: inputPins,
    transforms: pins.files.map((file) => ({
      relpath: file.relpath,
      anchorCounts: (file.transforms ?? []).map((transform) => transform.expectedCount),
      insertMarkers: (file.transforms ?? []).map((transform) => transform.insertMarker),
    })),
    outputs: plans.map((plan) => ({ relpath: plan.relpath, sha256: plan.sha256, bytes: plan.bytes })),
    overlay: {
      mode: "copy-relative-over-install-root",
      root: pins.outputRoot,
      files: plans.map((plan) => plan.relpath),
    },
    rollback: {
      mode: "remove-generated-outputs",
      guardedBy: "sha256-equal-to-manifest-else-refuse",
      files: [...plans.map((plan) => plan.relpath), pins.manifestRel],
    },
  };
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function report(payload) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

function existing(path) {
  return existsSync(path) ? readFileSync(path) : null;
}

function emit(plans, manifestBuf) {
  const existingManifest = existing(manifestPath);
  if (existingManifest) {
    let parsed;
    try {
      parsed = JSON.parse(existingManifest.toString("utf8"));
    } catch (err) {
      refuse("MANIFEST_UNREADABLE", `${manifestPath}: ${err.message}`);
    }
    if (parsed.schema !== MANIFEST_SCHEMA) refuse("MANIFEST_SCHEMA_DRIFT", `${manifestPath} schema ${parsed.schema} != ${MANIFEST_SCHEMA}`);
    if (!existingManifest.equals(manifestBuf)) {
      refuse("MANIFEST_DRIFT", `${manifestPath} differs from the deterministic manifest for the pinned base; remove stale artifacts with --rollback before rebuilding`);
    }
  }

  const wrote = [];
  const noop = [];
  for (const plan of plans) {
    const current = existing(plan.outPath);
    if (current && !existingManifest) refuse("STATE_DIRTY", `${plan.relpath} exists without ${pins.manifestRel}; remove stale artifacts with --rollback before rebuilding`);
    if (existingManifest && !current) refuse("OUTPUT_MISSING", `${plan.relpath} missing while ${pins.manifestRel} exists; rerun --emit to repair or --rollback to reset`);
    if (current && !current.equals(plan.outBuf)) {
      refuse("OUTPUT_DIRTY", `${plan.relpath} observed ${sha256(current)} expected ${plan.sha256}; refusing to overwrite a divergent artifact`);
    }
  }
  for (const plan of plans) {
    if (existsSync(plan.outPath)) {
      noop.push(plan.relpath);
    } else {
      mkdirSync(dirname(plan.outPath), { recursive: true });
      writeFileSync(plan.outPath, plan.outBuf);
      wrote.push(plan.relpath);
    }
  }
  if (existingManifest) {
    noop.push(pins.manifestRel);
  } else {
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, manifestBuf);
    wrote.push(pins.manifestRel);
  }
  report({
    mode: "emit",
    baseRoot: pins.baseRoot,
    outputRoot: pins.outputRoot,
    wrote,
    noop,
    outputs: plans.map((plan) => ({ relpath: plan.relpath, sha256: plan.sha256, bytes: plan.bytes })),
  });
}

function check(plans, manifestBuf) {
  const existingManifest = existing(manifestPath);
  if (!existingManifest) refuse("MANIFEST_MISSING", `${manifestPath} not found; run --emit first`);
  if (!existingManifest.equals(manifestBuf)) refuse("MANIFEST_DRIFT", `${manifestPath} differs from the deterministic manifest for the pinned base`);
  for (const plan of plans) {
    const current = existing(plan.outPath);
    if (!current) refuse("OUTPUT_MISSING", plan.relpath);
    if (!current.equals(plan.outBuf)) refuse("OUTPUT_DIRTY", `${plan.relpath} observed ${sha256(current)} expected ${plan.sha256}`);
  }
  report({
    mode: "check",
    baseRoot: pins.baseRoot,
    outputRoot: pins.outputRoot,
    verified: [...plans.map((plan) => plan.relpath), pins.manifestRel],
    outputs: plans.map((plan) => ({ relpath: plan.relpath, sha256: plan.sha256, bytes: plan.bytes })),
  });
}

function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!pruneEmptyDirs(join(dir, entry.name))) empty = false;
    } else {
      empty = false;
    }
  }
  if (empty && dir !== outputRoot) {
    try {
      rmdirSync(dir);
      return true;
    } catch {
      return false;
    }
  }
  return empty && dir !== outputRoot;
}

function rollback() {
  const existingManifest = existing(manifestPath);
  if (!existingManifest) refuse("MANIFEST_MISSING", `${manifestPath} not found; nothing to roll back`);
  let parsed;
  try {
    parsed = JSON.parse(existingManifest.toString("utf8"));
  } catch (err) {
    refuse("MANIFEST_UNREADABLE", `${manifestPath}: ${err.message}`);
  }
  if (parsed.schema !== MANIFEST_SCHEMA) refuse("MANIFEST_SCHEMA_DRIFT", `${manifestPath} schema ${parsed.schema} != ${MANIFEST_SCHEMA}`);
  if (!Array.isArray(parsed.outputs)) refuse("ROLLBACK_MANIFEST_SHAPE", `${manifestPath} outputs must be an array`);
  // Phase 1: validate EVERY output path/bytes/hash (and the manifest shape) before any delete.
  const targets = [];
  for (const output of parsed.outputs) {
    if (typeof output?.relpath !== "string" || typeof output?.sha256 !== "string" || typeof output?.bytes !== "number") {
      refuse("ROLLBACK_MANIFEST_SHAPE", `${manifestPath} output entry ${JSON.stringify(output)}`);
    }
    const path = outputPathFor(output.relpath);
    const current = existing(path);
    if (!current) continue;
    if (current.length !== output.bytes) {
      refuse("ROLLBACK_DRIFT", `${output.relpath} observed ${current.length} bytes manifest ${output.bytes}; refusing to delete unverified bytes`);
    }
    const observed = sha256(current);
    if (observed !== output.sha256) {
      refuse("ROLLBACK_DRIFT", `${output.relpath} observed ${observed} manifest ${output.sha256}; refusing to delete unverified bytes`);
    }
    targets.push({ relpath: output.relpath, path });
  }
  // Phase 2: every candidate is verified (or already absent) - now delete.
  const removed = [];
  for (const target of targets) {
    rmSync(target.path, { force: true });
    removed.push(target.relpath);
  }
  rmSync(manifestPath, { force: true });
  removed.push(pins.manifestRel);
  pruneEmptyDirs(outputRoot);
  report({ mode: "rollback", outputRoot: pins.outputRoot, removed });
}

try {
  const { plans, inputPins } = buildPlan();
  const manifestBuf = buildManifest(inputPins, plans);
  if (mode === "check") check(plans, manifestBuf);
  else if (mode === "rollback") rollback();
  else emit(plans, manifestBuf);
} catch (err) {
  fail(`${err?.stack ?? err}`);
}
