#!/usr/bin/env node
// R21 memory-rollback-5.1.38-r1: custom package overlay; previous comments are historical.
// R21 CUTOVER pins: omo-ai 5.1.38 / senpi 2026.10.19; ACTIVE after verified byte-preserving activation; earlier comments below are historical.
// omo-memory-selector-entry-r18.mjs — 5.1.4 cutover re-entry (stock 5.1.4 plugin, 2026-09-30).
// Companion to staging/omo-memory-selector-candidate-r3.cmd. Successor to
// entry-r2: same lane guard, same read-only prep/version gate, same
// discovery-ON direct launch — plus the CMD's stock/direct classification
// BEFORE any staged prerequisite (reviewer R2-H1), and the reference
// foreground console policy (no windowsHide; see below).
//
// Dispatch contract (mirrors candidate-r3.cmd first-token rules exactly):
//   STOCK (pinned installed bin/omo.js, argv array, lane-pinned/cleared env,
//   no staged checks): daemon doctor setup ulw-loop update install remove
//   list config auth app-server host in ANY form, plus SOLE --version / -v /
//   --help / -h / --list-tips. Everything else (interactive, print,
//   list-models, multi-arg version/help) goes DIRECT.
// Rationale: stock helpers are product commands, not engine prompts. Sending
// them to the Senpi CLI as positional messages would misroute maintenance
// into agent input. Ordinary launches keep r2 with candidate-aware OMO_BIN.
//
// Consumer trace (read-only, carried from R2): the senpi engine and both
// bundled extensions contain zero OMO_BIN references; the only in-repo
// consumer is the r2 give-me-tips skill ("$OMO_BIN" --list-tips, with
// omo/senpi fallbacks; win32 callers prefix node). Stock helpers here
// re-enter stock, so their documented launcher usage is unchanged.
//
// Console policy: NO windowsHide on either spawn. The reference local
// launcher (r2 scripts/install.mjs template) deliberately omits it for
// foreground inherited-stdio startup: hiding the window would suppress the
// console a console-less launch needs to render the TUI. Both spawns below
// use stdio "inherit" with no shell and no windowsHide key.
import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { delimiter, resolve } from "node:path"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"

const LANE = "C:\\Users\\USER\\.omo-stable-500"
const STOCK_PLUGIN = "C:\\Users\\USER\\.omo-stable-500\\staging\\memory-rollback-5.1.38-r1\\package\\plugin"
const CHG = "C:\\Users\\USER\\.bun\\install\\global\\node_modules\\omo-ai\\CHANGELOG.md"
const MODULES = "C:\\Users\\USER\\.bun\\install\\global\\node_modules"
const OMO_PKG = `${MODULES}\\omo-ai\\package.json`
const SENPI_PKG = `${MODULES}\\@code-yeongyu\\senpi\\package.json`
const STAMP = `${MODULES}\\@code-yeongyu\\senpi\\.omo-engine-prepared`
const BUNDLE = `${MODULES}\\@code-yeongyu\\senpi\\dist\\bundle\\cli.js`
const FALLBACK_CLI = `${MODULES}\\@code-yeongyu\\senpi\\dist\\cli.js`
const BRAND_JS = `${MODULES}\\@code-yeongyu\\senpi\\dist\\core\\brand.js`
const STOCK_ENTRY = "C:\\Users\\USER\\.omo-stable-500\\staging\\memory-rollback-5.1.38-r1\\package\\bin\\omo.js"
const STOCK_ENTRY_PLUGIN = `${STOCK_PLUGIN}\\extensions\\omo.js`
const BIN_DIR = `${MODULES}\\.bin`
const PINNED_OMO = "5.1.38"
const PINNED_SENPI = "2026.10.19"
const UPDATE_CMD = "bun add -g omo-ai"
const GUARDED = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR", "OMO_CODING_AGENT_SESSION_DIR", "SENPI_CODING_AGENT_SESSION_DIR", "OMO_LSP_DAEMON_DIR", "OMO_LSP_DAEMON_CLI", "OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR"]
const CLEARED = ["OMO_LSP_DAEMON_VERSION", "PI_SESSION_FILE", "PI_SESSION_ID", "PI_SESSION_CWD", "OMO_AGENT_TOOLKIT_SDK_ROOT", "OMO_DAG_SDK_ROOT", "OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR"]
// Same first-token rules as candidate-r3.cmd (and the live wrapper): any
// args under these verbs stay stock; version/help/tips only when sole.
const STOCK_FIRST = new Set(["daemon", "doctor", "setup", "ulw-loop", "update", "install", "remove", "list", "config", "auth", "app-server", "host"])
const STOCK_SOLE = new Set(["--version", "-v", "--help", "-h", "--list-tips"])

