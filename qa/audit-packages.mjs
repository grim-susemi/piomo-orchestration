#!/usr/bin/env node
// qa/audit-packages.mjs — active package/extension entrypoint inventory for
// PiOMO Orchestration Mod (plan task 3).
//
// Usage:
//   node qa/audit-packages.mjs --mode inventory --source-root <workspace> [--settings <path>] --out <receipt.json>
//
// Behaviour:
//   - Reads the OMO agent settings.json READ-ONLY and extracts only the `packages`
//     pin list (no raw personal settings are copied into the receipt).
//   - For every pinned package manifest, verifies declared `files`, `pi.extensions`
//     and `pi.skills` entrypoints exist, classifies the pin, and maps the repo `qa/`
//     scripts that reference it (test/behavior-record closure).
//   - Known-stale entries (piomo-personal-core's three advertised extension sources,
//     which do not exist) are REPORTED as stale, not hidden, and are tolerated so the
//     inventory can complete. Any OTHER pinned package with a missing declared file
//     exits nonzero PACKAGE_FILE_MISSING.
//   - Statuses distinguish configured / active / library-only / stale. Dynamic runtime
//     activation proof is NOT claimed here; it is deferred to task 6 (native
//     disposable-host load).
//   - Exit codes: 0 inventory recorded; 1 PACKAGE_FILE_MISSING; 2 usage;
//     66 settings read failure; 70 internal error.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

const EXIT_OK = 0;
const EXIT_FILE_MISSING = 1;
const EXIT_USAGE = 2;
const EXIT_SETTINGS = 66;
const EXIT_INTERNAL = 70;

// Declared-but-absent entries that task 3 already knows are stale: exactly the three
// legacy extension paths of piomo-personal-core, in both their `files` and
// `pi.extensions` spellings. They are reported in the receipt (stale, not hidden) and
// do not fail the inventory. Any OTHER missing declared file — in any pinned package,
// including an unrelated entry inside piomo-personal-core — is a hard
// PACKAGE_FILE_MISSING failure.
const KNOWN_STALE = {
  "piomo-personal-core": {
    reason: "three advertised extension sources do not exist in the package; superseded by the active loose omo-model-tuning.ts in the home extension dir",
    entries: new Set([
      "extensions/omo-model-tuning.ts",
      "extensions/omo-orchestrator-guard.ts",
      "extensions/omo-compaction-summarizer.ts",
      "./extensions/omo-model-tuning.ts",
      "./extensions/omo-orchestrator-guard.ts",
      "./extensions/omo-compaction-summarizer.ts",
    ]),
  },
};

function usage() {
  process.stderr.write(
    "usage: node qa/audit-packages.mjs --mode inventory --source-root <workspace> [--settings <path>] --out <receipt.json>\n",
  );
}

function parseArgs(argv) {
  const args = { mode: "inventory" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--source-root") args.sourceRoot = argv[++i];
    else if (a === "--settings") args.settings = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else {
      usage();
      process.exit(EXIT_USAGE);
    }
  }
  if (args.mode !== "inventory" || !args.sourceRoot) {
    usage();
    process.exit(EXIT_USAGE);
  }
  return args;
}

function sha256(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function readSettings(settingsPath) {
  if (!existsSync(settingsPath)) {
    process.stderr.write(`SETTINGS_MISSING: ${settingsPath}\n`);
    process.exit(EXIT_SETTINGS);
  }
  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    const pins = Array.isArray(raw.packages) ? raw.packages : [];
    if (pins.length === 0) {
      process.stderr.write(`SETTINGS_NO_PACKAGES: ${settingsPath}\n`);
      process.exit(EXIT_SETTINGS);
    }
    return pins.map(String);
  } catch (err) {
    process.stderr.write(`SETTINGS_UNREADABLE: ${settingsPath}: ${err.message}\n`);
    process.exit(EXIT_SETTINGS);
  }
}

