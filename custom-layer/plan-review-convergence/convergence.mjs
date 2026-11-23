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

function lineAt(snapshot, line) {
  const lines = snapshot.text.split("\n");
  return Number.isInteger(line) && line >= 1 && line <= lines.length ? lines[line - 1] : null;
}

export function contradictionPresent(snapshot, witness) {
  if (!snapshot || !witness || witness.kind !== "contradiction") return false;
  if (witness.expectedA === undefined || witness.expectedA === witness.expectedB) return false;
  const first = lineAt(snapshot, witness.lineA);
  const second = lineAt(snapshot, witness.lineB);
  if (first === null || second === null) return false;
  const hasFirst = (witness.tokensA ?? []).every((token) => first.includes(token));
  const hasSecond = (witness.tokensB ?? []).every((token) => second.includes(token));
  return hasFirst && hasSecond;
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

export class ConvergenceLedger {
  constructor({ W, planSha256, requirements = REQUIREMENTS, predicates = PREDICATES, boundaries = BOUNDARIES, failureClasses = FAILURE_CLASSES }) {
    this.W = W;
    this.planSha256 = planSha256;
    this.requirements = requirements;
    this.predicates = predicates;
    this.boundaries = boundaries;
    this.failureClasses = failureClasses;
    this.open = new Map();
    this.closed = new Map();
    this.baselineBuilt = false;
    this.reject = null;
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
    if (finding.failureClass === "contradiction") {
      if (!contradictionPresent(snapshot, finding.witness)) {
        return result(finding, "evidence-unconfirmed", "WITNESS_NOT_REPRODUCED");
      }
    } else if (!finding.reproduction || typeof finding.reproduction !== "object") {
      return result(finding, "evidence-unconfirmed", "REPRODUCTION_REQUIRED");
    }
    const causeKey = makeCauseKey(finding);
    if (this.open.has(causeKey) || this.closed.has(causeKey)) {
      return result(finding, "duplicate", "CAUSE_KEY_ALREADY_KNOWN", { causeKey, duplicateOf: causeKey });
    }
    if (this.baselineBuilt && !finding.newKeyReason) {
      return result(finding, "out-of-scope", "NEW_KEY_AFTER_BASELINE", { causeKey });
    }
    return result(finding, "actual-blocker", "NEW_CAUSE_KEY", { causeKey });
  }

  startRound({ receipt, snapshot, findings }) {
    this.baselineBuilt = false;
    this.reject = { receipt, snapshot };
    const evaluated = findings.map((finding) => this.evaluate(finding, receipt, snapshot));
    for (const item of evaluated) {
      if (item.classification === "actual-blocker") this.open.set(item.causeKey, item);
    }
    this.baselineBuilt = true;
    this.rounds.push({ receipt, snapshot, findings: evaluated });
    return {
      status: this.open.size === 0 ? "STOP_NO_PROGRESS" : "changes_requested",
      findings: evaluated,
      openKeys: [...this.open.keys()],
      autoProgress: 0,
    };
  }

  addRound({ receipt, snapshot, findings }) {
    if (!this.baselineBuilt) return this.startRound({ receipt, snapshot, findings });
    const evaluated = findings.map((finding) => this.evaluate(finding, receipt, snapshot));
    for (const item of evaluated) {
      if (item.classification === "actual-blocker") this.open.set(item.causeKey, item);
    }
    this.rounds.push({ receipt, snapshot, findings: evaluated });
    return {
      status: this.open.size === 0 ? "STOP_NO_PROGRESS" : "changes_requested",
      findings: evaluated,
      openKeys: [...this.open.keys()],
      autoProgress: 0,
    };
  }

  resolve({ causeKey, witness, revisedSnapshot, revisedSha }) {
    if (!this.open.has(causeKey)) return { ok: false, reason: "UNKNOWN_KEY" };
    if (!revisedSnapshot || revisedSnapshot.sha256 === this.reject?.snapshot?.sha256) {
      return { ok: false, reason: "NO_NEW_SHA" };
    }
    if (revisedSha !== revisedSnapshot.sha256) return { ok: false, reason: "REVISED_SHA_MISMATCH" };
    if (!contradictionPresent(this.reject?.snapshot, witness)) {
      return { ok: false, reason: "PAST_NOT_REPRODUCED" };
    }
    if (contradictionPresent(revisedSnapshot, witness)) {
      return { ok: false, reason: "STILL_PRESENT" };
    }
    const item = this.open.get(causeKey);
    this.open.delete(causeKey);
    this.closed.set(causeKey, { ...item, resolvedSha: revisedSha });
    return { ok: true, causeKey, revisedSha };
  }

  autoEligibility({ newSha, previousSha, budgetRemaining, stopped, goalOk, scopeOk, hasProgress }) {
    if (stopped) return { allow: false, reason: "STOPPED" };
    if (!goalOk || !scopeOk) return { allow: false, reason: "STOP_SCOPE" };
    if (!Number.isInteger(budgetRemaining) || budgetRemaining <= 0) {
      return { allow: false, reason: "STOP_BUDGET" };
    }
    if (!hasProgress || this.closed.size === 0) return { allow: false, reason: "STOP_NO_PROGRESS" };
    if (!newSha || newSha === previousSha) return { allow: false, reason: "STOP_NO_NEW_SHA" };
    return { allow: true, reason: "ALLOW" };
  }

  summary() {
    return {
      W: this.W,
      planSha256: this.planSha256,
      open: [...this.open.values()],
      closed: [...this.closed.values()],
      reject: this.reject,
      rounds: this.rounds.length,
    };
  }
}
