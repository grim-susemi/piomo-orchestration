import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync, cpSync, copyFileSync, watch, openSync, closeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import vm from "node:vm";
import { writePatchedHost } from "../../patch.mjs";
import { LEAD_SUBMISSION_SCHEMA } from "../../lead-submission.mjs";
import { readState, logicalKey } from "../../state.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/cases.json", import.meta.url));
const WRITE_GUARD = fileURLToPath(new URL("./write-guard.cjs", import.meta.url));

export const DEFAULT_PATHS = {
  host: "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.69-r1/package/plugin/extensions/omo-task.js",
  packageJson: "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.69-r1/package/package.json",
  plugin: "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.69-r1/package/plugin/extensions/omo.js",
  packageRoot: "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.69-r1/package",
  senpi: "C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi/dist/bundle/cli.js",
  omo: "C:/Users/USER/.omo-stable-500/omo.cmd",
  fixture: FIXTURE,
};

const GATE_MARKER = "is plan-gated and cannot be spawned:";
const GATE_TERMINAL = ':{kind:"allow"}}';
const CALL_SITE = "Ca(r,e.resolveSkillInvocations?.(n)??Pa)";

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readHostFile(path) {
  try {
    const bytes = readFileSync(path);
    return { path, exists: true, bytes: bytes.length, sha256: sha256Bytes(bytes), text: bytes.toString("utf8") };
  } catch (error) {
    return { path, exists: false, bytes: 0, sha256: null, text: "", error: error.message };
  }
}

