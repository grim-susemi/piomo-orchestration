/* todo-9-health insert fragment.
 *
 * This file is NOT a standalone module. qa/bundle-health-anchor.mjs reads it and splices the
 * sections below into the beta.81 plugin/extensions/omo-task.js body *after* the slot-4
 * gateRepair splice and after the todo-8-quota splice (harness-diagnostics-improve Todo 9 lands
 * through its own patches/installed-patches.json slot `todo-9-health`, never inside gateRepair).
 *
 * Sections:
 *   @splice-admission -> inserted immediately after the async #J spawn lease line
 *                        (`u=void 0===c?void 0:this.#N.register(e.parent_session_id,c);`), before
 *                        the task-record allocation try-block: refuses a doomed spawn when the
 *                        deployment identity check says unhealthy (detect-only; no repair).
 *                        beta.84 re-author (P3, st_01a0cb41): the store is this.#E.store and the
 *                        registration manager this.#N; nothing else in this section changed.
 *   @defs             -> appended at the end of the bundle (ESM imports hoist). Contains the
 *                        LoadedBundleSnapshot capture (runs at module init, i.e. when the engine
 *                        imports this extension), the drift check, the lazy-target validator, the
 *                        guarded lazy import, the admission helper, the structured report writer
 *                        and the explicit export surface for the A/B proof + Todo 10/11.
 *
 * Contract (harness-diagnostics-improve Todo 9, C3 - detect-only bundle health):
 *   - the engine exports no live chunk identity (task-1-seams.json row
 *     `live-chunk-identity-export` is needs-upstream: neither `chunk` nor `deployment` appears in
 *     this bundle), so the loaded generation is captured HERE at init as new state: resolve the
 *     senpi dist/bundle root from this module's location, walk the referenced chunk graph of the
 *     bundle entries (static imports, dynamic/lazy imports, new URL(..., import.meta.url) targets)
 *     and hash every reachable file. Nothing is imported or evaluated by the walker: it reads
 *     bytes only (no eager imports, and never an eager provider import).
 *   - check(): re-hash every captured member and the manifest; missing/changed members or a
 *     changed manifest => unhealthy; a failed capture or an unavailable manifest => unknown.
 *     Unknown is never reported as healthy.
 *   - admission (#J): refuse the spawn when the verdict is unhealthy - the spawn would lazily
 *     import from a mismatched deployment and die with ENOENT (the observed Issue B: task
 *     st_01a0c66b, runtime_ms 74, tool_calls 0, ENOENT on a chunk name that only existed in the
 *     previous generation). OMO_BUNDLE_HEALTH_MODE=warn downgrades enforcement to report-only;
 *     the verdict itself never changes and nothing is ever repaired.
 *   - omoBundleHealthGuardedImport validates a lazy target against the loaded snapshot BEFORE
 *     importing it, so a mismatched generation is refused with a structured cause instead of
 *     throwing ENOENT.
 *   - reports: <stateDir>/bundle-health/last.json on non-healthy verdicts only (atomic
 *     tmp+rename). The healthy path writes nothing.
 *
 * Repair is Todo 10 (reinstall + restart), not here: this section never writes to the bundle, never
 * deletes, never re-imports, never substitutes a path and never plants a renamed chunk copy.
 * Scope note: the snapshot covers the senpi dist/bundle graph (entries + transitively referenced
 * chunks). The omo-ai plugin files and the engine's own in-memory module table are not visible
 * from this layer, so a stale engine-internal table stays an upstream blind spot - recorded
 * honestly in the Todo 9 evidence, never papered over as healthy.
 *
 * Reference shapes were validated against the installed beta.81 bundle by
 * qa/bundle-health-anchor.test.mjs: 130 referenced files, zero unresolved import-syntax
 * references, one intentionally-absent `new URL` target (chunks/extension-runtime-module.js, an
 * existsSync-guarded bun-only path) - which is why a missing URL-kind target is recorded but is
 * never by itself a health failure, while a missing import-syntax target is.
 */
