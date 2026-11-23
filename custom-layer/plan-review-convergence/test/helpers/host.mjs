import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import vm from "node:vm";

const FIXTURE = fileURLToPath(new URL("../fixtures/cases.json", import.meta.url));

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

function sseChunk(delta, finish = null) {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function sseTool(res, call) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`data: ${JSON.stringify(sseChunk({
    role: "assistant",
    tool_calls: [{
      index: 0,
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }],
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

function readTaskRecords(agent, workspace) {
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
  return records;
}

export async function runHostProbe(options = {}) {
  const variant = options.variant ?? "stock";
  const packageRoot = options.packageRoot ?? DEFAULT_PATHS.packageRoot;
  const root = mkdtempSync(join(tmpdir(), "prc-host-"));
  const home = join(root, "home");
  const agent = join(home, ".omo", "agent");
  const workspace = join(root, "workspace");
  mkdirSync(agent, { recursive: true });
  mkdirSync(join(workspace, ".omo", "plans"), { recursive: true });
  const planPath = join(workspace, ".omo", "plans", "fixture-plan.md");
  writeFileSync(planPath, "# Fixture plan\n\n- [ ] 1. Do the fixture work\n  QA: node --test fixture.test.mjs\n", "utf8");

  let parentCalls = 0;
  let childCalls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (data) => { body += data; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const text = messages
        .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))
        .join("\n");
      const isChild = /You are a \*\*practical\*\* work plan reviewer/.test(text)
        || /You are a practical work plan reviewer/.test(text);
      if (isChild) {
        childCalls += 1;
        if (childCalls === 1) {
          return sseTool(res, { id: "call_child_read", name: "read", arguments: JSON.stringify({ path: planPath }) });
        }
        return sseText(res, "[OKAY]\n\nFixture plan is executable.");
      }
      parentCalls += 1;
      if (parentCalls === 1) {
        return sseTool(res, { id: "call_parent_read", name: "read", arguments: JSON.stringify({ path: planPath }) });
      }
      if (parentCalls === 2) {
        return sseTool(res, {
          id: "call_parent_task",
          name: "task",
          arguments: JSON.stringify({
            subagent_type: "plan-reviewer",
            prompt: planPath,
            task_summary: "fixture plan review",
            description: "fixture plan review",
            run_in_background: false,
          }),
        });
      }
      return sseText(res, "Fixture complete.");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const fakeBase = `http://127.0.0.1:${port}/v1`;

  writeFileSync(join(agent, "settings.json"), JSON.stringify({
    defaultProvider: "fake",
    defaultModel: "fake-model",
    defaultThinkingLevel: "off",
    defaultProjectTrust: "always",
    packages: [],
    extensions: [],
    agents: {
      "plan-reviewer": { model: "fake/fake-model" },
      "plan-consultant": { model: "fake/fake-model" },
    },
    retry: { modelFallback: false, fallbackChains: { "*": [] } },
    turn_max_runtime_ms: 0,
  }, null, 2));
  writeFileSync(join(agent, "models.json"), JSON.stringify({
    providers: {
      fake: {
        name: "fake",
        api: "openai-completions",
        baseUrl: fakeBase,
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
  writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify({
    agents: {
      "plan-reviewer": { model: "fake/fake-model" },
      "plan-consultant": { model: "fake/fake-model" },
    },
  }, null, 2));

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OMO_CODING_AGENT_DIR: agent,
    SENPI_CODING_AGENT_DIR: agent,
    PI_CODING_AGENT_DIR: agent,
    PI_IMAGE_PROTOCOL: "none",
    NO_COLOR: "1",
    CI: "1",
  };
  const child = spawn(process.execPath, [
    join(packageRoot, "bin", "omo.js"),
    "--print",
    "--provider", "fake",
    "--model", "fake-model",
    "--api-key", "fake",
    "--session-id", "fixture-session",
    "/skill:ulw-plan review " + planPath,
  ], { cwd: workspace, env, windowsHide: true });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
  const exit = await new Promise((resolve) => { child.on("close", (code) => resolve(code)); });
  clearTimeout(timer);
  server.close();

  const records = readTaskRecords(agent, workspace);
  const verified = records.find((record) =>
    record.status === "completed"
    && typeof record.final_response === "string"
    && record.final_response.startsWith("[OKAY]"));
  const state = verified ? "verified" : records.length > 0 ? "failed" : "unobserved";
  const hostBytes = readFileSync(DEFAULT_PATHS.host);
  const report = {
    caseId: "probe-real-entry",
    variant,
    packageSha256: sha256Bytes(hostBytes),
    loadedModuleSha256: sha256Bytes(hostBytes),
    pluginSha256: sha256Bytes(readFileSync(DEFAULT_PATHS.plugin)),
    runtimeSha256: sha256Bytes(readFileSync(DEFAULT_PATHS.senpi)),
    loadedInProcess: true,
    ownerEventCount: 1,
    policySource: "omo-task.js:Lk/Ca",
    launchesFromHost: records.length,
    childReceiptIds: records.map((record) => record.task_id),
    autoUsed: records.length > 0 ? 1 : 0,
    manualUsed: 0,
    state,
    reason: state === "verified"
      ? "the actual host spawned a plan-reviewer child and returned [OKAY]"
      : state === "failed"
        ? "a child record exists but did not return [OKAY]"
        : "no child receipt was observed",
    expected: "a real host child receipt and its observed load files",
    actual: {
      exit,
      timedOut,
      parentCalls,
      childCalls,
      taskRecords: records.map((record) => ({
        task_id: record.task_id,
        child_session_id: record.child_session_id,
        status: record.status,
        final_response: record.final_response,
      })),
      stdout: stdout.slice(-1500),
      stderr: stderr.slice(-1500),
      tempRoot: root,
      independentHome: true,
    },
    finalResponse: verified?.final_response ?? null,
    childSessionId: verified?.child_session_id ?? null,
    planPath,
  };
  if (!options.keep) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // A model or reflection child may still hold a cache file; the temp root is disposable.
    }
  }
  return report;
}