function entryExists(pkgDir, entry) {
  const rel = entry.replace(/^\.\//, "").replace(/^\.\.\/+/, "");
  if (rel.startsWith("../")) return { entry, exists: false, note: "escapes package dir" };
  const full = join(pkgDir, rel);
  if (!existsSync(full)) return { entry, exists: false };
  return { entry, exists: statSync(full).isFile() ? "file" : "dir", path: full };
}

function classify(manifest, missingHard, missingKnownStale) {
  const exts = (manifest.pi && Array.isArray(manifest.pi.extensions)) ? manifest.pi.extensions : [];
  const skills = (manifest.pi && Array.isArray(manifest.pi.skills)) ? manifest.pi.skills : [];
  if (missingHard.length > 0) return "stale-missing"; // only reachable outside KNOWN_STALE, exits below
  if (exts.length === 0 && skills.length === 0) return "library-only";
  if (missingKnownStale.length > 0) return "stale";
  return "active";
}

function qaReferences(packagesRoot, pkgName) {
  const qaDir = join(packagesRoot, "..", "qa");
  const refs = [];
  try {
    for (const name of readdirSync(qaDir)) {
      if (!name.endsWith(".mjs")) continue;
      const text = readFileSync(join(qaDir, name), "utf8");
      if (text.includes(pkgName)) refs.push(`qa/${name}`);
    }
  } catch {
    // qa dir absent (e.g. scratch fixtures): no references recorded
  }
  return refs;
}

function auditPackage(pin, packagesRoot) {
  const pkgDir = isAbsolute(pin) ? resolve(pin) : resolve(packagesRoot, pin);
  const name = pin.split(/[\\/]/).filter(Boolean).pop();
  const record = {
    pin,
    path: pkgDir,
    name,
    status: "unknown",
    declaredFiles: [],
    piExtensions: [],
    piSkills: [],
    exports: [],
    testClosure: qaReferences(join(pkgDir, ".."), name),
  };
  if (!existsSync(pkgDir) || !statSync(pkgDir).isDirectory()) {
    record.status = "missing-package-dir";
    record.error = "PACKAGE_DIR_MISSING";
    return { record, hardMissing: [{ entry: ".", error: "PACKAGE_DIR_MISSING" }], knownStaleMissing: [] };
  }
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) {
    record.status = "missing-manifest";
    record.error = "PACKAGE_MANIFEST_MISSING";
    return { record, hardMissing: [{ entry: "package.json", error: "PACKAGE_MANIFEST_MISSING" }], knownStaleMissing: [] };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pkgName = manifest.name ?? name; // KNOWN_STALE keys on the manifest package name, not the directory basename
  record.name = pkgName;
  record.version = manifest.version ?? null;
  record.license = manifest.license ?? null;
  record.sha256 = sha256(manifestPath);

  const hardMissing = [];
  const knownStaleMissing = [];
  const known = KNOWN_STALE[pkgName];
  const staleExempt = (entry) => Boolean(known && known.entries.has(entry));
  const check = (list, sink, kind) => {
    for (const entry of list) {
      const verdict = entryExists(pkgDir, entry);
      const item = { kind, ...verdict };
      if (verdict.exists !== false) sink.push(item);
      else if (staleExempt(entry)) {
        item.stale = true;
        item.reason = known.reason;
        knownStaleMissing.push(item);
      } else {
        item.error = "PACKAGE_FILE_MISSING";
        hardMissing.push(item);
      }
    }
  };
  check(Array.isArray(manifest.files) ? manifest.files.filter((f) => /\.(ts|mjs|md|json)$/.test(f)) : [], record.declaredFiles, "files");
  const exts = (manifest.pi && Array.isArray(manifest.pi.extensions)) ? manifest.pi.extensions : [];
  const skills = (manifest.pi && Array.isArray(manifest.pi.skills)) ? manifest.pi.skills : [];
  check(exts, record.piExtensions, "pi.extensions");
  check(skills, record.piSkills, "pi.skills");
  for (const [exp, target] of Object.entries(manifest.exports ?? {})) {
    const verdict = entryExists(pkgDir, target);
    const item = { kind: "exports", name: exp, ...verdict };
    if (verdict.exists !== false) record.exports.push(item);
    else if (staleExempt(target)) { item.stale = true; item.reason = known.reason; knownStaleMissing.push(item); }
    else { item.error = "PACKAGE_FILE_MISSING"; hardMissing.push(item); }
  }
  record.knownStaleEntries = knownStaleMissing;
  record.status = classify(manifest, hardMissing, knownStaleMissing);
  return { record, hardMissing, knownStaleMissing };
}

function inventory(args) {
  const sourceRoot = resolve(args.sourceRoot);
  const settingsPath = args.settings
    ? (isAbsolute(args.settings) ? resolve(args.settings) : resolve(process.cwd(), args.settings))
    : join(homedir(), ".omo", "agent", "settings.json");
  const pins = readSettings(settingsPath);
  const settingsDir = dirname(settingsPath);
  const resolved = pins.map((p) => (isAbsolute(p) ? resolve(p) : resolve(settingsDir, p)));
  const packagesRoot = dirname(resolved[0]);

  const records = [];
  const hardMissing = [];
  for (const pin of resolved) {
    const { record, hardMissing: hm } = auditPackage(pin, packagesRoot);
    records.push(record);
    hardMissing.push(...hm);
  }

  // Loose active extension (home extension dir, not package-managed).
  const agentDir = dirname(settingsPath);
  const loose = {
    path: join(agentDir, "extensions", "omo-model-tuning.ts"),
    testPath: join(agentDir, "extensions", "omo-model-tuning.test.js"),
  };
  loose.exists = existsSync(loose.path);
  loose.status = loose.exists ? "active-loose" : "missing";
  loose.sha256 = loose.exists ? sha256(loose.path) : null;
  loose.homeTestExists = existsSync(loose.testPath);
  loose.note =
    "registered through the home extension directory, not a package manifest; " +
    "piomo-personal-core's stale manifest entry for omo-model-tuning.ts is superseded by this active loose copy; " +
    "dynamic activation proof deferred to task 6";

  // omo-check command dependency (pr-watch.mjs) traced from SKILL.md + skills.json.
  const prWatch = {
    referencedBy: "packages/piomo-personal-skills/skills/omo-check/SKILL.md:24 and skills.json omo-check reference",
    workspacePath: join(sourceRoot, ".omo", "scripts", "pr-watch.mjs"),
    plannedCarryPath: "scripts/pr-watch.mjs",
  };
  prWatch.exists = existsSync(prWatch.workspacePath);
  prWatch.sha256 = prWatch.exists ? sha256(prWatch.workspacePath) : null;
  prWatch.note = "required command dependency for the retained omo-check skill; snapshot-output behavior carried in task 6, not proven here";

  const receipt = {
    tool: "qa/audit-packages.mjs",
    schema: "piomo.package-inventory/1",
    mode: "inventory",
    generatedAt: new Date().toISOString(),
    inputs: {
      sourceRoot,
      settings: settingsPath,
      settingsRead: "read-only",
      rawSettingsCopied: false,
    },
    pinCount: records.length,
    packages: records,
    looseExtension: loose,
    commandDependencies: [prWatch],
    staleEntries: records.flatMap((r) => (r.knownStaleEntries ?? []).map((e) => ({ package: r.name, ...e }))),
    statusLegend: {
      configured: "pinned in settings.json packages (all five pins)",
      active: "declared extension/skill entrypoints exist on disk",
      "library-only": "pinned but declares no pi.extensions/pi.skills entrypoints",
      stale: "declared entrypoint/file absent",
      "active-loose": "active loose extension outside any package manifest",
    },
    dynamicActivationProof: "deferred-to-task-6 (native disposable-host load; not claimed by this inventory)",
    errors: hardMissing,
    exitCode: hardMissing.length > 0 ? EXIT_FILE_MISSING : EXIT_OK,
  };

  if (args.out) {
    const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(receipt, null, 2) + "\n");
  }

  process.stdout.write(
    `audit-packages: pins=${records.length} stale=${receipt.staleEntries.length} ` +
      `loose=${loose.exists ? "present" : "missing"} prWatch=${prWatch.exists ? "present" : "missing"} ` +
      `errors=${hardMissing.length}\n`,
  );
  for (const e of hardMissing) {
    process.stdout.write(`PACKAGE_FILE_MISSING: ${e.entry} (${e.kind ?? e.error})\n`);
  }
  for (const s of receipt.staleEntries) {
    process.stdout.write(`STALE: ${s.package} ${s.entry} (${s.kind}) — reported, known-stale\n`);
  }
  return receipt.exitCode;
}

try {
  const args = parseArgs(process.argv.slice(2));
  process.exit(inventory(args));
} catch (err) {
  process.stderr.write(`AUDIT_ERROR: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(EXIT_INTERNAL);
}