export function readHistoryFixture(path = FIXTURE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function countOccurrences(text, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

export function extractGate(text) {
  const marker = text.indexOf(GATE_MARKER);
  const start = marker < 0 ? -1 : text.lastIndexOf("function ", marker);
  const end = marker < 0 ? -1 : text.indexOf(GATE_TERMINAL, marker);
  if (marker < 0 || start < 0 || end < 0) {
    return { ok: false, reason: "gate-boundary" };
  }
  const source = text.slice(start, end + GATE_TERMINAL.length);
  const policies = {};
  for (const role of ["plan-consultant", "plan-reviewer"]) {
    const pattern = new RegExp(`"${role}":(\\{[^{}]*\\})`, "g");
    const matches = [...text.matchAll(pattern)].filter((match) => match[1].includes("requiresSkills"));
    if (matches.length !== 1) return { ok: false, reason: `policy:${role}` };
    policies[role] = vm.runInNewContext(`(${matches[0][1]})`, {}, { timeout: 100 });
  }
  const accessor = /let\s+[\w$]+=([\w$]+)\([\w$]+\);if/.exec(source)?.[1];
  if (!accessor) return { ok: false, reason: "gate-accessor" };
  const gate = vm.runInNewContext(`(${source})`, { [accessor]: (role) => policies[role] }, { timeout: 100 });
  return { ok: true, source, sourceStart: start, policies, accessor, gate };
}

export function evaluateGate(gate, role, state) {
  return gate(role, {
    hasInvoked: () => state.invoked === true,
    hasUserRequested: () => state.requested === true,
    hasPlanArtifact: () => state.artifact === true,
    planArtifactReferences: () => [],
  });
}

export function extractFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0;
  let index = text.indexOf("{", start);
  for (; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function blocked(reason) {
  return {
    caseId: "boundary-unobserved",
    variant: "stock",
    packageSha256: null,
    loadedModuleSha256: null,
    loadedInProcess: false,
    evaluatedInVm: false,
    ownerEventCount: 0,
    policySource: "none",
    launchesFromHost: 0,
    childReceiptIds: [],
    recordedChildCount: 0,
    autoUsed: 0,
    manualUsed: 0,
    state: "blocked",
    reason,
    expected: "every stock review entry point must be mapped before a candidate delta is written",
    actual: null,
    anchors: null,
    decisions: [],
    r83: null,
    candidateEdits: 0,
  };
}

export function boundaryReport(options = {}) {
  const paths = { ...DEFAULT_PATHS, ...options.paths };
  const files = {
    host: readHostFile(paths.host),
    packageJson: readHostFile(paths.packageJson),
    senpi: readHostFile(paths.senpi),
    omo: readHostFile(paths.omo),
  };
  const missing = Object.entries(files).filter(([, file]) => !file.exists).map(([name]) => name);
  if (missing.length > 0) return blocked(`missing:${missing.join(",")}`);
  if (options.expectedHostSha && files.host.sha256 !== options.expectedHostSha) {
    return blocked("runtime-mismatch");
  }

  const gate = extractGate(files.host.text);
  if (!gate.ok) return blocked(gate.reason);

  const normalized = files.host.text.replace(/\s+/g, " ");
  const spawnPolicy = extractFunction(files.host.text, "Lk");
  const anchors = {
    gateDefinitionCount: countOccurrences(normalized, "function Ca(e,t){let n=Ma(e);"),
    callSiteCount: countOccurrences(normalized, CALL_SITE),
    spawnPolicyHasGate: Boolean(spawnPolicy?.includes(CALL_SITE)),
    stateProviderCount: countOccurrences(normalized, "hasUserRequested:t=>n.get(e)?.has(t)??!1"),
    budgetMentions: countOccurrences(normalized, "review_round_limit"),
    gateSourceStart: gate.sourceStart,
    spawnPolicyStart: spawnPolicy ? files.host.text.indexOf("function Lk(e,t,n,r)") : -1,
  };
  if (
    anchors.gateDefinitionCount !== 1
    || anchors.callSiteCount !== 1
    || anchors.spawnPolicyHasGate !== true
    || anchors.stateProviderCount !== 1
  ) {
    return blocked("unmapped-entry");
  }

  const decisions = [1, 83].map((limit) => ({
    limit,
    decision: evaluateGate(gate.gate, "plan-reviewer", { invoked: false, requested: true, artifact: true }),
  }));
  const denied = {
    request: evaluateGate(gate.gate, "plan-reviewer", { invoked: false, requested: false, artifact: true }),
    artifact: evaluateGate(gate.gate, "plan-reviewer", { invoked: false, requested: true, artifact: false }),
  };

  let fixture;
  try {
    fixture = options.fixture ?? readHistoryFixture(paths.fixture);
  } catch (error) {
    return blocked(`fixture:${error.message}`);
  }
  const reservation = fixture.history.find((row) => row.lineOrKey === "J:5816");
  const launch = fixture.history.find((row) => row.lineOrKey === "J:5827-5831");
  const verdict = fixture.history.find((row) => row.lineOrKey === "r83-verdict");
  const r83 = {
    limit: reservation?.observed?.review_round_limit ?? null,
    child: launch?.taskId ?? null,
    childCount: launch?.taskId ? 1 : 0,
    sha: verdict?.sha ?? null,
    verdict: verdict?.observed?.verdict ?? null,
  };

  const allAllow = decisions.every((entry) => entry.decision.kind === "allow");
  const state = allAllow && anchors.budgetMentions === 0 && r83.limit === 83 && r83.childCount === 1
    ? "managed-delta"
    : allAllow ? "blocked" : "stock-conforms";
  const reason = state === "managed-delta"
    ? "the only pre-spawn gate allows a second review and the host has no budget field; the exact Ca call site is mapped"
    : state === "stock-conforms"
      ? "the stock gate already denies the second review"
      : "the recorded r83 call or the budget observation is incomplete";

  return {
    caseId: "boundary-attested",
    variant: "stock",
    packageSha256: files.host.sha256,
    loadedModuleSha256: files.host.sha256,
    loadedInProcess: false,
    evaluatedInVm: true,
    packageVersion: /"version"\s*:\s*"([^"]+)"/.exec(files.packageJson.text)?.[1] ?? null,
    senpiSha256: files.senpi.sha256,
    omoSha256: files.omo.sha256,
    ownerEventCount: 1,
    policySource: "omo-task.js:Lk/Ca",
    launchesFromHost: 0,
    childReceiptIds: launch?.taskId ? [launch.taskId] : [],
    recordedChildCount: r83.childCount,
    autoUsed: 1,
    manualUsed: 0,
    state,
    reason,
    expected: "the stock gate must deny a second review after the recorded limit, or the missing budget must be anchored before the only Ca call site",
    actual: { decisions, denied, anchors, r83 },
    anchors,
    decisions,
    denied,
    r83,
    candidateEdits: 0,
  };
}

// ---------------------------------------------------------------------------
// Isolated native replay.  Every case runs a real host process against a copy of
// the package; the fake provider only chooses the model's next tool call.  The
// receipt, task record, transcript and denials are the host's own files.

function sseChunk(delta, finish = null) {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function sseCalls(res, calls) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(sseChunk({
    role: "assistant",
    tool_calls: calls.map((call, index) => ({
      index,
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  }))}\n\n`);
  res.write(`data: ${JSON.stringify(sseChunk({}, "tool_calls"))}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function sseText(res, text) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(sseChunk({ role: "assistant", content: text }))}\n\n`);
  res.write(`data: ${JSON.stringify(sseChunk({}, "stop"))}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

export function readTaskRecords(agent, workspace) {
  const records = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
      } else if (entry.name.endsWith(".json") && path.includes("senpi-task") && path.includes("tasks")) {
        try {
          const record = JSON.parse(readFileSync(path, "utf8"));
          if (record.task_id && !seen.has(record.task_id)) {
            seen.add(record.task_id);
            records.push(record);
          }
        } catch {
          // A partially written record is not a receipt.
        }
      }
    }
  };
  walk(join(agent, "projects"), 0);
  walk(join(workspace, ".omo", "senpi-task", "tasks"), 0);
  return records.sort((left, right) => Date.parse(left.created_at ?? 0) - Date.parse(right.created_at ?? 0));
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
  } else {
    process.kill(pid, "SIGKILL");
  }
}