function isStockHelper(argv) {
  if (STOCK_FIRST.has(argv[0])) return true
  if (argv.length === 1 && STOCK_SOLE.has(argv[0])) return true
  return false
}

const fail = (code, tag, detail) => {
  console.error(`${tag} ${detail}`)
  console.error(`omo-stable-500: refusing candidate re-entry; use stock helpers or reinstall with: ${UPDATE_CMD}`)
  process.exit(code)
}

// --- state-root guard: before any engine/helper process (mirrors the .cmd) ---
{
  const lane = resolve(LANE).toLowerCase()
  const bad = GUARDED.filter((n) => {
    const v = process.env[n]
    if (!v) return false
    const a = resolve(v).toLowerCase()
    return a !== lane && !a.startsWith(lane + "\\")
  })
  if (bad.length) {
    for (const n of bad) console.error(`OMO_STABLE_REFUSED_FOREIGN_STATE_ROOT ${n}=${process.env[n]}`)
    fail(2, "OMO_STABLE_REFUSED_FOREIGN_STATE_ROOT", `every state root for this lane must resolve inside ${LANE}`)
  }
}

if (new Set(["setup","update","install","remove","list","config","auth"]).has(process.argv[2]) || (process.argv.length === 3 && STOCK_SOLE.has(process.argv[2]))) {
  const child = spawn(process.execPath, ["C:\\Users\\USER\\.bun\\install\\global\\node_modules\\omo-ai\\bin\\omo.js", ...process.argv.slice(2)], { env: laneEnvBase(), stdio: "inherit" })
  trackChild(child)
  await new Promise((resolve) => child.once('close', resolve))
  process.exit(process.exitCode ?? 0)
}
const memoryOverlayGate = "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/gate.mjs"
try {
  if (createHash("sha256").update(readFileSync(memoryOverlayGate)).digest("hex") !== "5c74e89b8b47f9108d5a974f3b41960ff7c3896d25cc46d8d8663b188a02479c") fail(2, "MEMORY_OVERLAY_GATE_DIGEST", memoryOverlayGate)
  await (await import(pathToFileURL(memoryOverlayGate).href)).verifyPayload("15177e17f64e9a7f8bdcc5abaf3d8aacfc6a6a39d01bf7894ac4039221d7a177")
} catch (e) { fail(2, "MEMORY_OVERLAY_GATE", e instanceof Error ? e.message : String(e)) }
// --- lane environment shared by both branches (pinned + cleared only) ---
function laneEnvBase() {
  const agentDir = `${LANE}\\home\\.omo\\agent`
  const env = { ...process.env }
  delete env.OMO_BIN
  delete env.SENPI_BIN
  for (const n of CLEARED) env[n] = ""
  env.HOME = `${LANE}\\home`
  env.USERPROFILE = `${LANE}\\home`
  env.OMO_CODING_AGENT_DIR = agentDir
  env.SENPI_CODING_AGENT_DIR = agentDir
  env.PI_CODING_AGENT_DIR = agentDir
  env.OMO_RUNTIME = "node"
  return env
}

