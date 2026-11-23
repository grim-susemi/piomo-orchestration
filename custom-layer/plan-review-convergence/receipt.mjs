import { createHash } from "node:crypto";

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function classifyVerdict(rawResponse) {
  if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
    return { verdict: "INCONCLUSIVE", reason: "MISSING_RESPONSE" };
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

function inconclusive(base, reason) {
  return { ...base, status: "INCONCLUSIVE", reason, approvalDisplay: false, autoProgress: 0 };
}

export function bindReceipt(input) {
  const {
    taskRecord,
    expected = {},
    reviewedSnapshotRef = null,
    reviewedSnapshotSha256 = null,
    safeRead = false,
    hostTrusted = false,
    stopAfterArrival = false,
  } = input;
  const raw = taskRecord?.final_response;
  const responseBytes = Buffer.from(typeof raw === "string" ? raw : "", "utf8");
  const responseSha256 = sha256Bytes(responseBytes);
  const classified = classifyVerdict(raw);
  const base = {
    W: expected.W ?? null,
    roundId: expected.roundId ?? null,
    launchKey: expected.launchKey ?? null,
    taskId: taskRecord?.task_id ?? null,
    childSessionId: taskRecord?.child_session_id ?? null,
    planSha256: expected.reviewedSha ?? null,
    reviewedBodySha256: expected.reviewedSha ?? null,
    responseSha256,
    rawResponseUtf8: typeof raw === "string" ? raw : "",
    reviewedSnapshotRef,
    verdict: classified.verdict,
    status: "INCONCLUSIVE",
    reason: null,
    approvalDisplay: false,
    autoProgress: 0,
  };
  if (!taskRecord) return inconclusive(base, "MISSING_TASK");
  if (taskRecord.task_id !== expected.taskId) return inconclusive(base, "TASK_MISMATCH");
  if (taskRecord.child_session_id !== expected.childSessionId) {
    return inconclusive(base, "CHILD_SESSION_MISMATCH");
  }
  if (expected.roundId && taskRecord.roundId && taskRecord.roundId !== expected.roundId) {
    return inconclusive(base, "ROUND_MISMATCH");
  }
  if (expected.planPath && taskRecord.spawn_spec?.prompt && !taskRecord.spawn_spec.prompt.includes(expected.planPath)) {
    return inconclusive(base, "PLAN_PATH_MISMATCH");
  }
  if (expected.runtimeSha && taskRecord.runtimeSha && taskRecord.runtimeSha !== expected.runtimeSha) {
    return inconclusive(base, "RUNTIME_MISMATCH");
  }
  if (taskRecord.status !== "completed") return inconclusive(base, "TASK_NOT_TERMINAL");
  if (!hostTrusted || !safeRead) return inconclusive(base, "UNSAFE_READ");
  if (!reviewedSnapshotRef || !reviewedSnapshotSha256) {
    return { ...inconclusive(base, "EVIDENCE_UNAVAILABLE"), verdict: classified.verdict };
  }
  if (reviewedSnapshotSha256 !== expected.reviewedSha) {
    return { ...inconclusive(base, "SNAPSHOT_SHA_MISMATCH"), verdict: classified.verdict };
  }
  if (expected.reviewedSha !== expected.currentSha) {
    return { ...inconclusive(base, "PLAN_CHANGED"), verdict: classified.verdict };
  }
  if (stopAfterArrival) return { ...inconclusive(base, "STOPPED"), verdict: classified.verdict };
  if (classified.verdict === "OKAY") {
    return {
      ...base,
      status: "APPROVED",
      reason: null,
      approvalDisplay: true,
      autoProgress: 0,
    };
  }
  if (classified.verdict === "REJECT") {
    return {
      ...base,
      status: "CHANGES_REQUESTED",
      reason: null,
      approvalDisplay: false,
      autoProgress: 0,
    };
  }
  return { ...inconclusive(base, classified.reason ?? "INCONCLUSIVE"), verdict: classified.verdict };
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