function sessionsContain(agent, marker) {
  const root = join(agent, "sessions");
  if (!existsSync(root)) return false;
  let found = false;
  const walk = (dir, depth) => {
    if (found || depth > 4) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.name.endsWith(".jsonl")) {
        try {
          if (readFileSync(path, "utf8").includes(marker)) { found = true; return; }
        } catch { /* a session being written is not evidence yet */ }
      }
    }
  };
  walk(root, 0);
  return found;
}

function writeAgentFiles(home, agent) {
  mkdirSync(join(home, ".omo"), { recursive: true });
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(agent, "settings.json"), JSON.stringify({
    defaultProvider: "fake",
    defaultModel: "fake-model",
    defaultThinkingLevel: "off",
    defaultProjectTrust: "always",
    packages: [],
    extensions: [],
    agents: {
      "plan-reviewer": { model: "fake/fake-model", executionMode: "process" },
      "plan-consultant": { model: "fake/fake-model", executionMode: "process" },
      explore: { model: "fake/fake-model" },
    },
    retry: { modelFallback: false, fallbackChains: { "*": [] } },
    turn_max_runtime_ms: 0,
  }, null, 2));
  const nativeSection = {
    models: {
      fake: { model: "fake/fake-model", variant: "off" },
    },
    agents: {
      "plan-reviewer": { model: "fake" },
      "plan-consultant": { model: "fake" },
      explore: { model: "fake" },
    },
  };
  writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify({
    "[native]": nativeSection,
    profiles: {
      "native-fixture": { "[native]": nativeSection },
    },
  }, null, 2));
  const selection = JSON.stringify({
    key: "fixture",
    profile: "native-fixture",
    appliedAt: new Date().toISOString(),
  }, null, 2);
  writeFileSync(join(home, ".omo", "native-profile-selection.json"), selection);
  writeFileSync(join(agent, "native-profile-selection.json"), selection);
}

function childEnv({ home, agent, workspace, stateRoot, gateLog, sessionId, ownerTranscript, writeLog }) {
  for (const dir of [
    join(home, "AppData", "Roaming"),
    join(home, "AppData", "Local"),
    join(home, "tmp"),
    join(home, ".config"),
    join(home, ".cache"),
    join(home, ".run"),
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PI_|SENPI_|OMO_|PRC_)/u.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    TMP: join(home, "tmp"),
    TEMP: join(home, "tmp"),
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(home, ".run"),
    OMO_NATIVE: "1",
    PI_CODING_AGENT: "true",
    SENPI_CLI_ISOLATED_CHILD: "1",
    OMO_CODING_AGENT_DIR: agent,
    SENPI_CODING_AGENT_DIR: agent,
    PI_CODING_AGENT_DIR: agent,
    PI_IMAGE_PROTOCOL: "none",
    NO_COLOR: "1",
    CI: "1",
    PRC_STATE_ROOT: stateRoot,
    PRC_WORKSPACE_ROOT: workspace,
    PRC_WORKSPACE_ID: "ws-fixture",
    PRC_SESSION_ID: sessionId,
    PRC_GATE_LOG: gateLog,
    NODE_OPTIONS: `--require "${WRITE_GUARD.replaceAll("\\", "/")}"`,
  });
  if (ownerTranscript) env.PRC_OWNER_TRANSCRIPT = ownerTranscript;
  if (writeLog) env.PRC_WRITE_LOG = writeLog;
  return env;
}

