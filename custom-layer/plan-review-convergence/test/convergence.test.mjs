import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ConvergenceLedger, contradictionPresent, sha256Bytes } from "../convergence.mjs";

const H = "C:/Users/USER/orca/projects/기타 작업";
const SESSION = H + "/.omo/senpi-task/children/st_01a203eb/sessions/st_01a203eb/2026-11-22T15-41-55-325Z_01a203eb-cefd-7e94-b497-ba10b6ecf823.jsonl";
const TASK = H + "/.omo/senpi-task/tasks/st_01a203eb.json";
const R83_SHA = "ab92ce5d927336a74dfdddd4c404db8e08ae7f378fcf0dd59e07245fe02ec5d1";
const R83_RESPONSE_SHA = "d7dc7e845742424ac7c0908fc67ec315f5e039252e23290728eec577682d5a62";

function buildSnapshot() {
  const records = readFileSync(SESSION, "utf8").split(/\r?\n/u);
  const picks = [[12, 207], [20, 107], [21, 81], [29, 15], [22, 47], [27, 38], [23, 80], [28, 5], [24, 72]];
  const parts = picks.map(([line, count]) => {
    const record = JSON.parse(records[line - 1]);
    const text = record.message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    return text.split("\n").slice(0, count).join("\n");
  });
  const text = parts.join("\n");
  return { text, sha256: sha256Bytes(Buffer.from(text, "utf8")) };
}

const snapshot = buildSnapshot();
const actual = JSON.parse(readFileSync(TASK, "utf8"));
const raw = actual.final_response;
const lines = snapshot.text.split("\n");

function ref(line) {
  return {
    startLine: line,
    endLine: line,
    sha256: sha256Bytes(Buffer.from(lines[line - 1], "utf8")),
  };
}

const start = Buffer.byteLength(raw.slice(0, raw.indexOf("IS-4")), "utf8");
const end = Buffer.byteLength(raw.slice(0, raw.indexOf("Choose one boundary")), "utf8");
const witness = {
  kind: "contradiction",
  subject: "gateway-client",
  action: "open",
  state: "descriptor-restoration",
  expectedA: "allow",
  expectedB: "deny",
  lineA: 544,
  lineB: 563,
  lineC: 567,
  tokensA: ["allow DB data access", "maintenance SID"],
  tokensB: ["prevent background Gateway starts", "client admissions"],
};
const finding = {
  receiptRef: actual.task_id,
  responseSpan: [start, end],
  spanTokens: ["IS-4", "line 544", ":563", "line 567"],
  requirementId: "IS-4",
  predicateId: "gateway-access-order",
  boundaryId: "gateway",
  failureClass: "contradiction",
  evidenceRefs: [ref(544), ref(563), ref(567)],
  witness,
};
const receipt = {
  id: "r83",
  W: "upgrade",
  roundId: "r83",
  taskId: actual.task_id,
  childSessionId: actual.child_session_id,
  planSha256: R83_SHA,
  responseSha256: R83_RESPONSE_SHA,
  rawResponseUtf8: raw,
};

test("the r83 snapshot and response reconstruct to the recorded hashes", () => {
  assert.equal(snapshot.sha256, R83_SHA);
  assert.equal(sha256Bytes(Buffer.from(raw, "utf8")), R83_RESPONSE_SHA);
  assert.equal(lines.length, 652);
  assert.equal(contradictionPresent(snapshot, witness), true);
});

test("progress-revised-sha: the actual finding becomes one blocker key", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  const round = ledger.startRound({ receipt, snapshot, findings: [finding] });
  assert.equal(round.status, "changes_requested");
  assert.equal(round.findings.length, 1);
  assert.equal(round.findings[0].classification, "actual-blocker");
  assert.equal(round.findings[0].display, "실제 차단");
  assert.equal(round.findings[0].causeKey, "IS-4|gateway-access-order|gateway|contradiction");
  assert.equal(round.openKeys.length, 1);
  assert.equal(round.autoProgress, 0);
  assert.ok(ledger.reject);
});

test("progress-duplicate-scope: duplicates, other plans, out-of-scope, and forged citations do not add keys", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  const round = ledger.startRound({ receipt, snapshot, findings: [finding] });
  const causeKey = round.findings[0].causeKey;

  const duplicate = ledger.addRound({
    receipt,
    snapshot,
    findings: [{ ...finding, responseSpan: [start, end - 1] }],
  });
  assert.equal(duplicate.findings[0].classification, "duplicate");
  assert.equal(duplicate.findings[0].duplicateOf, causeKey);
  assert.equal(duplicate.openKeys.length, 1);

  const otherPlan = ledger.addRound({
    receipt: { ...receipt, W: "other" },
    snapshot,
    findings: [finding],
  });
  assert.equal(otherPlan.findings[0].classification, "out-of-scope");

  const outOfScope = ledger.addRound({
    receipt,
    snapshot,
    findings: [{ ...finding, requirementId: "IS-9" }],
  });
  assert.equal(outOfScope.findings[0].classification, "out-of-scope");

  const forged = ledger.addRound({
    receipt,
    snapshot,
    findings: [{ ...finding, evidenceRefs: [{ ...ref(544), sha256: "0".repeat(64) }] }],
  });
  assert.equal(forged.findings[0].classification, "evidence-unconfirmed");

  const badSnapshot = ledger.addRound({
    receipt: { ...receipt, planSha256: "0".repeat(64) },
    snapshot,
    findings: [finding],
  });
  assert.equal(badSnapshot.findings[0].classification, "evidence-unconfirmed");
  assert.equal(ledger.open.size, 1);
});

