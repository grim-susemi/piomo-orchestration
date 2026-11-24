import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const LEAD_SUBMISSION_SCHEMA = "plan-review-convergence/lead-submission/v1";

/**
 * The lead planner proposes findings; the host verifies them.  This channel is
 * intentionally separate from the reviewer's response: a JSON bulllet list in a
 * model reply is never the acceptance boundary, and a submission that does not
 * name the bound receipt, response digest and reviewed snapshot is refused.
 */
export function leadSubmissionPath(workspaceRoot) {
  return join(workspaceRoot, ".omo", "plan-review-convergence", "lead-submission.json");
}

function sameSha(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

export function readLeadSubmission({ workspaceRoot, receipt }) {
  const path = leadSubmissionPath(workspaceRoot);
  if (!existsSync(path)) return { ok: false, reason: "LEAD_SUBMISSION_MISSING", path };
  let document;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, reason: "LEAD_SUBMISSION_INVALID", path };
  }
  if (document?.schema !== LEAD_SUBMISSION_SCHEMA) {
    return { ok: false, reason: "LEAD_SUBMISSION_INVALID", path };
  }
  if (document.W !== receipt.W) return { ok: false, reason: "LEAD_SUBMISSION_WORKSPACE_MISMATCH", path };
  if (document.launchKey !== receipt.launchKey) {
    return { ok: false, reason: "LEAD_SUBMISSION_LAUNCH_MISMATCH", path };
  }
  if (document.taskId !== receipt.taskId || document.receiptRef !== receipt.taskId) {
    return { ok: false, reason: "LEAD_SUBMISSION_RECEIPT_MISMATCH", path };
  }
  if (!sameSha(document.reviewedSha, receipt.reviewedBodySha256)) {
    return { ok: false, reason: "LEAD_SUBMISSION_SNAPSHOT_MISMATCH", path };
  }
  if (!sameSha(document.responseSha256, receipt.responseSha256)) {
    return { ok: false, reason: "LEAD_SUBMISSION_RESPONSE_MISMATCH", path };
  }
  if (!Array.isArray(document.findings) || document.findings.length === 0) {
    return { ok: false, reason: "LEAD_SUBMISSION_EMPTY", path };
  }
  const findings = document.findings.map((finding) => ({
    ...finding,
    receiptRef: finding?.receiptRef ?? document.receiptRef,
    submittedBy: "lead",
  }));
  return { ok: true, path, findings, document };
}