function planText() {
  return [
    "# Fixture plan",
    "",
    "- [ ] 1. Do the fixture work",
    "  QA: node --test fixture.test.mjs",
    "- [ ] 2. Gateway start order",
    "  The gateway may allow client starts while the operator is signed in.",
    "  The launcher must deny client starts until the operator approves.",
    "",
  ].join("\n");
}

const WITNESS = {
  kind: "contradiction",
  subject: "gateway-client",
  action: "open",
  state: "descriptor-restoration",
  expectedA: "allow",
  expectedB: "deny",
  lineA: 6,
  lineB: 7,
  tokensA: ["may allow client starts"],
  tokensB: ["must deny client starts"],
};

function reviewerFinding(planPath, overrides = {}) {
  const lines = readFileSync(planPath, "utf8").split("\n");
  const ref = (line) => ({
    startLine: line,
    endLine: line,
    sha256: sha256Bytes(Buffer.from(lines[line - 1] ?? "", "utf8")),
  });
  return {
    classification: "blocker",
    requirementId: "IS-1",
    predicateId: "gateway-access-order",
    boundaryId: "gateway",
    failureClass: "contradiction",
    evidenceRefs: [ref(WITNESS.lineA), ref(WITNESS.lineB)],
    witness: WITNESS,
    note: "fixture blocker remains at the plan boundary",
    ...overrides,
  };
}

function reviewerRejection(planPath, predicateId = null) {
  const overrides = predicateId ? { predicateId, newKeyReason: "regression" } : {};
  const blocker = reviewerFinding(planPath, overrides);
  const duplicate = reviewerFinding(planPath, { ...overrides, classification: "duplicate" });
  const outOfScope = reviewerFinding(planPath, { ...overrides, requirementId: "IS-9", classification: "out-of-scope" });
  const insufficient = reviewerFinding(planPath, {
    ...overrides,
    classification: "insufficient-evidence",
    evidenceRefs: [{ startLine: WITNESS.lineA, endLine: WITNESS.lineA, sha256: "0".repeat(64) }],
  });
  const raw = JSON.stringify({
    verdict: "REJECT",
    findings: [blocker, duplicate, outOfScope, insufficient],
  });
  const span = [0, Buffer.byteLength(raw, "utf8")];
  for (const finding of [blocker, duplicate, outOfScope, insufficient]) {
    finding.responseSpan = span;
    finding.spanTokens = ["IS-1"];
  }
  return JSON.stringify({ verdict: "REJECT", findings: [blocker, duplicate, outOfScope, insufficient] });
}