test("a new key after the baseline needs an explicit regression reason", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  ledger.startRound({ receipt, snapshot, findings: [finding] });
  const newKey = { ...finding, predicateId: "resume-order" };
  const denied = ledger.addRound({ receipt, snapshot, findings: [newKey] });
  assert.equal(denied.findings[0].classification, "out-of-scope");
  const allowed = ledger.addRound({
    receipt,
    snapshot,
    findings: [{ ...newKey, newKeyReason: "regression" }],
  });
  assert.equal(allowed.findings[0].classification, "actual-blocker");
  assert.equal(allowed.openKeys.length, 2);
});

test("resolve requires the same witness to fail before and pass after a new SHA", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  const round = ledger.startRound({ receipt, snapshot, findings: [finding] });
  const causeKey = round.findings[0].causeKey;

  const revisedLines = [...lines];
  revisedLines[543] = revisedLines[543].replace("allow DB data access", "block DB data access");
  const revisedText = revisedLines.join("\n");
  const revisedSnapshot = { text: revisedText, sha256: sha256Bytes(Buffer.from(revisedText, "utf8")) };
  assert.equal(contradictionPresent(revisedSnapshot, witness), false);

  const resolved = ledger.resolve({
    causeKey,
    witness,
    revisedSnapshot,
    revisedSha: revisedSnapshot.sha256,
  });
  assert.equal(resolved.ok, true);
  assert.equal(ledger.closed.size, 1);
  assert.equal(ledger.autoEligibility({
    newSha: revisedSnapshot.sha256,
    previousSha: R83_SHA,
    budgetRemaining: 1,
    stopped: false,
    goalOk: true,
    scopeOk: true,
    hasProgress: true,
  }).allow, true);

  const again = ledger.addRound({ receipt, snapshot, findings: [finding] });
  assert.equal(again.findings[0].classification, "duplicate");

  const hashOnly = { ...snapshot, text: `${snapshot.text}\n<!-- hash-only change -->` };
  hashOnly.sha256 = sha256Bytes(Buffer.from(hashOnly.text, "utf8"));
  const unresolved = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  const unresolvedRound = unresolved.startRound({ receipt, snapshot, findings: [finding] });
  const hashOnlyResult = unresolved.resolve({
    causeKey: unresolvedRound.findings[0].causeKey,
    witness,
    revisedSnapshot: hashOnly,
    revisedSha: hashOnly.sha256,
  });
  assert.equal(hashOnlyResult.ok, false);
  assert.equal(hashOnlyResult.reason, "STILL_PRESENT");
});

test("autoEligibility stops on no progress, same SHA, budget, stop, and scope drift", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  assert.equal(ledger.autoEligibility({
    newSha: "new",
    previousSha: R83_SHA,
    budgetRemaining: 1,
    stopped: false,
    goalOk: true,
    scopeOk: true,
    hasProgress: false,
  }).reason, "STOP_NO_PROGRESS");

  const resolved = new ConvergenceLedger({ W: "upgrade", planSha256: R83_SHA });
  resolved.startRound({ receipt, snapshot, findings: [finding] });
  const revisedLines = [...lines];
  revisedLines[543] = revisedLines[543].replace("allow DB data access", "block DB data access");
  const revisedText = revisedLines.join("\n");
  const revisedSnapshot = { text: revisedText, sha256: sha256Bytes(Buffer.from(revisedText, "utf8")) };
  resolved.resolve({
    causeKey: [...resolved.open.keys()][0],
    witness,
    revisedSnapshot,
    revisedSha: revisedSnapshot.sha256,
  });
  const base = {
    newSha: revisedSnapshot.sha256,
    previousSha: R83_SHA,
    budgetRemaining: 1,
    stopped: false,
    goalOk: true,
    scopeOk: true,
    hasProgress: true,
  };
  assert.equal(resolved.autoEligibility({ ...base, newSha: R83_SHA }).reason, "STOP_NO_NEW_SHA");
  assert.equal(resolved.autoEligibility({ ...base, budgetRemaining: 0 }).reason, "STOP_BUDGET");
  assert.equal(resolved.autoEligibility({ ...base, stopped: true }).reason, "STOPPED");
  assert.equal(resolved.autoEligibility({ ...base, scopeOk: false }).reason, "STOP_SCOPE");
});
