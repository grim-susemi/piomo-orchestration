#!/usr/bin/env node
// Read-only checker for the custom patch ledger (custom-layer/PATCHES.md).
//
// For every live patch it reports:
//   - the source repository's HEAD, remote, ahead/behind against its upstream, and dirtiness;
//   - whether the tracked source blob and the captured copy still match what is installed;
//   - the installed file hashes;
//   - for senpi-freeze-fix, `patch.mjs --check` and `probe.mjs` on the installed senpi root.
//
// It never writes to a repository or to an installed file. `probe.mjs` copies senpi's
// dist to a temp directory and deletes it, as documented in its own README.
// It always exits 0 when the check ran; drift is reported, not thrown.
//
// Usage:
//   node custom-layer/check-patches.mjs [--only <name>] [--senpi-root <dir>] [--verbose]

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);

const AGENT =
  process.env.OMO_CHECK_AGENT_DIR ||
  "C:/Users/USER/.omo-stable-500/home/.omo/agent";
const OVERLAY =
  process.env.OMO_CHECK_OVERLAY_ROOT ||
  "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/package";
const GLOBAL_OMO =
  process.env.OMO_CHECK_GLOBAL_OMO ||
  "C:/Users/USER/.bun/install/global/node_modules/omo-ai";
const SENPI =
  process.env.OMO_CHECK_SENPI_ROOT ||
  "C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi";

const ORCH = REPO;
const COORD = "C:/Users/USER/orca/projects/piomo-agent-coordination-mod";
const COMPACTION = "C:/Users/USER/orca/projects/omo-compaction-model";
const EARLY = "C:/Users/USER/orca/projects/piomo-early-compaction-mod";

const FREEZE_FILES = [
  "dist/core/extensions/builtin/moved-path-guard/command-paths.js",
  "dist/core/tools/filesystem-policy.js",
  "dist/bundle/chunks/chunk-35M5MVUZ.js",
  "dist/bundle/chunks/session-worker.js",
];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested by test/check-patches.test.mjs)

export function parseRevCount(text) {
  const m = String(text ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) return null;
  return { behind: Number(m[1]), ahead: Number(m[2]) };
}

export function classifyState({ hint, upstream, ahead } = {}) {
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
    const matched = expectedList.find((value) => value === actual) || null;
    return {
      status: matched ? "ok" : "drift",
      actual,
      expected: expectedList.join("|"),
      matched,
      label: file,
    };
  } catch {
    return { status: "missing", actual: null, expected: expectedList.join("|"), matched: null, label: file };
  }
}

function checkWorktree(file, expected) {
  return checkInstalled(file, expected);
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
      name: "memory-overlay",
      hint: "tracked",
      location: "custom-layer/memory-overlay",
      repoPath: ORCH,
      captured: [
        "omo.js",
        "omo-memory-doctor.diff",
        "omo-memory-memfs.diff",
        "PROVENANCE.md",
      ],
      capturedExpected: { "omo.js": "4a8aef923825ccd5fbb5ab6d4b3b72e0ae145b670309f1db3ead53827c029476" },
      installed: [
        { path: `${OVERLAY}/plugin/extensions/omo.js`, expected: "4a8aef923825ccd5fbb5ab6d4b3b72e0ae145b670309f1db3ead53827c029476" },
        { path: `${OVERLAY}/plugin/extensions/omo-memory-doctor.js`, expected: "1f4758613c914142864b12cc985213c0aeb4f79e933f12402b61b5ad9aa79b16" },
        { path: `${OVERLAY}/plugin/extensions/omo-memory-memfs.js`, expected: "611ec44b91e98abbd1375e24c87b72a033a3de7864c1788ce07e56ad8f0be17e" },
      ],
    },
    {
      name: "coordination-adapters",
      hint: "tracked",
      location: "dist/extension.js+scripts/build-adapter.mjs",
      repoPath: COORD,
      sourceBlobs: [
        { path: "dist/extension.js", expected: "1a717c64505adfacb484e4906bead927c4d0975598f1c1928e695f2b6174233f" },
      ],
      sourceText: [
        { path: "scripts/build-adapter.mjs", contains: "36d98c7ab3cc07349b60adc8bc7365a85e7573653ebab574d0114c2571d53dcd" },
      ],
      installed: [
        { path: `${AGENT}/packages/piomo-agent-coordination-mod/dist/extension.js`, expected: "1a717c64505adfacb484e4906bead927c4d0975598f1c1928e695f2b6174233f" },
        { path: `${OVERLAY}/plugin/extensions/omo-task.js`, expected: "2b559bb11f0285072722cffbb7f322756c81aec867f6fb4a683278f075d7f783" },
        { path: `${GLOBAL_OMO}/plugin/extensions/omo-task.js`, expected: "2b559bb11f0285072722cffbb7f322756c81aec867f6fb4a683278f075d7f783" },
      ],
      extras: ["adapter=generated(2b559bb1)"],
    },
    {
      name: "task-record-publish-retry",
      hint: "tracked",
      location: "custom-layer/task-record-publish-retry/extension.mjs",
      repoPath: ORCH,
      sourceBlobs: [
        {
          path: "custom-layer/task-record-publish-retry/extension.mjs",
          expected: [
            "6264d44e49cae147569237ba5e200a8f41c7ab517cda03b64f8f7839e72cd2c7",
            "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5",
          ],
        },
      ],
      worktreeChecks: [
        { path: `${ORCH}/custom-layer/task-record-publish-retry/extension.mjs`, expected: "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5" },
      ],
      installed: [
        {
          path: `${AGENT}/task-record-publish-retry/extension.mjs`,
          expected: [
            "6264d44e49cae147569237ba5e200a8f41c7ab517cda03b64f8f7839e72cd2c7",
            "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5",
          ],
        },
      ],
      extras: ["accepted=old-HEAD|D9-target"],
    },
    {
      name: "settings-guard",
      hint: "tracked",
      location: "custom-layer/settings-guard/extension.mjs",
      repoPath: ORCH,
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
      trackedFiles: ["src/extension.ts", "scripts/mod.mjs"],
      sourceText: [
        { path: "package.json", contains: "bun build src/extension.ts --outfile dist/early-compaction.js" },
      ],
      installed: [
        { path: `${AGENT}/extensions/early-compaction.js`, expected: "c0416e2a5896961d1ee97925a74e788fbeba13a4deb0b69dc2312279706f740a" },
      ],
      extras: ["build=bun-run-build(dist gitignored)"],
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
      freeze: true,
      installed: [],
    },
  ];
}