function writeModels(agent, port) {
  writeFileSync(join(agent, "models.json"), JSON.stringify({
    providers: {
      fake: {
        name: "fake",
        api: "openai-completions",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "fake",
        models: [{
          id: "fake-model",
          name: "fake-model",
          reasoning: false,
          contextWindow: 128000,
          maxTokens: 4096,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }, null, 2));
}

const CANDIDATE_CACHE = "C:/Users/USER/AppData/Local/Temp/prc-host-VA1OpN/candidate-package";

function preparePackage({ variant }) {
  if (variant === "stock") {
    // The stock host is the installed package, read-only.  Isolation comes from
    // the fresh home/agent/workspace, not from copying 2 GB per case.
    return { packageRoot: DEFAULT_PATHS.packageRoot, mode: "stock-install" };
  }
  if (!existsSync(join(CANDIDATE_CACHE, "bin", "omo.js"))) {
    cpSync(DEFAULT_PATHS.packageRoot, CANDIDATE_CACHE, { recursive: true });
  }
  const hostPath = join(CANDIDATE_CACHE, "plugin", "extensions", "omo-task.js");
  const lockPath = join(CANDIDATE_CACHE, ".prepare.lock");
  const deadline = Date.now() + 10000;
  let fd = null;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        try { rmSync(lockPath, { force: true }); } catch { /* stale lock */ }
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    copyFileSync(DEFAULT_PATHS.host, hostPath);
    writePatchedHost({
      hostPath,
      extensionPath: fileURLToPath(new URL("../../extension.mjs", import.meta.url)),
      outPath: hostPath,
    });
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
  return { packageRoot: CANDIDATE_CACHE, mode: "candidate-cache" };
}

/**
 * steps drive the parent model:
 *   { kind: "review" } | { kind: "reviewBatch" } | { kind: "edit" }
 *   { kind: "executor", forged: null | string }
 * verdicts are consumed by review children in order.
 */
export async function runHostCase({
  name,
  variant = "candidate",
  steps = [{ kind: "review" }],
  verdicts = ["OKAY"],
  reviewerPredicates = [],
  explicitLimit = 5,
  ownerTranscript = null,
  reviewBackground = false,
  workspacePath = null,
  reuse = null,
  continueSession = false,
  freshSession = false,
  sharedState = false,
  prompt = null,
  leadSubmissionExtra = null,
  reviewerNoRead = false,
  keep = false,
  timeoutMs = 90000,
} = {}) {
  const reuseMode = Boolean(reuse);
  const root = reuseMode ? reuse.tempRoot : mkdtempSync(join(tmpdir(), `prc-${name.replace(/[^\w-]/gu, "-")}-`));
  const home = reuseMode ? join(root, "home") : join(root, "home");
  const agent = reuseMode
    ? (sharedState ? join(home, ".omo", `agent-${randomUUID().slice(0, 8)}`) : reuse.agentDir)
    : join(home, ".omo", "agent");
  const workspace = reuseMode ? reuse.workspace : (workspacePath ?? join(root, "workspace"));
  const stateRoot = reuseMode ? reuse.stateRoot : join(root, "state");
  const gateLog = reuseMode
    ? join(root, sharedState ? `gate-${randomUUID().slice(0, 8)}.log` : "gate.log")
    : join(root, "gate.log");
  const writeLog = join(root, `write-attempts-${sharedState ? randomUUID().slice(0, 8) : "main"}.jsonl`);
  mkdirSync(join(workspace, ".omo", "plans"), { recursive: true });
  mkdirSync(agent, { recursive: true });
  const planPath = reuseMode ? reuse.planPath : join(workspace, ".omo", "plans", "fixture-plan.md");
  if (!reuseMode && !workspacePath) writeFileSync(planPath, planText(), "utf8");
  const initialSha = sha256Bytes(readFileSync(planPath));
  if (!reuseMode || sharedState) writeAgentFiles(home, agent);
  const prepared = reuseMode
    ? { packageRoot: reuse.host.packageRoot, mode: reuse.host.packageMode }
    : preparePackage({ variant });
  const packageRoot = prepared.packageRoot;
  const sessionId = reuseMode
    ? (freshSession ? `case-${randomUUID().slice(0, 8)}` : reuse.sessionId)
    : `case-${randomUUID().slice(0, 8)}`;
  const doneMarker = `PARENT-DONE-${randomUUID().slice(0, 8)}`;
  const env = childEnv({ home, agent, workspace, stateRoot, gateLog, sessionId, ownerTranscript, writeLog });
  env.PRC_WRITE_LOG = writeLog;
  env.PRC_WRITE_ROOT = root;
  writeFileSync(writeLog, "", "utf8");

  let parentCalls = 0;
  let parentReadPlan = false;
  let reviewChildCalls = 0;
  let verdictIndex = 0;
  let findingsSubmitted = false;
  const planEdits = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (data) => { body += data; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* an empty body is not a model turn */ }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const textOf = (message) => typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((part) => (part?.type === "text" ? part.text : JSON.stringify(part))).join("\n")
          : JSON.stringify(message.content ?? "");
      const text = messages.map(textOf).join("\n");
      const userText = messages.filter((message) => message?.role === "user").map(textOf).at(-1) ?? "";
      const isExecutorTurn = userText.length < 4000
        && /(?:^|\n)execute plan\s+\S+/u.test(userText);
      const isReviewer = !isExecutorTurn
        && (/You are a \*\*practical\*\* work plan reviewer/u.test(text)
          || /You are a practical work plan reviewer/u.test(text));
      if (isReviewer) {
        reviewChildCalls += 1;
        const readDone = messages.some((message) =>
          message?.role === "toolResult" || message?.role === "tool");
        if (!readDone && !reviewerNoRead) {
          return sseCalls(res, [{
            id: `call_child_read_${reviewChildCalls}`,
            name: "read",
            arguments: { path: planPath },
          }]);
        }
        const verdict = verdicts[Math.min(verdictIndex, verdicts.length - 1)] ?? "OKAY";
        verdictIndex += 1;
        if (verdict === "REJECT") {
          const predicate = reviewerPredicates[Math.min(verdictIndex - 1, reviewerPredicates.length - 1)] ?? null;
          return sseText(res, reviewerRejection(planPath, predicate));
        }
        return sseText(res, "[OKAY]\n\nThe plan is executable.");
      }
      if (isExecutorTurn) {
        return sseText(res, "EXECUTOR-DONE");
      }
      const lastMessage = messages.at(-1);
      const lastTool = [...messages].reverse().find((message) => message?.role === "toolResult" || message?.role === "tool");
      const lastToolText = lastTool ? textOf(lastTool) : "";
      const findingsRequest = /\[PRC_FINDINGS_REQUEST task=([^\s\]]+) snapshot=([0-9a-f]{64}) submit=([^\s\]]+)\]/u.exec(lastToolText);
      if (findingsRequest && !findingsSubmitted) {
        const [, taskId, snapshotSha, submitPath] = findingsRequest;
        const receiptDir = join(stateRoot, "receipts");
        let receipt = null;
        if (existsSync(receiptDir)) {
          for (const entry of readdirSync(receiptDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
            try {
              const document = JSON.parse(readFileSync(join(receiptDir, entry.name), "utf8"));
              if (document?.receipt?.taskId === taskId) receipt = document.receipt;
            } catch { /* partial */ }
          }
        }
        if (receipt) {
          const proposals = [
            ...JSON.parse(reviewerRejection(planPath)).findings,
            ...(Array.isArray(leadSubmissionExtra) ? leadSubmissionExtra : []),
          ];
          mkdirSync(dirname(submitPath), { recursive: true });
          writeFileSync(submitPath, `${JSON.stringify({
            schema: LEAD_SUBMISSION_SCHEMA,
            W: receipt.W,
            launchKey: receipt.launchKey,
            taskId: receipt.taskId,
            receiptRef: receipt.taskId,
            reviewedSha: receipt.reviewedBodySha256,
            responseSha256: receipt.responseSha256,
            findings: proposals,
          }, null, 2)}\n`, "utf8");
          findingsSubmitted = true;
        }
      }
      if (!parentReadPlan) {
        parentReadPlan = true;
        return sseCalls(res, [{
          id: "call_parent_read_plan",
          name: "read",
          arguments: { path: planPath },
        }]);
      }
      parentCalls += 1;
      if (parentCalls > steps.length) return sseText(res, doneMarker);
      const step = steps[parentCalls - 1];
      if (step.kind === "review") {
        return sseCalls(res, [{
          id: `call_parent_review_${parentCalls}`,
          name: "task",
          arguments: {
            subagent_type: "plan-reviewer",
            prompt: planPath,
            task_summary: "native review",
            description: "native review",
            run_in_background: reviewBackground,
          },
        }]);
      }
      if (step.kind === "reviewBatch") {
        return sseCalls(res, [1, 2].map((index) => ({
          id: `call_parent_batch_${parentCalls}_${index}`,
          name: "task",
          arguments: {
            subagent_type: "plan-reviewer",
            prompt: planPath,
            task_summary: `native batch review ${index}`,
            description: `native batch review ${index}`,
            run_in_background: false,
          },
        })));
      }
      if (step.kind === "edit") {
        const current = readFileSync(planPath, "utf8");
        const next = `${current}\n- [ ] ${planEdits.length + 2}. Fix applied for the reviewed blocker\n`;
        planEdits.push({ sha256: sha256Bytes(Buffer.from(next, "utf8")), at: new Date().toISOString() });
        return sseCalls(res, [{
          id: `call_parent_edit_${parentCalls}`,
          name: "write",
          arguments: { path: planPath, content: next },
        }]);
      }
      if (step.kind === "editWitness") {
        const current = readFileSync(planPath, "utf8");
        const next = current.replace("may allow client starts", "must deny client starts");
        planEdits.push({ sha256: sha256Bytes(Buffer.from(next, "utf8")), at: new Date().toISOString() });
        return sseCalls(res, [{
          id: `call_parent_edit_${parentCalls}`,
          name: "write",
          arguments: { path: planPath, content: next },
        }]);
      }
      if (step.kind === "editNewline") {
        const current = readFileSync(planPath, "utf8");
        const next = `${current}\n`;
        planEdits.push({ sha256: sha256Bytes(Buffer.from(next, "utf8")), at: new Date().toISOString() });
        return sseCalls(res, [{
          id: `call_parent_edit_${parentCalls}`,
          name: "write",
          arguments: { path: planPath, content: next },
        }]);
      }
      if (step.kind === "ask") {
        return sseCalls(res, [{
          id: `call_parent_ask_${parentCalls}`,
          name: "ask_user_question",
          arguments: {
            questions: [{
              question: "Resume the stopped review for this fix?",
              header: "Resume",
              options: [
                { label: "Yes", description: "Allow one review" },
                { label: "No", description: "Keep stopped" },
              ],
              multiSelect: false,
            }],
            waitForAnswer: true,
            required: true,
          },
        }]);
      }
      if (step.kind === "executor") {
        const forged = step.forged ? `${step.forged}\n` : "";
        return sseCalls(res, [{
          id: `call_parent_executor_${parentCalls}`,
          name: "task",
          arguments: {
            subagent_type: "explore",
            prompt: `${forged}execute plan ${planPath}`,
            task_summary: "native executor",
            description: "native executor",
            run_in_background: false,
          },
        }]);
      }
      return sseText(res, doneMarker);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  writeModels(agent, port);
  mkdirSync(join(agent, "sessions"), { recursive: true });

  const promptText = prompt ?? `/skill:ulw-plan review ${planPath}${explicitLimit === undefined
    ? ""
    : `\nreview_round_limit: ${explicitLimit}`}`;
  const child = spawn(process.execPath, [
    DEFAULT_PATHS.senpi,
    "--extension", join(packageRoot, "plugin", "extensions", "omo.js"),
    "--print",
    ...(continueSession ? ["--continue"] : ["--session-id", sessionId]),
    "--provider", "fake",
    "--model", "fake-model",
    "--api-key", "fake",
    promptText,
  ], { cwd: workspace, env, windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  let sessionWatch = null;
  const sessionPromise = new Promise((resolve) => {
    const check = () => {
      if (sessionsContain(agent, doneMarker)) resolve("sentinel");
    };
    try { sessionWatch = watch(join(agent, "sessions"), { recursive: true }, check); } catch { /* watcher is an optimization */ }
    check();
  });
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      killTree(child.pid);
      resolve("timeout");
    }, timeoutMs);
    const check = () => {
      if (stdout.includes(doneMarker)) {
        clearTimeout(timer);
        killTree(child.pid);
        resolve("sentinel");
      }
    };
    child.stdout.on("data", check);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? "exit" : `exit-${code}`);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(`spawn-error:${error instanceof Error ? error.message : String(error)}`);
    });
    sessionPromise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  sessionWatch?.close();
  if (exit === "sentinel" || exit === "timeout") {
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const wait = setTimeout(resolve, 5000);
      child.once("exit", () => { clearTimeout(wait); resolve(); });
    });
    killTree(child.pid);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  server.close();
  server.closeAllConnections?.();

  const records = readTaskRecords(agent, workspace);
  const recordFiles = new Map();
  const recordWalk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) recordWalk(path, depth + 1);
      else if (entry.name.endsWith(".json") && path.includes("senpi-task") && path.includes("tasks")) {
        try {
          const parsed = JSON.parse(readFileSync(path, "utf8"));
          if (parsed.task_id) recordFiles.set(parsed.task_id, path);
        } catch { /* partial */ }
      }
    }
  };
  recordWalk(join(agent, "projects"), 0);
  recordWalk(join(workspace, ".omo", "senpi-task", "tasks"), 0);
  const snapshots = [];
  const snapshotDir = join(stateRoot, "snapshots");
  if (existsSync(snapshotDir)) {
    for (const file of readdirSync(snapshotDir)) {
      if (!file.endsWith(".md")) continue;
      const bytes = readFileSync(join(snapshotDir, file));
      snapshots.push({
        ref: `snapshots/${file}`,
        sha256: sha256Bytes(bytes),
        bytes: bytes.length,
        sidecar: existsSync(join(snapshotDir, file.replace(/\.md$/u, ".json")))
          ? JSON.parse(readFileSync(join(snapshotDir, file.replace(/\.md$/u, ".json")), "utf8"))
          : null,
      });
    }
  }
  const key = logicalKey({ workspaceId: "ws-fixture", workspaceRoot: workspace, planPath }).key;
  let state = null;
  try { state = readState(stateRoot, key); } catch { state = null; }
  const receipts = [];
  const receiptDir = join(stateRoot, "receipts");
  if (existsSync(receiptDir)) {
    for (const file of readdirSync(receiptDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        receipts.push({ file, document: JSON.parse(readFileSync(join(receiptDir, file), "utf8")) });
      } catch {
        receipts.push({ file, document: null });
      }
    }
  }
  const questions = [];
  const questionDir = join(stateRoot, "resume-questions");
  if (existsSync(questionDir)) {
    for (const file of readdirSync(questionDir)) {
      if (!file.endsWith(".json")) continue;
      try { questions.push(JSON.parse(readFileSync(join(questionDir, file), "utf8"))); } catch { /* partial */ }
    }
  }
  const findings = [];
  const findingsDir = join(stateRoot, "findings");
  if (existsSync(findingsDir)) {
    for (const file of readdirSync(findingsDir)) {
      if (!file.endsWith(".json")) continue;
      try { findings.push(JSON.parse(readFileSync(join(findingsDir, file), "utf8"))); } catch { /* partial */ }
    }
  }
  const sessionDir = join(agent, "sessions");
  let sessionFile = null;
  const findSession = (dir, depth) => {
    if (sessionFile || depth > 4 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) findSession(path, depth + 1);
      else if (entry.name.endsWith(".jsonl") && entry.name.includes(sessionId)) sessionFile = path;
    }
  };
  findSession(sessionDir, 0);
  const sessionText = sessionFile ? readFileSync(sessionFile, "utf8") : "";
  const gateLogLines = existsSync(gateLog)
    ? readFileSync(gateLog, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return { event: "unparsed", line }; }
    })
    : [];
  const denials = [...new Set([
    ...gateLogLines.filter((line) => line.event === "deny").map((line) => String(line.reason).split(/\s/u)[0]),
    ...[...sessionText.matchAll(/PRC_[A-Z_]+/gu)].map((match) => match[0]),
  ])];
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const hostText = readFileSync(join(packageRoot, "plugin", "extensions", "omo-task.js"));
  const writeAttempts = existsSync(writeLog)
    ? readFileSync(writeLog, "utf8").split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    })
    : [];
  const outsideAttempts = writeAttempts.filter((entry) => entry.inside === false);
  const report = {
    caseId: name,
    variant,
    sessionId,
    planPath,
    planSha256: initialSha,
    planEdits,
    finalPlanSha256: existsSync(planPath) ? sha256Bytes(readFileSync(planPath)) : null,
    exit,
    host: {
      packageRoot,
      isolated: true,
      packageMode: prepared.mode,
      version: packageJson.version,
      hostSha256: sha256Bytes(hostText),
      patched: variant === "candidate",
    },
    taskRecords: records.map((record) => ({
      task_id: record.task_id,
      child_session_id: record.child_session_id,
      parent_session_id: record.parent_session_id,
      agent_type: record.agent_type,
      execution_mode: record.execution_mode,
      status: record.status,
      created_at: record.created_at,
      terminal_at: record.terminal_at,
      spawn_prompt: record.spawn_spec?.prompt ?? null,
      final_response: record.final_response ?? null,
    })),
    taskRecordFiles: [...recordFiles.entries()].map(([taskId, file]) => ({ taskId, file })),
    snapshots,
    childReceiptIds: records.map((record) => record.task_id),
    reviewerTaskIds: records.filter((record) => record.agent_type === "plan-reviewer").map((record) => record.task_id),
    executorTaskIds: records.filter((record) => record.agent_type !== "plan-reviewer").map((record) => record.task_id),
    state,
    receipts,
    questions,
    findings,
    gateLog: gateLogLines,
    denials,
    denialMessages: gateLogLines.filter((line) => line.event === "deny"),
    sessionFile,
    sessionSha256: sessionFile ? sha256Bytes(readFileSync(sessionFile)) : null,
    ownerTranscript: ownerTranscript
      ? { path: ownerTranscript, sha256: sha256Bytes(readFileSync(ownerTranscript)) }
      : null,
    agentDir: keep ? agent : null,
    stateRoot: keep ? stateRoot : null,
    workspace: keep ? workspace : null,
    stdoutTail: stdout.slice(-2000),
    stderrTail: stderr.slice(-2000),
    externalWrites: {
      attempts: writeAttempts.length,
      outsideAttempts: outsideAttempts.length,
      outside: outsideAttempts.slice(0, 40),
      ops: Object.fromEntries(Object.entries(writeAttempts.reduce((counts, entry) => {
        counts[entry.op] = (counts[entry.op] ?? 0) + 1;
        return counts;
      }, {}))),
    },
    tempRoot: keep ? root : null,
  };
  if (!keep) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* disposable */ }
  }
  return report;
}
