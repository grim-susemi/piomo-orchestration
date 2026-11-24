import { createHash } from "node:crypto";

export const REVIEW_ROLES = new Set(["plan-reviewer", "plan-consultant"]);

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyVerdict(rawResponse) {
  if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
    return { verdict: "INCONCLUSIVE", reason: "MISSING_RESPONSE" };
  }
  try {
    const parsed = JSON.parse(rawResponse);
    if (parsed && (parsed.verdict === "OKAY" || parsed.verdict === "REJECT")) {
      return { verdict: parsed.verdict };
    }
  } catch {
    // A markdown verdict is not JSON; fall through to the token form.
  }
  const first = rawResponse.split(/\r?\n/u).find((line) => line.trim().length > 0);
  if (!first) return { verdict: "INCONCLUSIVE", reason: "MISSING_RESPONSE" };
  const cleaned = first.replace(/^[\s*_~`]+/u, "").replace(/[\s*_~`]+$/u, "").trim();
  const tokens = cleaned.match(/\[(OKAY|REJECT)\]/gu) ?? [];
  if (tokens.length === 1 && cleaned === tokens[0]) {
    return { verdict: tokens[0].slice(1, -1) };
  }
  if (tokens.length > 1) return { verdict: "INCONCLUSIVE", reason: "AMBIGUOUS_VERDICT" };
  return { verdict: "INCONCLUSIVE", reason: "NO_SINGLE_TOKEN" };
}

/**
 * Findings from the bytes a reviewer actually returned.  No finding is invented:
 * a JSON response is read by its `findings` array, a markdown response by its
 * blocker/major/minor bullets, and any other rejection keeps the raw text (the
 * owner sees the reviewer's own words, not a formatter's guess).
 */
export function parseFindings(rawResponse) {
  const text = typeof rawResponse === "string" ? rawResponse : "";
  if (text.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.findings)) {
      return parsed.findings.map((finding) => ({
        severity: String(finding.severity ?? "blocker"),
        classification: finding.classification ?? null,
        requirementId: finding.requirementId ?? null,
        predicateId: finding.predicateId ?? null,
        boundaryId: finding.boundaryId ?? null,
        failureClass: finding.failureClass ?? null,
        newKeyReason: finding.newKeyReason ?? null,
        responseSpan: Array.isArray(finding.responseSpan) ? finding.responseSpan : null,
        spanTokens: Array.isArray(finding.spanTokens) ? finding.spanTokens : [],
        evidenceRefs: Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs : [],
        witness: finding.witness ?? null,
        duplicateKey: finding.duplicateKey ?? null,
        file: finding.file ?? null,
        line: Number.isInteger(finding.line) ? finding.line : null,
        note: String(finding.note ?? finding.message ?? "").slice(0, 4000),
      }));
    }
  } catch {
    // A markdown verdict is not JSON; fall through to the bullet form.
  }
  const findings = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*[-*]\s*(?:\[(blocker|major|minor)\]|(blocker|major|minor)\s*[:\-])\s*(.+)$/iu.exec(line);
    if (!match) continue;
    const severity = (match[1] ?? match[2]).toLowerCase();
    const note = match[3].trim();
    if (note.length > 0) findings.push({ severity, file: null, line: null, note: note.slice(0, 4000) });
  }
  if (findings.length > 0) return findings;
  if (classifyVerdict(text).verdict === "REJECT") {
    return [{
      severity: "blocker",
      file: null,
      line: null,
      note: text.trim().slice(0, 4000),
    }];
  }
  return [];
}

function inconclusive(base, reason) {
  return { ...base, status: "INCONCLUSIVE", reason, approvalDisplay: false, autoProgress: 0 };
}

function snapshotBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return null;
}

/**
 * Bind one review verdict to the host task record, the child session and the
 * exact plan bytes the reviewer was pointed at.  `reviewedBodySha256` is always
 * computed here from `reviewedSnapshotBytes`; a caller cannot copy a plan digest.
 */
