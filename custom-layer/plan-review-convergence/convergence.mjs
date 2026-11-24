import { createHash } from "node:crypto";

export const REQUIREMENTS = new Set(["IS-1", "IS-2", "IS-3", "IS-4", "IS-5"]);
export const PREDICATES = new Set([
  "gateway-access-order",
  "resume-order",
  "manual-recovery",
  "receipt-binding",
  "budget-bound",
  "auto-progress",
  "handoff-freshness",
]);
export const BOUNDARIES = new Set(["gateway", "manual-recovery", "budget", "receipt", "handoff", "probe"]);
export const FAILURE_CLASSES = new Set(["contradiction", "regression", "missing-evidence"]);

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function makeCauseKey({ requirementId, predicateId, boundaryId, failureClass }) {
  if (!REQUIREMENTS.has(requirementId)) throw new Error("OUT_OF_SCOPE_REQUIREMENT");
  if (!PREDICATES.has(predicateId)) throw new Error("UNKNOWN_PREDICATE");
  if (!BOUNDARIES.has(boundaryId)) throw new Error("UNKNOWN_BOUNDARY");
  if (!FAILURE_CLASSES.has(failureClass)) throw new Error("UNKNOWN_FAILURE_CLASS");
  return [requirementId, predicateId, boundaryId, failureClass].join("|");
}

function spanText(rawResponse, span) {
  if (!Array.isArray(span) || span.length !== 2) return null;
  const [start, end] = span;
  const bytes = Buffer.from(rawResponse, "utf8");
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > bytes.length) {
    return null;
  }
  const slice = bytes.subarray(start, end);
  const text = slice.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(slice)) return null;
  return text;
}

function verifyEvidence(snapshot, refs) {
  if (!Array.isArray(refs) || refs.length === 0) return false;
  const lines = snapshot.text.split("\n");
  for (const ref of refs) {
    if (!Number.isInteger(ref.startLine) || !Number.isInteger(ref.endLine)) return false;
    if (ref.startLine < 1 || ref.endLine < ref.startLine || ref.endLine > lines.length) return false;
    const segment = lines.slice(ref.startLine - 1, ref.endLine).join("\n");
    if (sha256Bytes(Buffer.from(segment, "utf8")) !== ref.sha256) return false;
  }
  return true;
}

const DISPLAY = {
  "actual-blocker": "실제 차단",
  duplicate: "중복",
  "out-of-scope": "범위 밖",
  "evidence-unconfirmed": "근거 미확인",
};

function result(finding, classification, reason, extra = {}) {
  return {
    ...finding,
    classification,
    display: DISPLAY[classification],
    reason,
    ...extra,
  };
}

/**
 * The reviewer owns the blocker key.  This module never parses the plan text or
 * compares words; it only reads the structured finding fields the reviewer/writer
 * submitted.  A finding with the same key in the next round is the same blocker.
 */