// ==== @splice-admission
{const omoBundleHealthGate=omoBundleHealthAdmission(this.#E.store,e.parent_session_id);if(!0===omoBundleHealthGate.refuse){void 0!==u&&this.#N.release(e.parent_session_id,u.name);return{kind:"start_failed",task_id:"",name:c??"",...e.category??void 0!==t.category?{category:e.category??t.category}:{},...e.subagent_type??void 0!==t.agentType?{subagent_type:e.subagent_type??t.agentType}:{},execution_mode:l,model:t.model,...void 0!==t.resolved_model?{resolved_model:t.resolved_model}:{},run_in_background:!0===e.run_in_background,error_message:omoBundleHealthGate.message}}}
// ==== @defs
// ---------------------------------------------------------------------------
// omoBundleHealth - detect-only bundle health (Todo 9, slot todo-9-health).
// Self-contained: node: builtins only, no engine-local symbol, no consumer change.
// ---------------------------------------------------------------------------
import { readFileSync as obhReadFileSync, readdirSync as obhReaddirSync, mkdirSync as obhMkdirSync, writeFileSync as obhWriteFileSync, renameSync as obhRenameSync, rmSync as obhRmSync } from "node:fs";
import { join as obhJoin, dirname as obhDirname, resolve as obhResolve, relative as obhRelative, isAbsolute as obhIsAbsolute, sep as obhSep } from "node:path";
import { createHash as obhCreateHash } from "node:crypto";
import { fileURLToPath as obhFileURLToPath } from "node:url";

var omoBundleHealthSnapshotSchema = "omo/bundle-health/snapshot/v1";
var omoBundleHealthReportSchema = "omo/bundle-health/report/v1";
var omoBundleHealthMaxMembers = 4096;
var omoBundleHealthMaxDrift = 32;
var omoBundleHealthPackageName = "@code-yeongyu/senpi";
var omoBundleHealthBundleParts = ["dist", "bundle"];
var omoBundleHealthEntryName = /^[A-Za-z0-9._-]+\.js$/;
var omoBundleHealthSpecifierShape = /^\.{1,2}\/[A-Za-z0-9._\/-]+\.js$/;
// Reference shapes validated against the installed beta.81 bundle (128 referenced files, zero
// import-syntax misses) by qa/bundle-health-anchor.test.mjs:
//   0 static import/export ... from "./x.js"
//   1 bare import "./x.js"
//   2 dynamic import("./x.js")           <- the lazy-import surface (senpi lazyApi pattern)
//   3 new URL("./x.js", import.meta.url) <- worker/runtime entries (path construction, may be
//     intentionally absent in some installs; recorded, never fatal by itself)
var omoBundleHealthSpecifierPatterns = [
  { kind: "import", lazy: false, pattern: /(?:^|[;{}\s])(?:import|export)\s*(?:\{[^}"'\n]{0,400}\}|\*\s*as\s*[A-Za-z0-9_$]+|[A-Za-z0-9_$]+)?\s*from\s*["'](\.{1,2}\/[^"'\n]{1,160})["']/g },
  { kind: "import", lazy: false, pattern: /(?:^|[;{}\s])import\s*["'](\.{1,2}\/[^"'\n]{1,160})["']/g },
  { kind: "import", lazy: true, pattern: /import\s*\(\s*["'](\.{1,2}\/[^"'\n]{1,160})["']\s*\)/g },
  { kind: "url", lazy: true, pattern: /new\s+URL\s*\(\s*[^)\n]{0,240}?["'](\.{1,2}\/[^"'\n]{1,160}\.js)["'][^)\n]{0,240}?,\s*import\.meta\.url\s*\)/g }
];

function omoBundleHealthNow() { return Date.now(); }
function omoBundleHealthSha256(bytes) { return obhCreateHash("sha256").update(bytes).digest("hex"); }
function omoBundleHealthPosix(value) { return value.split(obhSep).join("/"); }
function omoBundleHealthErrorCode(error) {
  try { if (null !== error && "object" == typeof error && "string" == typeof error.code) return error.code; } catch {}
  return "UNKNOWN_ERROR";
}
function omoBundleHealthJson(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { return undefined; }
}
function omoBundleHealthJoinParts(root, parts) {
  var out = root;
  for (var i = 0; i < parts.length; i += 1) out = obhJoin(out, parts[i]);
  return out;
}
function omoBundleHealthSortByRel(left, right) { return left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0; }

// Resolve the live senpi deployment from THIS module's location (the layer's own module): walk the
// ancestor node_modules directories, then fall back to the process cwd chain. A candidate counts
// only when its package.json declares the expected package name, so a foreign tree can never be
// mistaken for the deployment. (senpi's exports map has no require/package.json condition, so
// createRequire().resolve cannot be used here - the postinstall senpi-patch.mjs uses the same
// search-path probing shape.)
function omoBundleHealthResolveDeployment() {
  var candidates = [];
  var starts = [];
  try { starts.push(obhFileURLToPath(import.meta.url)); } catch {}
  try { starts.push(process.cwd()); } catch {}
  for (var s = 0; s < starts.length; s += 1) {
    var directory = obhDirname(starts[s]);
    for (var depth = 0; depth < 12; depth += 1) {
      var candidate = obhJoin(directory, "node_modules", "@code-yeongyu", "senpi", "package.json");
      if (candidates.indexOf(candidate) === -1) {
        candidates.push(candidate);
        var parsed = undefined;
        try { parsed = omoBundleHealthJson(obhReadFileSync(candidate)); } catch {}
        if (undefined !== parsed && omoBundleHealthPackageName === parsed.name) return { packageRoot: obhDirname(candidate), manifestPath: candidate, version: parsed.version };
      }
      var parent = obhDirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return { error: "MANIFEST_NOT_FOUND" };
}

// Walk the referenced chunk graph without ever importing it: entries are the bundle-root *.js
// files, references are the relative specifiers matched by omoBundleHealthSpecifierPatterns,
// followed transitively. Every reachable file is read and hashed exactly once. A file that cannot
// be read is classified by the kind of the reference that led to it: an import-syntax target is a
// truncated deployment (startup unhealthy), a new URL target is recorded as optional (some
// installs intentionally omit them; the loader code guards with existsSync).
function omoBundleHealthWalkGraph(bundleRoot) {
  var entries = [];
  var dirents = [];
  try { dirents = obhReaddirSync(bundleRoot, { withFileTypes: true }); } catch (error) { return { error: omoBundleHealthErrorCode(error) }; }
  for (var i = 0; i < dirents.length; i += 1) if (dirents[i].isFile() && omoBundleHealthEntryName.test(dirents[i].name)) entries.push(dirents[i].name);
  entries.sort();
  var members = new Map();
  var pendingKind = new Map();
  var references = [];
  var importUnresolved = [];
  var urlUnresolved = [];
  var queue = entries.slice();
  var guard = 0;
  while (queue.length > 0 && guard < omoBundleHealthMaxMembers) {
    guard += 1;
    var rel = queue.shift();
    if (members.has(rel)) continue;
    var absolute = obhJoin(bundleRoot, rel);
    var bytes = null;
    try { bytes = obhReadFileSync(absolute); } catch (error) {
      var missingKind = pendingKind.get(rel) ?? "url";
      var finding = { from: undefined, specifier: undefined, rel: rel, kind: missingKind, error: omoBundleHealthErrorCode(error) };
      if ("import" === missingKind) importUnresolved.push(finding); else urlUnresolved.push(finding);
      continue;
    }
    members.set(rel, { rel: rel, bytes: bytes.length, sha256: omoBundleHealthSha256(bytes), kind: entries.indexOf(rel) !== -1 ? "entry" : (pendingKind.get(rel) ?? "entry") });
    var text = bytes.toString("utf8");
    for (var p = 0; p < omoBundleHealthSpecifierPatterns.length; p += 1) {
      var rule = omoBundleHealthSpecifierPatterns[p];
      rule.pattern.lastIndex = 0;
      var match = rule.pattern.exec(text);
      while (null !== match) {
        var specifier = match[1];
        match = rule.pattern.exec(text);
        if (!omoBundleHealthSpecifierShape.test(specifier)) continue;
        var resolved = omoBundleHealthPosix(obhRelative(bundleRoot, obhResolve(obhDirname(absolute), specifier)));
        if (resolved.startsWith("../") || "" === resolved || "." === resolved) {
          var escaped = { from: rel, specifier: specifier, rel: resolved, kind: rule.kind, error: "ESCAPES_BUNDLE_ROOT" };
          if ("import" === rule.kind) importUnresolved.push(escaped); else urlUnresolved.push(escaped);
          continue;
        }
        references.push({ from: rel, specifier: specifier, rel: resolved, kind: rule.kind, lazy: true === rule.lazy });
        var prior = pendingKind.get(resolved);
        if (undefined === prior || ("import" === rule.kind && "import" !== prior)) pendingKind.set(resolved, rule.kind);
        if (!members.has(resolved)) queue.push(resolved);
      }
    }
  }
  var sorted = [...members.values()].sort(omoBundleHealthSortByRel);
  return { entries: entries, members: sorted, references: references, importUnresolved: importUnresolved, urlUnresolved: urlUnresolved, truncated: guard >= omoBundleHealthMaxMembers };
}

function omoBundleHealthGenerationId(deployment) {
  var lines = [omoBundleHealthPackageName + "@" + String(deployment.version ?? "unknown"), deployment.manifestSha256];
  for (var i = 0; i < deployment.members.length; i += 1) lines.push(deployment.members[i].rel + "\u0000" + deployment.members[i].sha256);
  return "sha256:" + omoBundleHealthSha256(Buffer.from(lines.join("\n"), "utf8"));
}

// Capture the loaded generation. Runs once at module init (the engine imports this extension at
// session start, so the captured bytes are the generation the process will lazily import from).
// Never throws: any failure degrades to state unknown (never healthy).
function omoBundleHealthCapture() {
  var startedAtMs = omoBundleHealthNow();
  try {
    var resolved = omoBundleHealthResolveDeployment();
    if (undefined !== resolved.error) return { state: "unknown", reason: "manifest-unresolved", detail: resolved.error, capturedAtMs: startedAtMs };
    var manifestBytes = null;
    try { manifestBytes = obhReadFileSync(resolved.manifestPath); } catch (error) { return { state: "unknown", reason: "manifest-unreadable", detail: omoBundleHealthErrorCode(error), capturedAtMs: startedAtMs }; }
    var parsed = omoBundleHealthJson(manifestBytes);
    if (undefined === parsed || omoBundleHealthPackageName !== parsed.name) return { state: "unknown", reason: "manifest-invalid", capturedAtMs: startedAtMs };
    var bundleRoot = omoBundleHealthJoinParts(resolved.packageRoot, omoBundleHealthBundleParts);
    var graph = omoBundleHealthWalkGraph(bundleRoot);
    if (undefined !== graph.error) return { state: "unknown", reason: "bundle-root-unreadable", detail: graph.error, capturedAtMs: startedAtMs };
    if (0 === graph.members.length) return { state: "unknown", reason: "graph-empty", capturedAtMs: startedAtMs };
    var deployment = { version: parsed.version, manifestSha256: omoBundleHealthSha256(manifestBytes), members: graph.members };
    var snapshot = {
      schema: omoBundleHealthSnapshotSchema,
      capturedAtMs: startedAtMs,
      captureMs: omoBundleHealthNow() - startedAtMs,
      packageRoot: omoBundleHealthPosix(resolved.packageRoot),
      manifestPath: omoBundleHealthPosix(resolved.manifestPath),
      manifestSha256: deployment.manifestSha256,
      packageVersion: parsed.version,
      bundleRoot: omoBundleHealthPosix(bundleRoot),
      entries: graph.entries,
      members: graph.members,
      referenceCount: graph.references.length,
      importReferenceCount: graph.references.filter(function (reference) { return "import" === reference.kind; }).length,
      lazyReferenceCount: graph.references.filter(function (reference) { return true === reference.lazy; }).length,
      urlReferenceCount: graph.references.filter(function (reference) { return "url" === reference.kind; }).length,
      truncated: true === graph.truncated,
      optionalMissing: graph.urlUnresolved.slice(0, omoBundleHealthMaxDrift),
      optionalMissingCount: graph.urlUnresolved.length,
      importUnresolved: graph.importUnresolved.slice(0, omoBundleHealthMaxDrift),
      importUnresolvedCount: graph.importUnresolved.length,
      generationId: omoBundleHealthGenerationId(deployment)
    };
    if (graph.importUnresolved.length > 0) {
      // An import-syntax reference that does not resolve on disk is a truncated deployment: the
      // next import of that specifier is guaranteed to fail. Unhealthy at capture, never healthy.
      return { state: "unhealthy", reason: "import-reference-unresolved", detail: "the loaded bundle graph references import targets that are absent on disk", snapshot: snapshot, capturedAtMs: startedAtMs };
    }
    return { state: "healthy", reason: "capture-ok", basis: "capture", snapshot: snapshot, capturedAtMs: startedAtMs };
  } catch (error) {
    return { state: "unknown", reason: "capture-failed", detail: omoBundleHealthErrorCode(error), capturedAtMs: startedAtMs };
  }
}

function omoBundleHealthSummarize(verdict) {
  if ("healthy" === verdict.state) return "bundle generation matches disk";
  if ("unhealthy" === verdict.state) {
    var counts = verdict.counts;
    if (undefined !== counts && "number" == typeof counts.missing) {
      var unresolved = "number" == typeof counts.importUnresolved ? counts.importUnresolved : 0;
      if (0 === counts.missing && 0 === counts.changed && unresolved > 0) return unresolved + " unresolved import reference" + (1 === unresolved ? "" : "s");
      var parts = [counts.missing + " missing", counts.changed + " changed"];
      if (unresolved > 0) parts.push(unresolved + " unresolved imports");
      return parts.join(", ");
    }
    if (undefined !== counts && "number" == typeof counts.importUnresolved) return counts.importUnresolved + " unresolved import references";
    return String(verdict.reason ?? "unhealthy");
  }
  return "unknown (" + String(verdict.reason ?? "no-reason") + ")";
}

function omoBundleHealthStartupVerdict(startup) {
  var snapshot = startup.snapshot ?? null;
  var verdict = {
    state: "unhealthy" === startup.state ? "unhealthy" : "unknown",
    reason: startup.reason ?? "snapshot-absent",
    detail: startup.detail,
    counts: { members: null === snapshot ? 0 : snapshot.members.length, missing: 0, changed: 0, importUnresolved: null === snapshot ? 0 : snapshot.importUnresolvedCount },
    generationId: null === snapshot ? undefined : snapshot.generationId,
    capturedAtMs: startup.capturedAtMs,
    bundleRoot: null === snapshot ? undefined : snapshot.bundleRoot,
    packageVersion: null === snapshot ? undefined : snapshot.packageVersion
  };
  if (null !== snapshot) {
    verdict.importUnresolved = snapshot.importUnresolved;
    verdict.optionalMissing = snapshot.optionalMissing;
  }
  return verdict;
}

// Compare the captured identity against the current disk bytes. Every member is re-hashed (content
// identity, not name identity: same filenames with different contents must report changed) and the
// manifest is re-hashed. Missing/any-change => unhealthy; unreadable member or unavailable manifest
// => unknown. Never returns healthy when the loaded snapshot is absent or the capture was not
// healthy.
function omoBundleHealthCheck() {
  try {
    var startup = omoBundleHealthStartup;
    var snapshot = omoBundleHealthLoadedSnapshot;
    if (null === snapshot || undefined === snapshot || "healthy" !== startup.state) return omoBundleHealthStartupVerdict(startup);
    var manifestBytes = null;
    try { manifestBytes = obhReadFileSync(snapshot.manifestPath); } catch (error) { return { state: "unknown", reason: "manifest-unavailable", detail: omoBundleHealthErrorCode(error), counts: { members: snapshot.members.length, missing: 0, changed: 0 }, generationId: snapshot.generationId, capturedAtMs: snapshot.capturedAtMs, bundleRoot: snapshot.bundleRoot, packageVersion: snapshot.packageVersion }; }
    var manifestSha256 = omoBundleHealthSha256(manifestBytes);
    var missing = [];
    var changed = [];
    var currentMembers = [];
    var unreadable = null;
    for (var i = 0; i < snapshot.members.length; i += 1) {
      var member = snapshot.members[i];
      var bytes = null;
      try { bytes = obhReadFileSync(obhJoin(snapshot.bundleRoot, member.rel)); } catch (error) {
        var code = omoBundleHealthErrorCode(error);
        if ("ENOENT" === code || "ENOTDIR" === code) { missing.push({ rel: member.rel, kind: member.kind }); continue; }
        unreadable = { rel: member.rel, error: code };
        break;
      }
      var sha256 = omoBundleHealthSha256(bytes);
      currentMembers.push({ rel: member.rel, bytes: bytes.length, sha256: sha256, kind: member.kind });
      if (sha256 !== member.sha256) changed.push({ rel: member.rel, kind: member.kind, expectedSha256: member.sha256, actualSha256: sha256 });
    }
    if (null !== unreadable) return { state: "unknown", reason: "member-unreadable", detail: unreadable, counts: { members: snapshot.members.length, missing: missing.length, changed: changed.length }, generationId: snapshot.generationId, capturedAtMs: snapshot.capturedAtMs, bundleRoot: snapshot.bundleRoot, packageVersion: snapshot.packageVersion };
    var manifestChanged = manifestSha256 !== snapshot.manifestSha256;
    var deployment = { version: snapshot.packageVersion, manifestSha256: manifestSha256, members: currentMembers.slice().sort(omoBundleHealthSortByRel) };
    var counts = { members: snapshot.members.length, missing: missing.length, changed: changed.length, manifestChanged: manifestChanged ? 1 : 0 };
    var base = {
      counts: counts,
      generationId: snapshot.generationId,
      currentGenerationId: omoBundleHealthGenerationId(deployment),
      capturedAtMs: snapshot.capturedAtMs,
      checkedAtMs: omoBundleHealthNow(),
      bundleRoot: snapshot.bundleRoot,
      packageVersion: snapshot.packageVersion,
      missing: missing.slice(0, omoBundleHealthMaxDrift),
      changed: changed.slice(0, omoBundleHealthMaxDrift)
    };
    if (missing.length > 0 || changed.length > 0 || manifestChanged) {
      base.state = "unhealthy";
      base.reason = "deployment-drift";
      base.detail = missing.length > 0 ? "the loaded generation references files that are no longer on disk" : "the loaded generation bytes no longer match disk";
      return base;
    }
    base.state = "healthy";
    base.reason = "identity-match";
    return base;
  } catch (error) {
    return { state: "unknown", reason: "check-failed", detail: omoBundleHealthErrorCode(error), counts: { members: 0, missing: 0, changed: 0 } };
  }
}

// Import-time lazy-target validation: resolve the target inside the loaded bundle root and compare
// its bytes with the captured identity BEFORE any import happens. A target outside the graph is
// unknown - never healthy.
function omoBundleHealthValidateTarget(target) {
  try {
    var snapshot = omoBundleHealthLoadedSnapshot;
    if (null === snapshot || undefined === snapshot) return { state: "unknown", reason: "snapshot-absent" };
    var candidate = target;
    try { if ("string" == typeof candidate && candidate.startsWith("file:")) candidate = obhFileURLToPath(candidate); } catch { return { state: "unknown", reason: "bad-target" }; }
    if ("string" != typeof candidate || 0 === candidate.length) return { state: "unknown", reason: "bad-target" };
    var absolute = obhIsAbsolute(candidate) ? candidate : obhResolve(snapshot.bundleRoot, candidate);
    var rel = omoBundleHealthPosix(obhRelative(snapshot.bundleRoot, absolute));
    if (rel.startsWith("../") || "" === rel || "." === rel) return { state: "unknown", reason: "outside-bundle-root" };
    var index = omoBundleHealthMemberIndex;
    var member = null === index || undefined === index ? undefined : index.get(rel);
    if (undefined === member) return { state: "unknown", reason: "target-not-in-loaded-graph", rel: rel };
    var bytes = null;
    try { bytes = obhReadFileSync(absolute); } catch (error) {
      var code = omoBundleHealthErrorCode(error);
      if ("ENOENT" === code || "ENOTDIR" === code) return { state: "unhealthy", reason: "target-missing", rel: rel, expectedSha256: member.sha256 };
      return { state: "unknown", reason: "target-unreadable", rel: rel, detail: code };
    }
    var sha256 = omoBundleHealthSha256(bytes);
    if (sha256 !== member.sha256) return { state: "unhealthy", reason: "target-changed", rel: rel, expectedSha256: member.sha256, actualSha256: sha256 };
    return { state: "healthy", reason: "target-match", rel: rel, sha256: sha256 };
  } catch (error) {
    return { state: "unknown", reason: "target-check-failed", detail: omoBundleHealthErrorCode(error) };
  }
}

// Validate, then import. The doomed import never runs: an unhealthy target returns a structured
// result instead of throwing ENOENT. Unknown targets do not block (we cannot prove them stale).
async function omoBundleHealthGuardedImport(specifier, options) {
  var base = options?.baseUrl ?? import.meta.url;
  var url = null;
  try { url = new URL(specifier, base); } catch { return { ok: false, state: "unknown", reason: "bad-specifier", verdict: { state: "unknown", reason: "bad-specifier" } }; }
  var verdict = omoBundleHealthValidateTarget(url.href);
  if ("unhealthy" === verdict.state) return { ok: false, state: "unhealthy", verdict: verdict };
  var module = await import(url.href);
  return { ok: true, state: verdict.state, verdict: verdict, module: module };
}

// Structured report: written only on non-healthy verdicts (atomic tmp+rename, capped drift lists).
// Never repairs, never touches the bundle.
function omoBundleHealthReportPath(stateDir) {
  if ("string" != typeof stateDir || 0 === stateDir.length) return undefined;
  return obhJoin(stateDir, "bundle-health", "last.json");
}
function omoBundleHealthWriteReport(stateDir, verdict, extra) {
  try {
    var file = omoBundleHealthReportPath(stateDir);
    if (undefined === file) return undefined;
    omoBundleHealthReportRevision += 1;
    var previousRevision = 0;
    try { var previous = omoBundleHealthJson(obhReadFileSync(file)); if (undefined !== previous && "number" == typeof previous.revision) previousRevision = previous.revision; } catch {}
    var report = {
      schema: omoBundleHealthReportSchema,
      revision: Math.max(previousRevision, omoBundleHealthReportRevision),
      updatedAtMs: omoBundleHealthNow(),
      trigger: undefined === extra ? "check" : (extra.trigger ?? "check"),
      state: verdict.state,
      reason: verdict.reason,
      detail: verdict.detail,
      summary: omoBundleHealthSummarize(verdict),
      generationId: verdict.generationId,
      currentGenerationId: verdict.currentGenerationId,
      capturedAtMs: verdict.capturedAtMs,
      counts: verdict.counts,
      missing: verdict.missing ?? [],
      changed: verdict.changed ?? [],
      importUnresolved: verdict.importUnresolved,
      optionalMissing: verdict.optionalMissing,
      bundleRoot: verdict.bundleRoot,
      packageVersion: verdict.packageVersion,
      sessionId: undefined === extra ? undefined : extra.sessionId,
      taskId: undefined === extra ? undefined : extra.taskId,
      note: "detect-only bundle health: nothing was repaired; repair is reinstall + session restart (Todo 10)"
    };
    obhMkdirSync(obhDirname(file), { recursive: true });
    var temporary = file + "." + String(process.pid) + ".tmp";
    try { obhWriteFileSync(temporary, JSON.stringify(report) + "\n", "utf8"); obhRenameSync(temporary, file); } catch { try { obhRmSync(temporary, { force: true }); } catch {} return undefined; }
    return file;
  } catch { return undefined; }
}

// Admission helper: the verdict plus the enforcement decision. Enforcement defaults to refuse and
// can be downgraded to report-only with OMO_BUNDLE_HEALTH_MODE=warn; the verdict is never
// weakened, nothing is repaired and nothing is written on the healthy path.
function omoBundleHealthAdmission(store, sessionId) {
  try {
    var verdict = omoBundleHealthCheck();
    var out = {
      state: verdict.state,
      reason: verdict.reason,
      detail: verdict.detail,
      summary: omoBundleHealthSummarize(verdict),
      counts: verdict.counts,
      generationId: verdict.generationId,
      currentGenerationId: verdict.currentGenerationId,
      refuse: false
    };
    if ("healthy" === verdict.state) return out;
    var warnOnly = false;
    if ("unhealthy" === verdict.state) {
      try { warnOnly = "warn" === String(process.env.OMO_BUNDLE_HEALTH_MODE ?? "").toLowerCase(); } catch {}
      out.refuse = !warnOnly;
      out.warnOnly = warnOnly;
      out.message = "bundle health: " + out.summary + " (" + String(verdict.detail ?? verdict.reason ?? "loaded generation no longer matches disk") + "); " + (warnOnly ? "spawn allowed by OMO_BUNDLE_HEALTH_MODE=warn" : "refusing this spawn") + " - detect-only; repair is reinstall + session restart";
    }
    out.reportPath = omoBundleHealthWriteReport(undefined === store ? undefined : store.stateDir, verdict, { trigger: "admission", sessionId: sessionId });
    if ("unhealthy" === verdict.state) {
      var warnKey = verdict.state + "|" + String(verdict.reason) + "|" + out.summary;
      if (omoBundleHealthLastWarnKey !== warnKey) {
        omoBundleHealthLastWarnKey = warnKey;
        try { console.warn("[omo] " + out.message + (undefined === out.reportPath ? "" : " report=" + out.reportPath)); } catch {}
      }
    }
    return out;
  } catch (error) {
    return { state: "unknown", reason: "admission-check-failed", detail: omoBundleHealthErrorCode(error), summary: "unknown (admission-check-failed)", refuse: false };
  }
}

// NEW state: captured at module init, when the engine imports this extension. This is the loaded
// generation the process will lazily import from for its whole lifetime, not a fresh disk read.
var omoBundleHealthStartup = omoBundleHealthCapture();
var omoBundleHealthLoadedSnapshot = undefined === omoBundleHealthStartup.snapshot ? null : omoBundleHealthStartup.snapshot;
var omoBundleHealthMemberIndex = new Map();
if (null !== omoBundleHealthLoadedSnapshot) for (var omoBundleHealthInit = 0; omoBundleHealthInit < omoBundleHealthLoadedSnapshot.members.length; omoBundleHealthInit += 1) omoBundleHealthMemberIndex.set(omoBundleHealthLoadedSnapshot.members[omoBundleHealthInit].rel, omoBundleHealthLoadedSnapshot.members[omoBundleHealthInit]);
var omoBundleHealthLastWarnKey = null;
var omoBundleHealthReportRevision = 0;
if ("unhealthy" === omoBundleHealthStartup.state) {
  try {
    console.warn("[omo] bundle health at init: unhealthy (" + String(omoBundleHealthStartup.reason ?? "no-reason") + ") - detect-only; repair is reinstall + session restart");
  } catch {}
}

export { omoBundleHealthStartup as omoBundleHealthStartup, omoBundleHealthCheck as omoBundleHealthCheck, omoBundleHealthValidateTarget as omoBundleHealthValidateTarget, omoBundleHealthGuardedImport as omoBundleHealthGuardedImport, omoBundleHealthAdmission as omoBundleHealthAdmission };