function trackChild(child) {
  child.on("error", (e) => { console.error(`omo-stable-500: candidate spawn failed: ${e.message}`); process.exitCode = 1 })
  child.on("close", (code, signal) => {
    if (signal) { try { process.kill(process.pid, signal) } catch { process.exitCode = 1 } return }
    process.exitCode = code ?? 1
  })
}

const rest = process.argv.slice(2)

// --- stock helpers BEFORE any staged prerequisite (R2-H1/M3) ---
// No r2/CLI/stamp check may precede this decision: helpers do not use them.
// OMO_BIN/SENPI_BIN are deleted above so no stale candidate re-entry leaks
// into stock (the installed launcher re-derives both itself).
if (isStockHelper(rest)) {
  if (!existsSync(STOCK_ENTRY)) fail(2, "OMO_STABLE_ENTRY_MISSING", STOCK_ENTRY)
  const child = spawn(process.execPath, [STOCK_ENTRY, ...rest], {
    env: laneEnvBase(),
    stdio: "inherit",
  })
  trackChild(child)
} else {
  // --- direct-only prerequisites: read-only, fail closed, never write ---
  let omoVer, senpiVer
  try { omoVer = JSON.parse(readFileSync(OMO_PKG, "utf8")).version }
  catch (e) { fail(2, "OMO_STABLE_DIRECT_PREREQ", `installed omo-ai manifest unreadable: ${e.message}`) }
  try { senpiVer = JSON.parse(readFileSync(SENPI_PKG, "utf8")).version }
  catch (e) { fail(2, "OMO_STABLE_DIRECT_PREREQ", `installed senpi manifest unreadable: ${e.message}`) }
  if (omoVer !== PINNED_OMO) fail(2, "OMO_STABLE_DIRECT_PREREQ", `installed omo-ai ${omoVer} != validated ${PINNED_OMO}`)
  if (senpiVer !== PINNED_SENPI) fail(2, "OMO_STABLE_DIRECT_PREREQ", `installed senpi ${senpiVer} != validated ${PINNED_SENPI}`)
  let stamp
  try { stamp = readFileSync(STAMP, "utf8").trim() }
  catch (e) { fail(2, "OMO_STABLE_DIRECT_PREREQ", `engine prepared stamp unreadable: ${e.message}`) }
  if (stamp !== omoVer) fail(2, "OMO_STABLE_DIRECT_PREREQ", `engine stamp ${JSON.stringify(stamp)} != installed ${omoVer}`)
  const cli = existsSync(BUNDLE) ? BUNDLE : FALLBACK_CLI
  for (const f of [cli, BRAND_JS, STOCK_ENTRY_PLUGIN]) {
    if (!existsSync(f)) fail(2, "OMO_STABLE_DIRECT_PREREQ", `missing ${f}`)
  }

  // --- direct launch: ONE corrected plugin plus discovered user extras ----
  // Discovery stays ON (loader-QA proven): the r2 owner plus the live-home
  // user extensions (incl. omo-model-tuning.ts) load with zero conflicts.
  const env = laneEnvBase()
  env.SENPI_RUNTIME = "node"
  env.OMO_NATIVE = "1"
  env.SENPI_BRAND = JSON.stringify({
    name: "OmO", command: "omo", displayVersion: PINNED_OMO, configDir: ".omo",
    flatLayout: false, envPrefix: "OMO", userAgent: "omo", originator: "omo",
    changelog: { path: CHG, version: PINNED_OMO },
    update: { packageName: "omo-ai", distTag: "latest", command: UPDATE_CMD, changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases" },
  })
  env.OMO_BIN = process.argv[1]
  if (existsSync(`${BIN_DIR}\\senpi.cmd`)) env.SENPI_BIN = `${BIN_DIR}\\senpi.cmd`
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH"
  env[pathKey] = env[pathKey] ? `${BIN_DIR}${delimiter}${env[pathKey]}` : BIN_DIR

  const child = spawn(process.execPath, [cli, "--extension", STOCK_PLUGIN, ...rest], { env, stdio: "inherit" })
  trackChild(child)
}
