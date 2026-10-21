#!/usr/bin/env node
// Read-only checker for the custom patch ledger (custom-layer/PATCHES.md).
//
// For every live patch it reports:
//   - the source repository's HEAD, remote, ahead/behind against its upstream, and dirtiness;
//   - whether the tracked source blob and the captured copy still match what is installed;
//   - the installed file hashes;
//   - for the senpi anchor patches (senpi-freeze-fix, senpi-stream-hash-leak), `patch.mjs --check`
//     and `probe.mjs` on the installed senpi root AND on every runtime snapshot under
//     <agent>/runtime. Sessions run the snapshot, not the install, so a snapshot that is not
//     patched means the fix is not live.
//
// It never writes to a repository or to an installed file. `probe.mjs` copies senpi's
// dist to a temp directory and deletes it, as documented in its own README.
// Without --strict it always exits 0 when the check ran; drift is reported, not thrown.
//
// --strict adds the update gate. PATCHES.md and the checker rows are compared in both
// directions, every active extension/package entry of the agent is matched to a ledger row,
// and the run ends with one verdict:
//   exit 0  pass        every automated check is ok and nothing is left unverified
//   exit 1  fail        missing/drifted/unreadable item, ledger mismatch, unledgered entry
//   exit 3  incomplete  no failure, but something is unverified (source not pushed or not
//                       committed, manual check, --only run). Unclear or untested never passes.
// --json prints one JSON document instead of the text lines (exit 0 unless --strict).
// Neither flag shows that an extension loads or behaves correctly in a new process.
//
// Usage:
//   node custom-layer/check-patches.mjs [--only <name>] [--senpi-root <dir>] [--verbose] [--strict] [--json]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  classifyText as classifyPlanReviewText,
  transformText as transformPlanReviewText,
} from "./plan-review-unlock/patch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);

const AGENT =
  process.env.OMO_CHECK_AGENT_DIR ||
  "C:/Users/USER/.omo-stable-500/home/.omo/agent";
const OVERLAY =
  process.env.OMO_CHECK_OVERLAY_ROOT ||
  "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package";
const GLOBAL_OMO =
  process.env.OMO_CHECK_GLOBAL_OMO ||
  "C:/Users/USER/.bun/install/global/node_modules/omo-ai";
const SENPI =
  process.env.OMO_CHECK_SENPI_ROOT ||
  "C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi";

const LANE = process.env.OMO_CHECK_LANE_ROOT || "C:/Users/USER/.omo-stable-500";
const HOME_OMO = process.env.OMO_CHECK_HOME_OMO || path.dirname(AGENT);
const PR_WATCH =
  process.env.OMO_CHECK_PR_WATCH ||
  "C:/Users/USER/orca/projects/기타 작업/.omo/scripts/pr-watch.mjs";
const LEDGER = path.join(HERE, "PATCHES.md");
const SCOPE =
  "installed bytes, patch state, source preservation, ledger and discovery; loading and behaviour in a new process are not checked";

const ORCH = REPO;
const COORD = "C:/Users/USER/orca/projects/piomo-agent-coordination-mod";
const COMPACTION = "C:/Users/USER/orca/projects/omo-compaction-model";
const EARLY = "C:/Users/USER/orca/projects/piomo-early-compaction-mod";
const BRIEFING = "C:/Users/USER/orca/projects/piomo-briefing";
const DASHBOARD = "C:/Users/USER/orca/projects/omo-herdr-dashboard";
const ORACLE = "C:/Users/USER/orca/projects/piomo-oracle-advisor-mod";

// Both chunk names are listed: chunk-35M5MVUZ.js is senpi 2026.10.19, chunk-F4ZU4RBE.js is 2026.10.19-2.
// The lists only decide whether a --from-backups probe runs; an absent file is skipped.
const FREEZE_FILES = [
  "dist/core/extensions/builtin/moved-path-guard/command-paths.js",
  "dist/core/tools/filesystem-policy.js",
  "dist/bundle/chunks/chunk-35M5MVUZ.js",
  "dist/bundle/chunks/chunk-F4ZU4RBE.js",
  "dist/bundle/chunks/session-worker.js",
];

const LEAK_FILES = [
  "dist/bundle/chunks/chunk-35M5MVUZ.js",
  "dist/bundle/chunks/chunk-F4ZU4RBE.js",
  "dist/bundle/chunks/session-worker.js",
  "dist/core/extensions/builtin/anthropic-subscription/session-commit-boundary.js",
];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested by test/check-patches.test.mjs)

export function parseRevCount(text) {
  const m = String(text ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return null;
  return { behind: Number(m[1]), ahead: Number(m[2]) };
}

export const STATES = Object.freeze(["tracked", "local-commit", "private", "external"]);

export function classifyState({ hint, upstream, ahead } = {}) {
  // Owner configuration and third-party copies have no repository of ours by design.
  if (hint === "private" || hint === "external") return hint;
  if (hint === "local-commit") return "local-commit";
  if (!upstream) return "local-commit";
  if (typeof ahead !== "number") return "local-commit";
  return ahead > 0 ? "local-commit" : "tracked";
}

// missing > drift > ok
export function aggregate(statuses) {
  const list = statuses.filter(Boolean);
  if (list.includes("missing")) return "missing";
  if (list.includes("drift")) return "drift";
  if (list.includes("error")) return "error";
  return "ok";
}

/** Runtime snapshot directories senpi hands off to (each holds runtime-snapshot.json). */
export function runtimeRoots(agentDir) {
  const root = path.join(agentDir, "runtime");
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "runtime-snapshot.json")));
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function short(hash) {
  return hash ? hash.slice(0, 7) : "-";
}

export function formatRow(row) {
  const repo = row.repo || {};
  const installed = row.installed || [];
  const okCount = installed.filter((f) => f.status === "ok").length;
  const parts = [
    `PATCH ${row.name}`,
    `state=${row.state}`,
    `source=${row.location}`,
    `sourceCheck=${row.sourceCheck}`,
    `repo=${repo.name || "-"}`,
    `remote=${repo.remote || "-"}`,
    `head=${short(repo.head)}`,
    `upstream=${repo.upstream || "-"}`,
    `ahead=${repo.ahead ?? "-"}`,
    `behind=${repo.behind ?? "-"}`,
    `dirty=${repo.dirty == null ? "-" : repo.dirty ? "yes" : "no"}`,
    `installed=${aggregate(installed.map((f) => f.status))}(${okCount}/${installed.length})`,
  ];
  if (row.extras && row.extras.length) parts.push(...row.extras);
  return parts.join(" ");
}

/** Git's object id for these bytes (same as `git hash-object --no-filters`). */
export function gitBlobId(buf) {
  return crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

/** One hash for a directory: sha256 over sorted `relative-path NUL sha256 LF` lines. */
export function treeHash(dir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const child = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (fs.statSync(child).isDirectory()) walk(child, childRel);
      else files.push([childRel, sha256File(child)]);
    }
  };
  walk(dir, "");
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const hash = crypto.createHash("sha256");
  for (const [rel, sum] of files) hash.update(`${rel}\0${sum}\n`);
  return { files: files.length, hash: hash.digest("hex") };
}