// ---------------------------------------------------------------------------
// Row evaluation

function evaluateRow(row, opts) {
  const out = {
    name: row.name,
    location: row.location,
    state: "local-commit",
    repo: null,
    installed: [],
    extras: [],
    sourceCheck: "ok",
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

  out.sourceCheck = sourceStatuses.length ? aggregate(sourceStatuses) : "ok";

  for (const file of row.installed) {
    out.installed.push(checkInstalled(file.path, file.expected));
  }

  if (row.name === "task-record-publish-retry" && out.installed[0]) {
    const actual = out.installed[0].actual;
    out.extras.push(
      actual === "4000be68adc43821153f3555b29433bd96a11d9fa328c6ff19fa0e3dc0f5a1a5"
        ? "installed-version=D9-target"
        : actual === "6264d44e49cae147569237ba5e200a8f41c7ab517cda03b64f8f7839e72cd2c7"
          ? "installed-version=old-HEAD"
          : "installed-version=other",
    );
  }

  if (row.freeze) {
    const patchScript = `${HERE}/senpi-freeze-fix/patch.mjs`;
    const probeScript = `${HERE}/senpi-freeze-fix/probe.mjs`;
    const check = runJsonLine(process.execPath, [patchScript, "--senpi-root", opts.senpiRoot, "--check"], "CHECK");
    out.extras.push(`patch-check=${check.error ? `error(${check.error})` : check.version ? check.files ? summarizePatchCheck(check) : check.version : "unknown"}`);

    const probe = runJsonLine(process.execPath, [probeScript, "--senpi-root", opts.senpiRoot], "PROBE");
    out.extras.push(`probe=${probe.error ? `error(${probe.error})` : probe.verdict}`);

    const backups = FREEZE_FILES.filter((rel) => fs.existsSync(`${opts.senpiRoot}/${rel}.freeze-fix.bak`));
    if (backups.length) {
      const fromBackups = runJsonLine(
        process.execPath,
        [probeScript, "--senpi-root", opts.senpiRoot, "--from-backups"],
        "PROBE",
      );
      out.extras.push(`probe-backups=${fromBackups.error ? `error(${fromBackups.error})` : fromBackups.verdict}`);
    }

    // The four dist files are managed by patch.mjs, so the row is clean only when
    // the check recognizes every file (pristine or patched) and not unsupported.
    const patchOk = !check.error && check.files && Object.values(check.files).every((f) => f.state === "pristine" || f.state === "patched");
    out.installed.push({
      status: patchOk ? "ok" : "drift",
      label: "senpi-freeze-fix:patch-check",
      actual: check.error ? check.error : check.version,
      expected: "pristine|patched",
    });
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
  const opts = { only: null, verbose: false, senpiRoot: SENPI };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--only") opts.only = argv[++i];
    else if (arg === "--verbose" || arg === "-v") opts.verbose = true;
    else if (arg === "--senpi-root") opts.senpiRoot = argv[++i];
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
    console.log("usage: node custom-layer/check-patches.mjs [--only <name>] [--senpi-root <dir>] [--verbose]");
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

  for (const result of results) console.log(formatRow(result));

  const tracked = results.filter((r) => r.state === "tracked").length;
  const local = results.filter((r) => r.state === "local-commit").length;
  const drift = results.filter(
    (r) => r.sourceCheck !== "ok" || aggregate(r.installed.map((f) => f.status)) !== "ok",
  ).length;
  console.log(
    `SUMMARY patches=${results.length} tracked=${tracked} local-commit=${local} untracked=0 drift=${drift}`,
  );
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invoked && invoked === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