export function findingKeys(findings) {
  const keys = [];
  for (const finding of Array.isArray(findings) ? findings : []) {
    let key = typeof finding?.causeKey === "string" ? finding.causeKey : null;
    if (!key) {
      try {
        key = makeCauseKey(finding ?? {});
      } catch {
        key = null;
      }
    }
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Progress is the next round's review result, not a text judgment.
 *   reserved: the bound REJECT receipt for the round that stopped the loop.
 *   next:     the following reviewer receipt.
 * Same blocker key -> SAME_BLOCKER.  A different key set -> allow.  APPROVED ->
 * allow.  No next receipt/result -> NO_REVIEW_RESULT.
 */
export function nextRoundProgress({ reserved, next, W = null } = {}) {
  if (!reserved) return { allow: false, reason: "NO_BOUND_RECEIPT" };
  if (reserved.status !== "CHANGES_REQUESTED" || reserved.verdict !== "REJECT") {
    return { allow: false, reason: "NO_REJECTION" };
  }
  if (W && reserved.W && reserved.W !== W) return { allow: false, reason: "WORKSPACE_MISMATCH" };
  if (!next) return { allow: false, reason: "NO_REVIEW_RESULT" };
  if (W && next.W && next.W !== W) return { allow: false, reason: "WORKSPACE_MISMATCH" };
  if (next.status === "APPROVED") {
    return { allow: true, reason: "APPROVED", reservedKeys: findingKeys(reserved.findings), nextKeys: findingKeys(next.findings) };
  }
  if (next.status !== "CHANGES_REQUESTED" || next.verdict !== "REJECT") {
    return { allow: false, reason: "NO_REVIEW_RESULT" };
  }
  const keysOf = (value) => {
    const display = findingKeys(value?.findings);
    return display.length > 0 ? display : findingKeys(value?.responseFindings);
  };
  const reservedKeys = keysOf(reserved);
  const nextKeys = keysOf(next);
  if (reservedKeys.length === 0 || nextKeys.length === 0) {
    return { allow: false, reason: "NO_STRUCTURED_FINDINGS", reservedKeys, nextKeys };
  }
  const sameKeys = nextKeys.filter((key) => reservedKeys.includes(key));
  if (sameKeys.length > 0) {
    return { allow: false, reason: "SAME_BLOCKER", sameKeys, reservedKeys, nextKeys };
  }
  return { allow: true, reason: "NEW_BLOCKER_KEYS", reservedKeys, nextKeys };
}

export class ConvergenceLedger {
  constructor({ W, planSha256, requirements = REQUIREMENTS, predicates = PREDICATES, boundaries = BOUNDARIES, failureClasses = FAILURE_CLASSES }) {
    this.W = W;
    this.planSha256 = planSha256;
    this.requirements = requirements;
    this.predicates = predicates;
    this.boundaries = boundaries;
    this.failureClasses = failureClasses;
    this.open = new Map();
    this.baselineBuilt = false;
    this.rounds = [];
  }

  evaluate(finding, receipt, snapshot) {
    if (!receipt || receipt.W !== this.W) return result(finding, "out-of-scope", "PLAN_MISMATCH");
    if (!snapshot || receipt.planSha256 !== snapshot.sha256) {
      return result(finding, "evidence-unconfirmed", "SNAPSHOT_SHA_MISMATCH");
    }
    const raw = receipt.rawResponseUtf8 ?? "";
    if (receipt.responseSha256 !== sha256Bytes(Buffer.from(raw, "utf8"))) {
      return result(finding, "evidence-unconfirmed", "RESPONSE_SHA_MISMATCH");
    }
    if (finding.receiptRef !== receipt.taskId) {
      return result(finding, "evidence-unconfirmed", "RECEIPT_MISMATCH");
    }
    if (!this.requirements.has(finding.requirementId)) {
      return result(finding, "out-of-scope", "REQUIREMENT_OUT_OF_SCOPE");
    }
    if (!this.predicates.has(finding.predicateId)
      || !this.boundaries.has(finding.boundaryId)
      || !this.failureClasses.has(finding.failureClass)) {
      return result(finding, "evidence-unconfirmed", "KEY_NOT_REGISTERED");
    }
    const text = spanText(raw, finding.responseSpan);
    if (text === null || !(finding.spanTokens ?? []).every((token) => text.includes(token))) {
      return result(finding, "evidence-unconfirmed", "RESPONSE_SPAN_MISMATCH");
    }
    if (!verifyEvidence(snapshot, finding.evidenceRefs)) {
      return result(finding, "evidence-unconfirmed", "EVIDENCE_REF_MISMATCH");
    }
    // The reviewer's structured finding is the only source of a blocker key.
    // Contradiction findings still need a structured witness object, but this
    // module does not compare the plan's words or polarity.
    if (finding.failureClass === "contradiction"
      && (!finding.witness || typeof finding.witness !== "object")) {
      return result(finding, "evidence-unconfirmed", "WITNESS_MISSING");
    }
    const causeKey = makeCauseKey(finding);
    if (this.open.has(causeKey)) {
      return result(finding, "duplicate", "CAUSE_KEY_ALREADY_KNOWN", { causeKey, duplicateOf: causeKey });
    }
    if (this.baselineBuilt && !finding.newKeyReason) {
      return result(finding, "out-of-scope", "NEW_KEY_AFTER_BASELINE", { causeKey });
    }
    return result(finding, "actual-blocker", "NEW_CAUSE_KEY", { causeKey });
  }

  startRound({ receipt, snapshot, findings }) {
    this.baselineBuilt = false;
    const evaluated = [];
    for (const finding of findings) {
      const item = this.evaluate(finding, receipt, snapshot);
      if (item.classification === "actual-blocker") this.open.set(item.causeKey, item);
      evaluated.push(item);
    }
    this.baselineBuilt = true;
    this.rounds.push({
      receipt,
      snapshotSha256: snapshot.sha256,
      taskId: receipt?.taskId ?? null,
      roundId: receipt?.roundId ?? null,
      responseSha256: receipt?.responseSha256 ?? null,
      findings: evaluated,
      openKeys: [...this.open.keys()],
    });
    return {
      status: this.open.size === 0 ? "STOP_NO_PROGRESS" : "changes_requested",
      findings: evaluated,
      openKeys: [...this.open.keys()],
      autoProgress: 0,
    };
  }

  addRound({ receipt, snapshot, findings }) {
    if (!this.baselineBuilt) return this.startRound({ receipt, snapshot, findings });
    const evaluated = [];
    for (const finding of findings) {
      const item = this.evaluate(finding, receipt, snapshot);
      if (item.classification === "actual-blocker") this.open.set(item.causeKey, item);
      evaluated.push(item);
    }
    this.rounds.push({
      receipt,
      snapshotSha256: snapshot.sha256,
      taskId: receipt?.taskId ?? null,
      roundId: receipt?.roundId ?? null,
      responseSha256: receipt?.responseSha256 ?? null,
      findings: evaluated,
      openKeys: [...this.open.keys()],
    });
    return {
      status: this.open.size === 0 ? "STOP_NO_PROGRESS" : "changes_requested",
      findings: evaluated,
      openKeys: [...this.open.keys()],
      autoProgress: 0,
    };
  }

  /**
   * The single production entry point for a receipt.  The first round builds the
   * baseline; every later round is added to the same ledger so a persisted key
   * keeps its identity across rounds instead of being re-created per call.
   */
  recordRound({ receipt, snapshot, findings }) {
    return this.baselineBuilt
      ? this.addRound({ receipt, snapshot, findings })
      : this.startRound({ receipt, snapshot, findings });
  }

  roundForReceipt(taskId, responseSha256) {
    if (!taskId) return null;
    const round = [...this.rounds].reverse().find((entry) => entry.taskId === taskId
      && (responseSha256 === undefined || entry.responseSha256 === responseSha256));
    if (!round) return null;
    return {
      status: round.openKeys.length === 0 ? "STOP_NO_PROGRESS" : "changes_requested",
      findings: round.findings,
      openKeys: round.openKeys,
      autoProgress: 0,
    };
  }

  openKeys() {
    return [...this.open.keys()];
  }

  toJSON() {
    return {
      schema: "plan-review-convergence/convergence-ledger/v2",
      W: this.W,
      planSha256: this.planSha256,
      baselineBuilt: this.baselineBuilt,
      open: [...this.open.entries()].map(([causeKey, item]) => ({ causeKey, item })),
      rounds: this.rounds.map((round) => ({
        taskId: round.taskId ?? round.receipt?.taskId ?? null,
        roundId: round.roundId ?? round.receipt?.roundId ?? null,
        responseSha256: round.responseSha256 ?? round.receipt?.responseSha256 ?? null,
        snapshotSha256: round.snapshotSha256 ?? round.snapshot?.sha256 ?? null,
        openKeys: Array.isArray(round.openKeys) ? round.openKeys : [],
        findings: Array.isArray(round.findings) ? round.findings : [],
      })),
    };
  }

  static fromJSON(json) {
    if (!json || json.schema !== "plan-review-convergence/convergence-ledger/v2") return null;
    const ledger = new ConvergenceLedger({ W: json.W, planSha256: json.planSha256 });
    ledger.baselineBuilt = json.baselineBuilt === true;
    for (const entry of json.open ?? []) ledger.open.set(entry.causeKey, entry.item);
    ledger.rounds = (json.rounds ?? []).map((round) => ({
      taskId: round.taskId ?? null,
      roundId: round.roundId ?? null,
      responseSha256: round.responseSha256 ?? null,
      snapshotSha256: round.snapshotSha256 ?? null,
      openKeys: Array.isArray(round.openKeys) ? round.openKeys : [],
      findings: Array.isArray(round.findings) ? round.findings : [],
    }));
    return ledger;
  }
}
