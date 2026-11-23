import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const FIXTURE = fileURLToPath(new URL("../fixtures/cases.json", import.meta.url));

export const DEFAULT_PATHS = {
  host: "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.69-r1/package/plugin/extensions/omo-task.js",
  packageJson: "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.69-r1/package/package.json",
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