export function bindReceipt(input) {
  const {
    taskRecord,
    expected = {},
    reviewedSnapshotRef = null,
    reviewedSnapshotBytes = null,
    safeRead = false,
    hostTrusted = false,
    stopAfterArrival = false,
    childRead = null,
    childReadFailure = null,
  } = input;
  const raw = taskRecord?.final_response;
  const responseBytes = Buffer.from(typeof raw === "string" ? raw : "", "utf8");
  const responseSha256 = sha256Bytes(responseBytes);
  const classified = classifyVerdict(raw);
  const snapshot = snapshotBuffer(reviewedSnapshotBytes);
  const reviewedBodySha256 = snapshot ? sha256Bytes(snapshot) : null;
  const currentSha = expected.currentSha ?? null;
  const base = {
    W: expected.W ?? null,
    roundId: expected.roundId ?? null,
    launchKey: expected.launchKey ?? null,
    taskId: taskRecord?.task_id ?? null,
    childSessionId: taskRecord?.child_session_id ?? null,
    parentSessionId: taskRecord?.parent_session_id ?? null,
    reviewerRole: taskRecord?.agent_type ?? null,
    terminationEvent: taskRecord?.terminal_at ?? null,
    planSha256: expected.reviewedSha ?? null,
    reviewedBodySha256,
    currentSha,
    currentMatchesReviewed: Boolean(reviewedBodySha256 && currentSha && reviewedBodySha256 === currentSha),
    responseSha256,
    rawResponseUtf8: typeof raw === "string" ? raw : "",
    reviewedSnapshotRef,
    findings: parseFindings(raw).map((finding) => ({
      ...finding,
      receiptRef: finding.receiptRef ?? taskRecord?.task_id ?? null,
    })),
    childReadEvent: childRead ?? null,
    childReadFailure: childReadFailure ?? null,
    childReadEventId: childRead?.readEventId ?? null,
    childReadResultEventId: childRead?.resultEventId ?? null,
    childReadFile: childRead?.childSessionFile ?? null,
    verdict: classified.verdict,
    status: "INCONCLUSIVE",
    reason: null,
    approvalDisplay: false,
    autoProgress: 0,
  };
  if (!taskRecord) return inconclusive(base, "MISSING_TASK");
  if (taskRecord.task_id !== expected.taskId) return inconclusive(base, "TASK_MISMATCH");
  if (typeof taskRecord.child_session_id !== "string" || taskRecord.child_session_id.length === 0) {
    return inconclusive(base, "CHILD_SESSION_MISSING");
  }
  if (expected.childSessionId && taskRecord.child_session_id !== expected.childSessionId) {
    return inconclusive(base, "CHILD_SESSION_MISMATCH");
  }
  if (taskRecord.child_session_id === taskRecord.parent_session_id) {
    return inconclusive(base, "CHILD_SESSION_IS_PARENT");
  }
  if (expected.parentSessionId && taskRecord.parent_session_id !== expected.parentSessionId) {
    return inconclusive(base, "PARENT_SESSION_MISMATCH");
  }
  if (typeof taskRecord.execution_mode !== "string" || taskRecord.execution_mode.length === 0) {
    return inconclusive(base, "EXECUTION_MODE_MISSING");
  }
  if (!REVIEW_ROLES.has(String(taskRecord.agent_type))) {
    return inconclusive(base, "REVIEWER_ROLE_MISMATCH");
  }
  if (expected.reviewerRole && taskRecord.agent_type !== expected.reviewerRole) {
    return inconclusive(base, "REVIEWER_ROLE_MISMATCH");
  }
  const terminalAt = Date.parse(String(taskRecord.terminal_at ?? ""));
  if (taskRecord.status !== "completed" || !Number.isFinite(terminalAt)) {
    return inconclusive(base, "TASK_NOT_TERMINAL");
  }
  if (taskRecord.started_at && Date.parse(String(taskRecord.started_at)) > terminalAt) {
    return inconclusive(base, "TASK_NOT_TERMINAL");
  }
  if (expected.roundId && taskRecord.roundId && taskRecord.roundId !== expected.roundId) {
    return inconclusive(base, "ROUND_MISMATCH");
  }
  if (expected.planPath && taskRecord.spawn_spec?.prompt) {
    const normalize = (value) => String(value).replaceAll("\\", "/").toLowerCase();
    if (!normalize(taskRecord.spawn_spec.prompt).includes(normalize(expected.planPath))) {
      return inconclusive(base, "PLAN_PATH_MISMATCH");
    }
  }
  if (expected.runtimeSha && taskRecord.runtimeSha && taskRecord.runtimeSha !== expected.runtimeSha) {
    return inconclusive(base, "RUNTIME_MISMATCH");
  }
  if (!hostTrusted || !safeRead) return inconclusive(base, "UNSAFE_READ");
  if (!reviewedSnapshotRef || !snapshot) {
    return { ...inconclusive(base, "EVIDENCE_UNAVAILABLE"), verdict: classified.verdict };
  }
  if (reviewedBodySha256 !== expected.reviewedSha) {
    return { ...inconclusive(base, "SNAPSHOT_SHA_MISMATCH"), verdict: classified.verdict };
  }
  if (stopAfterArrival) return { ...inconclusive(base, "STOPPED"), verdict: classified.verdict };
  if (classified.verdict === "REJECT") {
    return {
      ...base,
      status: "CHANGES_REQUESTED",
      reason: null,
      approvalDisplay: false,
      autoProgress: 0,
    };
  }
  if (classified.verdict !== "OKAY") {
    return { ...inconclusive(base, classified.reason ?? "INCONCLUSIVE"), verdict: classified.verdict };
  }
  if (!childRead) {
    return {
      ...inconclusive(base, childReadFailure ?? "CHILD_READ_MISSING"),
      verdict: classified.verdict,
    };
  }
  if (childRead.childSessionId !== taskRecord.child_session_id) {
    return { ...inconclusive(base, "CHILD_READ_SESSION_MISMATCH"), verdict: classified.verdict };
  }
  if (childRead.sha256 !== reviewedBodySha256) {
    return { ...inconclusive(base, "CHILD_READ_SHA_MISMATCH"), verdict: classified.verdict };
  }
  if (childRead.terminalEvent !== taskRecord.terminal_at) {
    return { ...inconclusive(base, "CHILD_READ_TERMINAL_MISMATCH"), verdict: classified.verdict };
  }
  if (!currentSha || reviewedBodySha256 !== currentSha) {
    return { ...inconclusive(base, "PLAN_CHANGED"), verdict: classified.verdict };
  }
  return {
    ...base,
    status: "APPROVED",
    reason: null,
    approvalDisplay: true,
    autoProgress: 0,
  };
}

export class ReceiptLedger {
  constructor() {
    this.seen = new Set();
    this.approvals = new Set();
  }

  apply(receipt) {
    const key = [
      receipt.W,
      receipt.roundId,
      receipt.taskId,
      receipt.childSessionId,
      receipt.responseSha256,
    ].join("|");
    if (this.seen.has(key)) {
      return { receipt, duplicate: true, approvalDisplay: false };
    }
    this.seen.add(key);
    if (receipt.status === "APPROVED") {
      const slot = `${receipt.W}|${receipt.roundId}`;
      if (this.approvals.has(slot)) {
        return { receipt, duplicate: true, approvalDisplay: false };
      }
      this.approvals.add(slot);
      return { receipt, duplicate: false, approvalDisplay: true };
    }
    return { receipt, duplicate: false, approvalDisplay: false };
  }
}