/** Rows of every Markdown table whose header starts with `| name |`: id and state cell. */
export function parseLedger(text) {
  const rows = [];
  let table = null; // null outside a table, false in another table, { state } in a ledger table
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      table = null;
      continue;
    }
    const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    if (table === null) {
      table = cells[0] === "name" ? { state: cells.indexOf("state") } : false;
      continue;
    }
    if (!table || /^:?-{3,}:?$/.test(cells[0])) continue;
    rows.push({ id: cells[0].replace(/`/g, ""), state: table.state >= 0 ? cells[table.state] ?? null : null });
  }
  return rows;
}

/** Both directions: ledger ids without a checker row, checker rows without a ledger id, state disagreements. */
export function compareLedger(ledgerRows, checkerRows) {
  const ids = ledgerRows.map((row) => row.id);
  const ledger = new Map(ledgerRows.map((row) => [row.id, row.state]));
  const checker = new Map(checkerRows.map((row) => [row.name, row.hint]));
  return {
    ids,
    duplicates: ids.filter((id, index) => ids.indexOf(id) !== index),
    missingFromChecker: ids.filter((id) => !checker.has(id)),
    missingFromLedger: [...checker.keys()].filter((name) => !ledger.has(name)),
    stateMismatch: [...ledger]
      .filter(([id, state]) => checker.has(id) && checker.get(id) !== state)
      .map(([id, state]) => ({ id, ledger: state, checker: checker.get(id) })),
  };
}

/** Every launcher pin must name the installed version, and the overlay must be the pinned omo. */
export function pinConsistency(pins, installed) {
  const problems = [];
  for (const pin of pins) {
    for (const key of ["omo", "senpi"]) {
      if (!pin[key] || pin[key] !== installed[key]) problems.push(`${pin.label}.${key}=${pin[key] ?? "missing"}`);
    }
  }
  if (!installed.overlay || installed.overlay !== installed.omo) problems.push(`overlay=${installed.overlay ?? "missing"}`);
  const versions = `omo=${installed.omo ?? "missing"} senpi=${installed.senpi ?? "missing"}`;
  return problems.length
    ? { status: "drift", actual: `${problems.join(",")} installed ${versions}` }
    : { status: "ok", actual: versions };
}

const HOST_SHIM =
  /^\/\/ Generated by OmO\. Delete this file to stop loading the default global extension\.\r?\nexport \{ default \} from "file:\/\/\/[^"]+\/@code-yeongyu\/senpi\/dist\/core\/extensions\/builtin\/([\w-]+)\.js";\s*$/;
const EXTENSION_FILE = /\.(?:[cm]?js|ts)$/i;
const EXTENSION_DIR_MARKERS = ["index.ts", "index.js", "index.mjs", "package.json"];

function pathKey(entry) {
  return path.resolve(entry).replace(/\\/g, "/").toLowerCase();
}

/**
 * Active custom entries of an agent dir: files and extension directories under
 * agent/extensions plus the settings.json `packages` and `extensions` paths. Each must be
 * claimed by some row's `discover` list. Host-generated shims that only re-export a senpi
 * builtin are recognised by their exact content; directories without an entry file are inert.
 */
export function discoverActive(agentDir, rows) {
  const owners = new Map();
  for (const row of rows) for (const entry of row.discover || []) owners.set(pathKey(entry), row.name);
  const result = { entries: [], unledgered: [], missing: [], hostShims: [], inert: [], errors: [] };
  const claim = (source, entry) => {
    const owner = owners.get(pathKey(entry)) || null;
    result.entries.push({ source, path: entry, owner });
    if (!owner) result.unledgered.push(entry);
  };

  const extensionsDir = path.join(agentDir, "extensions");
  let names = [];
  try {
    names = fs.readdirSync(extensionsDir).sort();
  } catch (error) {
    if (error.code !== "ENOENT") result.errors.push(`extensions dir unreadable (${error.code})`);
  }
  for (const name of names) {
    const entry = path.join(extensionsDir, name);
    try {
      if (fs.statSync(entry).isDirectory()) {
        if (EXTENSION_DIR_MARKERS.some((marker) => fs.existsSync(path.join(entry, marker)))) claim("extensions", entry);
        else result.inert.push(entry);
        continue;
      }
      if (!EXTENSION_FILE.test(name)) continue;
      const shim = HOST_SHIM.exec(fs.readFileSync(entry, "utf8"));
      if (shim && `${shim[1]}${path.extname(name)}` === name) result.hostShims.push(entry);
      else claim("extensions", entry);
    } catch (error) {
      result.errors.push(`${entry} unreadable (${error.code || error.message})`);
    }
  }

  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"));
  } catch (error) {
    result.errors.push(`settings.json unreadable (${error.code || "invalid JSON"})`);
  }
  for (const key of ["packages", "extensions"]) {
    const list = settings?.[key] ?? [];
    if (!Array.isArray(list)) {
      result.errors.push(`settings.${key} is not a list`);
      continue;
    }
    for (const item of list) {
      if (typeof item !== "string") {
        result.errors.push(`settings.${key} has an entry that is not a path`);
        continue;
      }
      if (/^(?:npm|git|https?):/i.test(item)) {
        claim(`settings.${key}`, item);
        continue;
      }
      const entry = path.resolve(agentDir, item);
      if (!fs.existsSync(entry)) result.missing.push(entry);
      claim(`settings.${key}`, entry);
    }
  }
  return result;
}

/** The --strict verdict. Failures win; anything unverified keeps the run from passing. */
export function strictVerdict({ results = [], ledger = null, discovery = null, partial = false } = {}) {
  const failures = [];
  const unverified = [];
  const warnings = [];
  const dirty = new Set();
  for (const row of results) {
    if (row.sourceCheck !== "ok") failures.push(`${row.name}: source ${row.sourceCheck}`);
    for (const item of row.installed || []) {
      if (item.status !== "ok") failures.push(`${row.name}: ${item.status} ${item.label}`);
    }
    if (row.repo?.error) failures.push(`${row.name}: repository state unreadable`);
    if (row.state === "local-commit") unverified.push(`${row.name}: source not on its remote (local-commit)`);
    for (const reason of row.unverified || []) unverified.push(`${row.name}: ${reason}`);
    for (const step of row.manual || []) unverified.push(`${row.name}: manual check - ${step}`);
    if (row.repo?.dirty && !dirty.has(row.repo.path)) {
      dirty.add(row.repo.path);
      warnings.push(`${row.repo.name}: worktree has uncommitted changes (rows compare HEAD blobs)`);
    }
  }
  const skipped = partial ? " (--only run)" : "";
  if (!ledger) unverified.push(`ledger: not compared${skipped}`);
  else if (ledger.error) failures.push(`ledger: ${ledger.error}`);
  else {
    for (const id of ledger.duplicates) failures.push(`ledger: duplicate row '${id}'`);
    for (const id of ledger.missingFromChecker) failures.push(`ledger: '${id}' has no checker row`);
    for (const id of ledger.missingFromLedger) failures.push(`ledger: checker row '${id}' is not in PATCHES.md`);
    for (const m of ledger.stateMismatch) {
      failures.push(`ledger: '${m.id}' is ${m.ledger} in PATCHES.md but ${m.checker} in the checker`);
    }
  }
  if (!discovery) unverified.push(`discovery: not run${skipped}`);
  else {
    for (const entry of discovery.unledgered) failures.push(`discovery: active entry not in the ledger: ${entry}`);
    for (const entry of discovery.missing) failures.push(`discovery: settings entry does not exist: ${entry}`);
    for (const error of discovery.errors) failures.push(`discovery: ${error}`);
  }
  const verdict = failures.length ? "fail" : unverified.length ? "incomplete" : "pass";
  return { verdict, exitCode: { pass: 0, fail: 1, incomplete: 3 }[verdict], failures, unverified, warnings };
}

// ---------------------------------------------------------------------------
// Read-only git helpers

const repoCache = new Map();

function git(args, opts = {}) {
  return execFileSync("git", ["-C", opts.cwd, ...args], {
    encoding: opts.encoding === null ? null : opts.encoding || "utf8",
    timeout: opts.timeout ?? 30000,
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readRepoState(repoPath) {
  if (repoCache.has(repoPath)) return repoCache.get(repoPath);
  const state = {
    name: path.basename(repoPath).replace(/-source$/, ""),
    path: repoPath,
    head: null,
    remote: null,
    upstream: null,
    ahead: null,
    behind: null,
    dirty: null,
    exists: fs.existsSync(path.join(repoPath, ".git")) || fs.existsSync(path.join(repoPath, ".git", "HEAD")),
    error: null,
  };
  try {
    state.head = git(["rev-parse", "HEAD"], { cwd: repoPath }).trim();
    state.remote = git(["remote", "get-url", "origin"], { cwd: repoPath }).trim();
    state.branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoPath }).trim();
    try {
      state.upstream = git(["rev-parse", "--abbrev-ref", "@{upstream}"], { cwd: repoPath }).trim();
    } catch {
      state.upstream = null;
    }
    if (!state.upstream && state.branch && state.branch !== "HEAD") {
      // A detached branch config is common in these checkouts; the plan's command is
      // origin/<branch>...HEAD, so use origin/<branch> when it exists.
      const fallback = `origin/${state.branch}`;
      try {
        git(["rev-parse", "--verify", fallback], { cwd: repoPath });
        state.upstream = fallback;
        state.upstreamFallback = true;
      } catch {
        state.upstream = null;
      }
    }
    state.dirty = git(["status", "--porcelain"], { cwd: repoPath }).trim().length > 0;
    if (state.upstream) {
      const counts = parseRevCount(
        git(["rev-list", "--left-right", "--count", `${state.upstream}...HEAD`], { cwd: repoPath }),
      );
      if (counts) {
        state.behind = counts.behind;
        state.ahead = counts.ahead;
      }
    }
  } catch (error) {
    state.error = error.message;
  }
  repoCache.set(repoPath, state);
  return state;
}

function checkBlob(repoPath, relPath, expected) {
  try {
    const buf = git(["show", `HEAD:${relPath}`], { cwd: repoPath, encoding: null });
    const actual = sha256Buffer(buf);
    const accepted = Array.isArray(expected) ? expected : [expected];
    return { status: accepted.includes(actual) ? "ok" : "drift", actual, expected: accepted.join("|"), label: relPath };
  } catch (error) {
    return { status: "missing", actual: null, expected, label: relPath, error: error.message };
  }
}

export function checkInstalled(file, expected) {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  try {
    const actual = sha256File(file);
    let matched = expectedList.find((value) => value === actual) || null;
    let normalizedBy;
    // Compare the full original bytes after undoing this exact managed delta.
    // Any unrelated change still fails the existing baseline hash check.
    if (!matched && path.basename(file) === "omo-task.js") {
      const text = fs.readFileSync(file, "utf8");
      if (classifyPlanReviewText(text) === "patched") {
        const baseHash = sha256Buffer(Buffer.from(transformPlanReviewText(text, "remove")));
        matched = expectedList.find((value) => value === baseHash) || null;
        if (matched) normalizedBy = "plan-review-unlock";
      }
    }
    return {
      status: matched ? "ok" : "drift",
      actual,
      expected: expectedList.join("|"),
      matched,
      label: file,
      ...(normalizedBy ? { normalizedBy } : {}),
    };
  } catch {
    return { status: "missing", actual: null, expected: expectedList.join("|"), matched: null, label: file };
  }
}

function checkWorktree(file, expected) {
  return checkInstalled(file, expected);
}

// Owner configuration: presence and, for .json, parseability. Contents and hashes are never
// reported; legitimate edits are expected between checks.
function checkConfigFile(file) {
  const item = { label: file, expected: "present", actual: "present", status: "ok" };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { ...item, status: "missing", actual: null };
  }
  if (!text.trim()) return { ...item, status: "drift", actual: "empty" };
  if (file.endsWith(".json")) {
    try {
      JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      return { ...item, status: "drift", actual: "not valid JSON" };
    }
  }
  return item;
}

function readVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function checkPins(pins, opts) {
  const item = { label: "pin-consistency", expected: "launcher pins = installed omo-ai, senpi and overlay versions" };
  const values = [];
  for (const pin of pins) {
    let text;
    try {
      text = fs.readFileSync(pin.file, "utf8");
    } catch {
      return { ...item, status: "missing", actual: `${pin.label} unreadable` };
    }
    if (pin.json) {
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        // reported below as a missing pin
      }
      values.push({ label: pin.label, omo: data.omo ?? null, senpi: data.senpi ?? null });
    } else {
      values.push({ label: pin.label, omo: pin.omo.exec(text)?.[1] ?? null, senpi: pin.senpi.exec(text)?.[1] ?? null });
    }
  }
  const installed = { omo: readVersion(GLOBAL_OMO), senpi: readVersion(opts.senpiRoot), overlay: readVersion(OVERLAY) };
  return { ...item, ...pinConsistency(values, installed) };
}

// A generation-installed product: the shim points into <product>/integration/generation-N,
// current.json names the same generation, its recorded per-file hashes match, and the
// installed entry's bytes (raw, or CRLF normalised to LF) exist in the source remote's history.
function checkIntegration(row, opts, out) {
  const { shim, product, current } = row.integration;
  const extensionsDir = path.join(opts.agentDir, "extensions");
  const shimPath = path.join(extensionsDir, shim);
  const integrationRoot = path.join(opts.agentDir, product, "integration");
  let target = null;
  try {
    const m = /export \{ default \} from ['"](\.\.\/[^'"]+)['"]/.exec(fs.readFileSync(shimPath, "utf8"));
    if (m) target = path.resolve(extensionsDir, m[1]);
  } catch {
    out.installed.push({ status: "missing", label: shimPath, actual: null, expected: "managed shim" });
    return;
  }
  const parts = target ? path.relative(integrationRoot, target).split(path.sep) : [];
  const generation = /^generation-\d{6}$/.test(parts[0] || "") ? parts[0] : null;
  out.installed.push({
    status: generation ? "ok" : "drift",
    label: shimPath,
    actual: target,
    expected: `${integrationRoot}/generation-NNNNNN/...`,
  });
  if (!generation) return;
  out.extras.push(`generation=${generation}`);
  const genDir = path.join(integrationRoot, generation);
  const entry = parts.slice(1).join("/");

  const recordPath = path.join(opts.agentDir, current);
  let record = null;
  try {
    record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  } catch {
    // reported as missing below
  }
  out.installed.push({
    status: !record ? "missing" : record.generation === generation ? "ok" : "drift",
    label: recordPath,
    actual: record?.generation ?? null,
    expected: generation,
  });
  out.installed.push({
    status: fs.existsSync(target) ? "ok" : "missing",
    label: target,
    actual: null,
    expected: "entry file",
  });

  const hashes = record?.generation === generation && record.sha256 && typeof record.sha256 === "object"
    ? Object.entries(record.sha256)
    : [];
  if (hashes.length) {
    const bad = hashes.filter(([file, expected]) => {
      try {
        return sha256File(path.join(genDir, file.replace(/\\/g, "/"))) !== expected;
      } catch {
        return true;
      }
    });
    out.installed.push({
      status: bad.length ? "drift" : "ok",
      label: `${genDir} recorded hashes`,
      actual: bad.length
        ? `${bad.length}/${hashes.length} differ or missing: ${bad.slice(0, 3).map(([file]) => file).join(", ")}`
        : `${hashes.length}/${hashes.length} match`,
      expected: `${hashes.length} recorded hashes`,
    });
  } else {
    out.unverified.push(`${generation} has no recorded file hashes; only the entry file's presence was checked`);
  }

  const upstream = out.repo?.upstream;
  if (!upstream || !fs.existsSync(target)) {
    out.unverified.push("installed entry not traced to a source commit (no upstream or no entry)");
    return;
  }
  const raw = fs.readFileSync(target);
  const lf = Buffer.from(raw.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  for (const [form, bytes] of [["", raw], ["(lf)", lf]]) {
    if (form && bytes.equals(raw)) continue;
    let commit = "";
    try {
      commit = git(["log", "-1", "--format=%H", `--find-object=${gitBlobId(bytes)}`, upstream], { cwd: row.repoPath }).trim();
    } catch {
      // treated as not found
    }
    if (commit) {
      out.extras.push(`entry-source=${upstream}@${commit.slice(0, 7)}${form}`);
      return;
    }
  }
  out.unverified.push(`installed entry ${entry} not found in ${upstream} history (unpushed or built differently)`);
}

/** Repository paths whose uncommitted changes mean the row's next source is not preserved yet. */
function rowSourcePaths(row) {
  if (row.sourcePaths) return row.sourcePaths;
  if (row.repoPath === ORCH && row.location.startsWith("custom-layer/")) return [row.location];
  return [...new Set([
    ...(row.sourceBlobs || []).map((blob) => blob.path),
    ...(row.trackedFiles || []),
    ...(row.sourceText || []).map((text) => text.path),
  ])];
}

function readLedger(rows) {
  let text;
  try {
    text = fs.readFileSync(LEDGER, "utf8");
  } catch (error) {
    return { path: LEDGER, error: `PATCHES.md unreadable (${error.code || error.message})` };
  }
  const parsed = parseLedger(text);
  if (!parsed.length) return { path: LEDGER, error: "no ledger table in PATCHES.md" };
  return { path: LEDGER, ...compareLedger(parsed, rows) };
}

function runJsonLine(command, args, prefix, timeout = 60000) {
  try {
    const out = execFileSync(command, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith(`${prefix} `));
    if (!line) return { error: `no ${prefix} line` };
    return JSON.parse(line.slice(prefix.length + 1));
  } catch (error) {
    return { error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Rows. `location` is the source location printed on the check line; PATCHES.md
// carries the full remote/commit/apply details.

export function makeRows() {
  return [
    {
      name: "plan-review-unlock",
      hint: "tracked",
      location: "custom-layer/plan-review-unlock",
      repoPath: ORCH,
      sourceFiles: [
        `${HERE}/plan-review-unlock/patch.mjs`,
        `${HERE}/plan-review-unlock/probe.mjs`,
        `${HERE}/plan-review-unlock/test/patch.test.mjs`,
      ],
      omoPatch: true,
      installed: [],
    },
    {
      name: "memory-overlay",
      hint: "tracked",
      location: "custom-layer/memory-overlay",
      repoPath: ORCH,
      captured: [
        "omo.js",
        "omo-memory-doctor.diff",
        "omo-memory-memfs.diff",
        "PROVENANCE.md",
        "build/src/stage.mjs",
        "build/src/bundle-patch.mjs",
        "build/src/gate.mjs",
        "build/test-captured/native-scenarios.mjs",
        "build/test-captured/memory-fixture.mjs",
      ],
      capturedExpected: {
        "omo.js": "de8408a08dc84a389316af6f6fc407fa260d129b04748e354e291b104cee8c6c",
        "build/src/gate.mjs": "19f1fb535faac06d2b971e8c06713c9ae24e0ad5a4dadd13a504119d0e456fda",
      },
      installed: [
        { path: `${OVERLAY}/plugin/extensions/omo.js`, expected: "de8408a08dc84a389316af6f6fc407fa260d129b04748e354e291b104cee8c6c" },
        { path: `${OVERLAY}/plugin/extensions/omo-memory-doctor.js`, expected: "900cb31eaf81e6b75e188820a0738f4c8943338d5d1cc45841637151b6a3e813" },
        { path: `${OVERLAY}/plugin/extensions/omo-memory-memfs.js`, expected: "7f832ed672cad107d7a54c3f6c90edd7275da2af1bf7305b2cefead56a6e3bdc" },
      ],
    },
    {
      name: "coordination-adapters",
      hint: "tracked",
      location: "dist/extension.js+scripts/build-adapter.mjs",
      repoPath: COORD,
      discover: [`${AGENT}/packages/piomo-agent-coordination-mod`],
      sourcePaths: ["dist", "scripts", "src", "test"],
      worktreeChecks: [
        { path: `${COORD}/dist/extension.js`, expected: "6035ef1aef60e706bf8fa52a7f6b7946a6c0616d6030f38740bdec31d13bb68e" },
      ],
      sourceText: [
        { path: "scripts/build-adapter.mjs", contains: "d41bc807b6f91768db84b7f8f76092107aebf9934888cc749174d88a1c00ac6b" },
      ],
      installed: [
        { path: `${AGENT}/packages/piomo-agent-coordination-mod/dist/extension.js`, expected: "6035ef1aef60e706bf8fa52a7f6b7946a6c0616d6030f38740bdec31d13bb68e" },
        { path: `${OVERLAY}/plugin/extensions/omo-task.js`, expected: "c2269e2887348e6b40cfdf6be5fd14d594f09342a5fa827e839c647ab475e69c" },
        { path: `${GLOBAL_OMO}/plugin/extensions/omo-task.js`, expected: "c2269e2887348e6b40cfdf6be5fd14d594f09342a5fa827e839c647ab475e69c" },
      ],
      extras: ["adapter=generated(c2269e28, omo 5.1.40)"],
    },
    {
      name: "task-record-publish-retry",
      hint: "tracked",
      location: "custom-layer/task-record-publish-retry/extension.mjs",
      repoPath: ORCH,
      discover: [`${AGENT}/extensions/omo-task-record-publish-retry.js`],
      sourceBlobs: [
        {
          path: "custom-layer/task-record-publish-retry/extension.mjs",
          expected: [
            "6264d44e49cae147569237ba5e200a8f41c7ab517cda03b64f8f7839e72cd2c7",
            "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5",
            "e7e232d846224ec27703f0b013e4ff7d59076c4ae1d307efa178148acb9631a9",
            "89a2218f03f0cc16389af5d54112f73428edd98f34083f75b0ec7b28eecdb08d",
          ],
        },
      ],
      worktreeChecks: [
        { path: `${ORCH}/custom-layer/task-record-publish-retry/extension.mjs`, expected: "89a2218f03f0cc16389af5d54112f73428edd98f34083f75b0ec7b28eecdb08d" },
      ],
      installed: [
        {
          path: `${AGENT}/task-record-publish-retry/extension.mjs`,
          expected: [
            "6264d44e49cae147569237ba5e200a8f41c7ab517cda03b64f8f7839e72cd2c7",
            "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5",
            "e7e232d846224ec27703f0b013e4ff7d59076c4ae1d307efa178148acb9631a9",
            "89a2218f03f0cc16389af5d54112f73428edd98f34083f75b0ec7b28eecdb08d",
          ],
        },
      ],
      extras: ["accepted=old-HEAD|D9-no-breaker|D9-breaker-global|D9-breaker-per-record"],
    },
    {
      name: "settings-guard",
      hint: "tracked",
      location: "custom-layer/settings-guard/extension.mjs",
      repoPath: ORCH,
      discover: [`${AGENT}/extensions/omo-settings-guard.js`],
      sourceBlobs: [
        { path: "custom-layer/settings-guard/extension.mjs", expected: "1f9e27da404a9cc781b0666eeeae241cacd6af1664e53b5eb1fb6660e4f1d5c1" },
      ],
      installed: [
        { path: `${AGENT}/settings-guard/extension.mjs`, expected: "1f9e27da404a9cc781b0666eeeae241cacd6af1664e53b5eb1fb6660e4f1d5c1" },
      ],
    },
    {
      name: "task-no-fallback-pkg",
      hint: "tracked",
      location: "custom-layer/task-no-fallback-pkg",
      repoPath: ORCH,
      discover: [`${AGENT}/task-no-fallback-pkg`],
      sourceBlobs: [
        { path: "custom-layer/task-no-fallback-pkg/omo-task-no-fallback.js", expected: "38c425f04338441641980f6e8d3fa1993728072a2cf8cc1b6700f91e935de505" },
        { path: "custom-layer/task-no-fallback-pkg/package.json", expected: "1a14d2903c4174e5ca54becded10e7d99d74e97163e2c84e25d53cf191f39119" },
      ],
      installed: [
        { path: `${AGENT}/task-no-fallback-pkg/omo-task-no-fallback.js`, expected: "38c425f04338441641980f6e8d3fa1993728072a2cf8cc1b6700f91e935de505" },
        { path: `${AGENT}/task-no-fallback-pkg/package.json`, expected: "1a14d2903c4174e5ca54becded10e7d99d74e97163e2c84e25d53cf191f39119" },
      ],
    },
    {
      name: "herdr-agent-sidebar-repair",
      hint: "tracked",
      location: "custom-layer/herdr-agent-sidebar-repair/herdr-senpi.mjs",
      repoPath: ORCH,
      discover: ["C:/Users/USER/orca/projects/herdr-agent-sidebar-diagnosis/repair/herdr-senpi.mjs"],
      sourceBlobs: [
        { path: "custom-layer/herdr-agent-sidebar-repair/herdr-senpi.mjs", expected: "7eeb9a5fd9b3b169ef4de375b1d5443445f4666205445989afc62d760a27fdcd" },
      ],
      installed: [
        { path: "C:/Users/USER/orca/projects/herdr-agent-sidebar-diagnosis/repair/herdr-senpi.mjs", expected: "7eeb9a5fd9b3b169ef4de375b1d5443445f4666205445989afc62d760a27fdcd" },
      ],
    },
    {
      name: "omo-compaction-model",
      hint: "tracked",
      location: "src/omo-compaction-model.ts",
      repoPath: COMPACTION,
      discover: [`${AGENT}/extensions/omo-compaction-model.ts`],
      sourceBlobs: [
        { path: "src/omo-compaction-model.ts", expected: "f5bbe48a2b30afc3f3303365ad4b98717f344343c8e540ff8080826ead48fb48" },
      ],
      installed: [
        { path: `${AGENT}/extensions/omo-compaction-model.ts`, expected: "f5bbe48a2b30afc3f3303365ad4b98717f344343c8e540ff8080826ead48fb48" },
      ],
    },
    {
      name: "early-compaction",
      hint: "tracked",
      location: "src/extension.ts+bun-run-build",
      repoPath: EARLY,
      discover: [`${AGENT}/extensions/early-compaction.js`],
      trackedFiles: ["src/extension.ts", "scripts/mod.mjs"],
      sourceText: [
        { path: "package.json", contains: "bun build src/extension.ts --outfile dist/early-compaction.js" },
      ],
      installed: [
        { path: `${AGENT}/extensions/early-compaction.js`, expected: "c0416e2a5896961d1ee97925a74e788fbeba13a4deb0b69dc2312279706f740a" },
      ],
      extras: ["build=bun-run-build(dist gitignored)"],
      qualified: `${AGENT}/early-compaction/qualified.json`,
    },
    {
      name: "senpi-freeze-fix",
      hint: "tracked",
      location: "custom-layer/senpi-freeze-fix",
      repoPath: ORCH,
      sourceFiles: [
        `${HERE}/senpi-freeze-fix/patch.mjs`,
        `${HERE}/senpi-freeze-fix/probe.mjs`,
        `${HERE}/senpi-freeze-fix/baselines.json`,
        `${HERE}/senpi-freeze-fix/unc-timeout-predicate.mjs`,
      ],
      senpiPatch: { dir: "senpi-freeze-fix", backupSuffix: ".freeze-fix.bak", files: FREEZE_FILES },
      installed: [],
    },
    {
      name: "senpi-stream-hash-leak",
      hint: "tracked",
      location: "custom-layer/senpi-stream-hash-leak",
      repoPath: ORCH,
      sourceFiles: [
        `${HERE}/senpi-stream-hash-leak/patch.mjs`,
        `${HERE}/senpi-stream-hash-leak/probe.mjs`,
      ],
      senpiPatch: { dir: "senpi-stream-hash-leak", backupSuffix: ".leak-fix.bak", files: LEAK_FILES },
      installed: [],
    },
    // Rows below are not package patches. They are the other active custom items an update
    // must keep: generation-installed products, a third-party copy, owner configuration,
    // the launcher and the skill's script. `manual` lists what no automated check covers.
    {
      name: "omo-briefing",
      kind: "integration",
      hint: "tracked",
      location: "piomo-briefing (generation install)",
      repoPath: BRIEFING,
      sourcePaths: ["."],
      integration: { shim: "omo-briefing.js", product: "briefing", current: "briefing/current.json" },
      discover: [`${AGENT}/extensions/omo-briefing.js`],
      manual: ["a new process registers the brief tools; the board page renders and a board answer reaches the session"],
      installed: [],
    },
    {
      name: "omo-herdr-dashboard",
      kind: "integration",
      hint: "tracked",
      location: "omo-herdr-dashboard (generation install)",
      repoPath: DASHBOARD,
      sourcePaths: ["."],
      integration: {
        shim: "omo-herdr-dashboard.js",
        product: "herdr-dashboard",
        current: "herdr-dashboard/integration/current.json",
      },
      discover: [`${AGENT}/extensions/omo-herdr-dashboard.js`],
      manual: ["a new process loads the dashboard; todo/worker/DAG state shows in an owned test pane"],
      installed: [],
    },
    {
      name: "omo-oracle-advisor",
      kind: "integration",
      hint: "tracked",
      location: "oracle-advisor-mod (generation install)",
      repoPath: ORACLE,
      sourcePaths: ["."],
      integration: { shim: "omo-oracle-advisor.js", product: "oracle-advisor", current: "oracle-advisor/current.json" },
      discover: [`${AGENT}/extensions/omo-oracle-advisor.js`],
      manual: ["a new process registers the four oracle tools without a load error"],
      installed: [],
    },
    {
      name: "cli-anything",
      kind: "external",
      hint: "external",
      location: "agent/extensions/cli-anything (third-party copy)",
      tree: { path: `${AGENT}/extensions/cli-anything`, expected: "842736d063d6a1f678fb0e78895120add5f8c3a01e943b4ae6f97db6542bffb4" },
      discover: [`${AGENT}/extensions/cli-anything`],
      unverified: ["origin not recorded (upstream repository, version and licence of this copy are unknown)"],
      manual: ["a new process registers the /cli-anything commands (index.ts imports @mariozechner/pi-coding-agent types)"],
      installed: [],
    },
    {
      name: "user-config-selection",
      kind: "private",
      hint: "private",
      location: "owner configuration (kept in place, never copied)",
      configFiles: [
        `${HOME_OMO}/omo.jsonc`,
        `${HOME_OMO}/config.jsonc`,
        `${HOME_OMO}/native-profile-selection.json`,
        `${HOME_OMO}/memory-model-selection.json`,
        `${AGENT}/settings.json`,
        `${AGENT}/models.json`,
        `${AGENT}/models.yml`,
        `${AGENT}/models-store.json`,
        `${AGENT}/native-profile-selection.json`,
        `${AGENT}/mcp.json`,
        `${AGENT}/trust.json`,
      ],
      manual: [
        "compare model, provider, thinking, profile and role selections with the pre-update inventory by safe per-field identities",
      ],
      installed: [],
    },
    {
      name: "stable-500-launcher",
      kind: "launcher",
      hint: "tracked",
      location: "custom-layer/stable-500-launcher",
      repoPath: ORCH,
      captured: ["omo.cmd", "omo-memory-selector-entry-r22.mjs", "manifest.json", "README.md"],
      capturedExpected: {
        "omo.cmd": "cb11f16fb763c6e5b66b774dec00451dca0cac4454b2649a1b5339db5fc65fca",
        "omo-memory-selector-entry-r22.mjs": "7a474fe99574caa78d53c025d59c55b4f1814940f4a4e045153580656a745849",
        "manifest.json": "7a67e6b96c257ea4aad2487a9ddcd25e53b908ba147ab9f6164d5975d346f096",
      },
      installed: [
        { path: `${LANE}/omo.cmd`, expected: "cb11f16fb763c6e5b66b774dec00451dca0cac4454b2649a1b5339db5fc65fca" },
        { path: `${LANE}/staging/omo-memory-selector-entry-r22.mjs`, expected: "7a474fe99574caa78d53c025d59c55b4f1814940f4a4e045153580656a745849" },
        { path: `${LANE}/staging/memory-rollback-5.1.40-r1/gate.mjs`, expected: "19f1fb535faac06d2b971e8c06713c9ae24e0ad5a4dadd13a504119d0e456fda" },
        { path: `${LANE}/staging/memory-rollback-5.1.40-r1/manifest.json`, expected: "7a67e6b96c257ea4aad2487a9ddcd25e53b908ba147ab9f6164d5975d346f096" },
      ],
      pins: [
        { label: "omo.cmd", file: `${LANE}/omo.cmd`, omo: /^set "OMO_STABLE_PINNED_OMO=([^"]+)"/m, senpi: /^set "OMO_STABLE_PINNED_SENPI=([^"]+)"/m },
        { label: "reentry", file: `${LANE}/staging/omo-memory-selector-entry-r22.mjs`, omo: /^const PINNED_OMO = "([^"]+)"/m, senpi: /^const PINNED_SENPI = "([^"]+)"/m },
        { label: "manifest", file: `${LANE}/staging/memory-rollback-5.1.40-r1/manifest.json`, json: true },
      ],
      manual: ["after an approved update, launch probes through omo.cmd and the reentry select the intended home and plugin"],
    },
    {
      name: "pr-watch-script",
      kind: "tool",
      hint: "tracked",
      location: "scripts/pr-watch.mjs",
      repoPath: ORCH,
      sourceBlobs: [{ path: "scripts/pr-watch.mjs", expected: "a0e54106076801cf01cb097c63ac4a03a7de72b236d6acbf25de699bbeb271ef" }],
      installed: [{ path: PR_WATCH, expected: "873db7565bec4f4e3cefe20f45609ab10aee20afcb45da397c50545fffd6e4bd" }],
      manual: [
        "the published copy is a sanitized port (machine paths replaced); its behaviour has not been compared with the copy the omo-check skill runs",
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Row evaluation

function evaluateRow(row, opts) {
  const out = {
    name: row.name,
    kind: row.kind || "patch",
    location: row.location,
    state: classifyState({ hint: row.hint }),
    repo: null,
    installed: [],
    extras: row.kind ? [`kind=${row.kind}`] : [],
    sourceCheck: "ok",
    unverified: [...(row.unverified || [])],
    manual: [...(row.manual || [])],
  };

  if (row.repoPath) {
    const rs = readRepoState(row.repoPath);
    out.repo = rs;
    out.state = classifyState({
      hint: row.hint,
      upstream: rs.upstream,
      ahead: rs.ahead,
    });
  }

  const sourceStatuses = [];

  for (const blob of row.sourceBlobs || []) {
    const result = checkBlob(row.repoPath, blob.path, blob.expected);
    sourceStatuses.push(result.status);
    if (opts.verbose) {
      out.extras.push(`blob:${blob.path}=${result.status}`);
    }
  }

  for (const relPath of row.trackedFiles || []) {
    try {
      git(["cat-file", "-e", `HEAD:${relPath}`], { cwd: row.repoPath });
      sourceStatuses.push("ok");
      if (opts.verbose) out.extras.push(`tracked:${relPath}=ok`);
    } catch {
      sourceStatuses.push("missing");
      if (opts.verbose) out.extras.push(`tracked:${relPath}=missing`);
    }
  }

  for (const text of row.sourceText || []) {
    try {
      const content = fs.readFileSync(`${row.repoPath}/${text.path}`, "utf8");
      const ok = content.includes(text.contains);
      sourceStatuses.push(ok ? "ok" : "drift");
      if (opts.verbose) out.extras.push(`text:${text.path}=${ok ? "ok" : "drift"}`);
    } catch {
      sourceStatuses.push("missing");
      if (opts.verbose) out.extras.push(`text:${text.path}=missing`);
    }
  }

  for (const check of row.worktreeChecks || []) {
    const result = checkWorktree(check.path, check.expected);
    sourceStatuses.push(result.status);
    if (opts.verbose) out.extras.push(`worktree:${path.basename(check.path)}=${result.status}`);
  }

  for (const file of row.captured || []) {
    const filePath = `${HERE}/${path.basename(row.location)}/${file}`;
    try {
      const stat = fs.statSync(filePath);
      const expected = row.capturedExpected?.[file];
      if (expected && sha256File(filePath) !== expected) {
        sourceStatuses.push("drift");
        if (opts.verbose) out.extras.push(`captured:${file}=drift`);
      } else if (stat.size === 0) {
        sourceStatuses.push("missing");
        if (opts.verbose) out.extras.push(`captured:${file}=empty`);
      } else {
        sourceStatuses.push("ok");
        if (opts.verbose) out.extras.push(`captured:${file}=ok`);
      }
    } catch {
      sourceStatuses.push("missing");
      if (opts.verbose) out.extras.push(`captured:${file}=missing`);
    }
  }

  for (const file of row.sourceFiles || []) {
    const ok = fs.existsSync(file);
    sourceStatuses.push(ok ? "ok" : "missing");
    if (opts.verbose) out.extras.push(`source:${path.basename(file)}=${ok ? "ok" : "missing"}`);
  }

  // Rows compare HEAD blobs; uncommitted edits under the row's source mean the next
  // version of the source is not preserved yet.
  if (row.repoPath && out.repo && !out.repo.error) {
    const paths = rowSourcePaths(row);
    if (paths.length) {
      try {
        const changed = git(["status", "--porcelain", "--untracked-files=all", "--", ...paths], { cwd: row.repoPath })
          .split(/\r?\n/)
          .filter(Boolean);
        if (changed.length) {
          out.extras.push(`worktree=modified(${changed.length})`);
          out.unverified.push(`${changed.length} uncommitted source change(s) under ${paths.join(", ")}`);
        }
      } catch {
        sourceStatuses.push("error");
      }
    }
  }

  out.sourceCheck = sourceStatuses.length ? aggregate(sourceStatuses) : "ok";

  for (const file of row.installed || []) {
    out.installed.push(checkInstalled(file.path, file.expected));
  }

  if (row.integration) checkIntegration(row, opts, out);

  if (row.tree) {
    let actual = null;
    try {
      actual = treeHash(row.tree.path);
    } catch {
      // reported as missing
    }
    out.installed.push({
      status: !actual ? "missing" : actual.hash === row.tree.expected ? "ok" : "drift",
      label: `${row.tree.path} (tree)`,
      actual: actual ? `${actual.hash} (${actual.files} files)` : null,
      expected: row.tree.expected,
    });
  }

  for (const file of row.configFiles || []) out.installed.push(checkConfigFile(file));

  if (row.pins) {
    const pins = checkPins(row.pins, opts);
    out.installed.push(pins);
    out.extras.push(`pins=${pins.status === "ok" ? pins.actual.replace(/ /g, ",") : "mismatch"}`);
  }

  if (out.manual.length) out.extras.push(`manual=${out.manual.length}`);

  if (row.omoPatch) {
    for (const [tag, root] of [["overlay", OVERLAY], ["global", GLOBAL_OMO]]) {
      const patch = runJsonLine(process.execPath,
        [`${HERE}/plan-review-unlock/patch.mjs`, "--omo-root", root, "--check"], "CHECK");
      const probe = runJsonLine(process.execPath,
        [`${HERE}/plan-review-unlock/probe.mjs`, "--omo-root", root], "PROBE");
      const patched = patch.supported === true &&
        Object.values(patch.files || {}).length === 1 &&
        Object.values(patch.files).every((file) => file.state === "patched");
      const fixed = probe.verdict === "defect-absent";
      out.extras.push(`plan-gate[${tag}]=${probe.error || probe.verdict || "unknown"}`);
      out.installed.push({
        status: patched && fixed ? "ok" : "drift",
        label: `plan-review-unlock:${tag}`,
        actual: patch.error || JSON.stringify(patch.files || {}),
        expected: "patched; explicit review after execution allowed",
      });
    }
  }

  // A mod that gates itself on qualified senpi versions is dormant on an unlisted version.
  if (row.qualified) {
    const installedSenpi = readVersion(SENPI);
    let versions = [];
    try {
      versions = Object.keys(JSON.parse(fs.readFileSync(row.qualified, "utf8")).versions ?? {});
    } catch {
      // reported below as not qualified
    }
    out.extras.push(`qualified=${versions.join(",") || "none"}`);
    if (!installedSenpi || !versions.includes(installedSenpi)) {
      out.unverified.push(`qualified.json does not list the installed senpi ${installedSenpi ?? "(unreadable)"}; the mod is dormant until requalified`);
    }
  }

  if (row.name === "task-record-publish-retry" && out.installed[0]) {
    const actual = out.installed[0].actual;
    out.extras.push(
      actual === "89a2218f03f0cc16389af5d54112f73428edd98f34083f75b0ec7b28eecdb08d"
        ? "installed-version=D9-breaker-per-record"
        : actual === "e7e232d846224ec27703f0b013e4ff7d59076c4ae1d307efa178148acb9631a9"
        ? "installed-version=D9-breaker-global"
        : actual === "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5"
        ? "installed-version=D9-no-breaker"
        : actual === "6264d44e49cae147569237ba5e200a8f41c7ab517cda03b64f8f7839e72cd2c7"
          ? "installed-version=old-HEAD"
          : "installed-version=other",
    );
  }

  if (row.senpiPatch) {
    const { dir, backupSuffix, files } = row.senpiPatch;
    const patchScript = `${HERE}/${dir}/patch.mjs`;
    const probeScript = `${HERE}/${dir}/probe.mjs`;
    const roots = [
      { tag: "install", root: opts.senpiRoot, live: false },
      ...runtimeRoots(opts.agentDir).map((root) => ({ tag: `runtime:${path.basename(root).slice(0, 8)}`, root, live: true })),
    ];
    for (const { tag, root, live } of roots) {
      const check = runJsonLine(process.execPath, [patchScript, "--senpi-root", root, "--check"], "CHECK");
      const summary = check.error ? `error(${check.error})` : check.files ? summarizePatchCheck(check) : "unknown";
      out.extras.push(`patch-check[${tag}]=${summary}`);

      const probe = runJsonLine(process.execPath, [probeScript, "--senpi-root", root], "PROBE");
      out.extras.push(`probe[${tag}]=${probe.error ? `error(${probe.error})` : probe.verdict}`);

      if (files.some((rel) => fs.existsSync(`${root}/${rel}${backupSuffix}`))) {
        const fromBackups = runJsonLine(process.execPath, [probeScript, "--senpi-root", root, "--from-backups"], "PROBE");
        out.extras.push(`probe-backups[${tag}]=${fromBackups.error ? `error(${fromBackups.error})` : fromBackups.verdict}`);
      }

      // The install only has to be recognized (pristine or patched). A runtime snapshot is
      // what sessions execute, so it must be patched for the fix to be live.
      const recognized = !check.error && check.files && Object.values(check.files).every((f) => f.state === "pristine" || f.state === "patched");
      const ok = live ? recognized && summary === "patched" : recognized;
      out.installed.push({
        status: ok ? "ok" : "drift",
        label: `${row.name}:${tag}`,
        actual: check.error ? check.error : summary,
        expected: live ? "patched" : "pristine|patched",
      });
    }
  }

  return out;
}

function summarizePatchCheck(check) {
  const states = Object.values(check.files || {}).map((f) => f.state);
  if (!states.length) return "unknown";
  if (check.version === "unsupported") return "unsupported";
  if (states.every((s) => s === "patched")) return "patched";
  if (states.every((s) => s === "pristine")) return "pristine";
  if (states.every((s) => s === "pristine" || s === "patched")) return "partial";
  return "unknown";
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const opts = { only: null, verbose: false, strict: false, json: false, senpiRoot: SENPI, agentDir: AGENT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--only") opts.only = argv[++i];
    else if (arg === "--verbose" || arg === "-v") opts.verbose = true;
    else if (arg === "--senpi-root") opts.senpiRoot = argv[++i];
    else if (arg === "--strict") opts.strict = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`check-patches: ${error.message}`);
    return 2;
  }

  if (opts.help) {
    console.log(
      "usage: node custom-layer/check-patches.mjs [--only <name>] [--senpi-root <dir>] [--verbose] [--strict] [--json]",
    );
    return 0;
  }

  const rows = makeRows();
  const selected = opts.only ? rows.filter((row) => row.name === opts.only) : rows;
  if (opts.only && selected.length === 0) {
    console.error(`check-patches: unknown row '${opts.only}'. Known rows: ${rows.map((r) => r.name).join(", ")}`);
    return 2;
  }

  const results = [];
  for (const row of selected) {
    try {
      results.push(evaluateRow(row, opts));
    } catch (error) {
      results.push({
        name: row.name,
        location: row.location,
        state: row.hint || "local-commit",
        repo: row.repoPath ? readRepoState(row.repoPath) : null,
        installed: [{ status: "error", label: row.name, actual: error.message, expected: "-" }],
        extras: [`error=${error.message.replace(/\s+/g, " ")}`],
        sourceCheck: "error",
      });
    }
  }

  const count = (state) => results.filter((r) => r.state === state).length;
  const summary = {
    patches: results.length,
    tracked: count("tracked"),
    localCommit: count("local-commit"),
    private: count("private"),
    external: count("external"),
    drift: results.filter(
      (r) => r.sourceCheck !== "ok" || aggregate(r.installed.map((f) => f.status)) !== "ok",
    ).length,
    manual: results.reduce((n, r) => n + (r.manual?.length || 0), 0),
  };

  // Ledger and discovery are whole-inventory checks; an --only run cannot pass them.
  const gate = opts.strict || opts.json;
  const ledger = gate && !opts.only ? readLedger(rows) : null;
  const discovery = gate && !opts.only ? discoverActive(opts.agentDir, rows) : null;
  const verdict = strictVerdict({ results, ledger, discovery, partial: Boolean(opts.only) });

  if (opts.json) {
    const doc = {
      schema: "omo-check-patches/1",
      checkedAt: new Date().toISOString(),
      options: { only: opts.only, strict: opts.strict, agentDir: opts.agentDir, senpiRoot: opts.senpiRoot },
      scope: SCOPE,
      summary,
      rows: results,
      ledger,
      discovery,
      verdict,
    };
    console.log(JSON.stringify(doc, null, 2));
    return opts.strict ? verdict.exitCode : 0;
  }

  for (const result of results) console.log(formatRow(result));
  console.log(
    `SUMMARY patches=${summary.patches} tracked=${summary.tracked} local-commit=${summary.localCommit} untracked=0 ` +
      `drift=${summary.drift} private=${summary.private} external=${summary.external} manual=${summary.manual}`,
  );
  if (!opts.strict) return 0;

  if (ledger) {
    console.log(
      ledger.error
        ? `LEDGER error=${ledger.error}`
        : `LEDGER rows=${ledger.ids.length} missing-from-checker=${ledger.missingFromChecker.length} ` +
            `missing-from-ledger=${ledger.missingFromLedger.length} state-mismatch=${ledger.stateMismatch.length}`,
    );
  }
  if (discovery) {
    console.log(
      `DISCOVERY entries=${discovery.entries.length} unledgered=${discovery.unledgered.length} ` +
        `missing=${discovery.missing.length} host-shims=${discovery.hostShims.length} inert=${discovery.inert.length} ` +
        `errors=${discovery.errors.length}`,
    );
  }
  for (const line of verdict.failures) console.log(`FAIL ${line}`);
  for (const line of verdict.unverified) console.log(`UNVERIFIED ${line}`);
  for (const line of verdict.warnings) console.log(`WARN ${line}`);
  console.log(`SCOPE ${SCOPE}`);
  console.log(
    `STRICT verdict=${verdict.verdict} exit=${verdict.exitCode} failures=${verdict.failures.length} ` +
      `unverified=${verdict.unverified.length} warnings=${verdict.warnings.length}`,
  );
  return verdict.exitCode;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
