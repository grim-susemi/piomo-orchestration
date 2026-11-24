import test from "node:test";
import assert from "node:assert/strict";
import {
  ConvergenceLedger,
  findingKeys,
  nextRoundProgress,
  sha256Bytes,
} from "../convergence.mjs";

// Unit fixtures for the classifier.  The host-path progress evidence (real
// reviewer receipts and real findings) is produced by probe.mjs; these strings
// only exercise the pure classification/key rules.
const RAW = "**[REJECT]**\n\nIS-1 contradicts the gateway start order at line 3 and line 5.\n";
const SNAPSHOT_TEXT = [
  "# Plan",
  "",
  "The gateway may allow client starts while the operator is signed in.", // 3
  "",
  "The launcher must deny client starts until the operator approves.", // 5
  "Task 4 restates the open rule.",
].join("\n");
const snapshot = { text: SNAPSHOT_TEXT, sha256: sha256Bytes(Buffer.from(SNAPSHOT_TEXT, "utf8")) };
const lines = SNAPSHOT_TEXT.split("\n");

function ref(line) {
  return {
    startLine: line,
    endLine: line,
    sha256: sha256Bytes(Buffer.from(lines[line - 1], "utf8")),
  };
}

const start = Buffer.byteLength(RAW.slice(0, RAW.indexOf("IS-1")), "utf8");
const end = Buffer.byteLength(RAW.slice(0, RAW.indexOf("line 5") + "line 5".length), "utf8");
const witness = {
  kind: "contradiction",
  subject: "gateway-client",
  action: "open",
  state: "descriptor-restoration",
  expectedA: "allow",
  expectedB: "deny",
  lineA: 3,
  lineB: 5,
  tokensA: ["may allow client starts"],
  tokensB: ["must deny client starts"],
};
const finding = {
  receiptRef: "st_unit",
  responseSpan: [start, end],
  spanTokens: ["IS-1", "line 3", "line 5"],
  requirementId: "IS-1",
  predicateId: "gateway-access-order",
  boundaryId: "gateway",
  failureClass: "contradiction",
  evidenceRefs: [ref(3), ref(5)],
  witness,
};
const receipt = {
  id: "r90",
  W: "upgrade",
  roundId: "r90",
  taskId: "st_unit",
  childSessionId: "child-unit",
  planSha256: snapshot.sha256,
  reviewedBodySha256: snapshot.sha256,
  responseSha256: sha256Bytes(Buffer.from(RAW, "utf8")),
  rawResponseUtf8: RAW,
  verdict: "REJECT",
  status: "CHANGES_REQUESTED",
  findings: [finding],
};

test("the classifier creates one cause key from the reviewer's structured fields", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: snapshot.sha256 });
  const round = ledger.startRound({ receipt, snapshot, findings: [finding] });
  assert.equal(round.status, "changes_requested");
  assert.equal(round.findings.length, 1);
  assert.equal(round.findings[0].classification, "actual-blocker");
  assert.equal(round.findings[0].display, "실제 차단");
  assert.equal(round.findings[0].causeKey, "IS-1|gateway-access-order|gateway|contradiction");
  assert.equal(round.openKeys.length, 1);
  assert.deepEqual(findingKeys([finding]), ["IS-1|gateway-access-order|gateway|contradiction"]);
});

test("duplicates, other plans, out-of-scope, and forged citations do not add keys", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: snapshot.sha256 });
  const round = ledger.startRound({ receipt, snapshot, findings: [finding] });
  const causeKey = round.findings[0].causeKey;

  const duplicate = ledger.addRound({
    receipt,
    snapshot,
    findings: [{ ...finding, responseSpan: [0, Buffer.byteLength(RAW, "utf8")], spanTokens: ["IS-1"] }],
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
    findings: [{ ...finding, evidenceRefs: [{ ...ref(3), sha256: "0".repeat(64) }] }],
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
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: snapshot.sha256 });
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

test("recordRound keeps a persisted cause key across rounds", () => {
  const ledger = new ConvergenceLedger({ W: "upgrade", planSha256: snapshot.sha256 });
  const first = ledger.recordRound({ receipt, snapshot, findings: [finding] });
  const causeKey = first.findings[0].causeKey;
  const restored = ConvergenceLedger.fromJSON(JSON.parse(JSON.stringify(ledger.toJSON())));
  assert.ok(restored);
  const nextReceipt = { ...receipt, taskId: "st_round2", roundId: "r91" };
  const second = restored.recordRound({
    receipt: nextReceipt,
    snapshot,
    findings: [{ ...finding, receiptRef: "st_round2" }],
  });
  assert.equal(second.findings[0].classification, "duplicate");
  assert.equal(second.findings[0].duplicateOf, causeKey);
  assert.equal(restored.rounds.length, 2);
});

test("next-round progress rejects a recurring blocker key", () => {
  const next = { ...receipt, taskId: "st_round2", roundId: "r91" };
  const result = nextRoundProgress({ reserved: receipt, next, W: "upgrade" });
  assert.equal(result.allow, false);
  assert.equal(result.reason, "SAME_BLOCKER");
  assert.deepEqual(result.sameKeys, ["IS-1|gateway-access-order|gateway|contradiction"]);
});

test("next-round progress allows a different blocker key", () => {
  const next = {
    ...receipt,
    taskId: "st_round2",
    roundId: "r91",
    findings: [{ ...finding, receiptRef: "st_round2", predicateId: "resume-order" }],
  };
  const result = nextRoundProgress({ reserved: receipt, next, W: "upgrade" });
  assert.equal(result.allow, true);
  assert.equal(result.reason, "NEW_BLOCKER_KEYS");
  assert.deepEqual(result.nextKeys, ["IS-1|resume-order|gateway|contradiction"]);
});

test("next-round progress allows an APPROVED next result", () => {
  const next = { status: "APPROVED", verdict: "OKAY", W: "upgrade", findings: [] };
  const result = nextRoundProgress({ reserved: receipt, next, W: "upgrade" });
  assert.equal(result.allow, true);
  assert.equal(result.reason, "APPROVED");
});

test("next-round progress rejects a missing review result", () => {
  const result = nextRoundProgress({ reserved: receipt, next: null, W: "upgrade" });
  assert.equal(result.allow, false);
  assert.equal(result.reason, "NO_REVIEW_RESULT");
});
