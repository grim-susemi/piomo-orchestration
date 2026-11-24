import { sha256Bytes } from "./receipt.mjs";

const CLASSIFICATION = {
  "actual-blocker": "실제 차단",
  duplicate: "중복",
  "out-of-scope": "범위 밖",
  "evidence-unconfirmed": "근거 미확인",
};

export function renderReviewNotice({ receipt, findings = [], usage = { U: 0, B: 5 }, childId = null, stopReason = null, reviewStatus = null, submissionPath = null }) {
  const verdict = reviewStatus === "APPROVED"
    ? "승인"
    : reviewStatus === "UNVERIFIED"
      ? "미확정"
      : receipt?.status === "APPROVED"
        ? "승인"
        : receipt?.status === "CHANGES_REQUESTED"
          ? "반려"
          : "미확정";
  const lines = [];
  if (receipt?.verdict === "REJECT" && receipt.findingsVerified === false) {
    lines.push(`[PRC_FINDINGS_REQUEST task=${receipt.taskId ?? "-"} snapshot=${receipt.reviewedBodySha256 ?? "-"} submit=${submissionPath ?? "-"}]`);
  }
  lines.push(
    `검토 ${verdict}`,
    `사용량 ${usage.U}/${usage.B}`,
    `최근 자식 ${childId ?? "없음"}`,
  );
  if (stopReason) lines.push(`중단 사유 ${stopReason}`);
  if (receipt?.status === "CHANGES_REQUESTED" || verdict === "반려") {
    for (const finding of findings) {
      const display = CLASSIFICATION[finding.classification]
        ?? (finding.severity ? `[${finding.severity}]` : CLASSIFICATION["evidence-unconfirmed"]);
      const location = finding.location
        ?? (Array.isArray(finding.evidenceRefs) && finding.evidenceRefs.length > 0
          ? finding.evidenceRefs
            .map((ref) => `${ref.startLine}-${ref.endLine}:${String(ref.sha256).slice(0, 8)}`)
            .join(",")
          : finding.file
            ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
            : "근거 위치 미확인");
      const duplicate = finding.duplicateOf ? ` (기존 키 ${finding.duplicateOf})` : "";
      const reason = finding.reason ? `: ${finding.reason}` : "";
      const note = finding.note ? ` ${finding.note}` : "";
      lines.push(`- ${display}${reason} ${location}${note}${duplicate}`);
    }
  }
  lines.push("수동 재개는 중단 건과 수정본 SHA에 결속된 1회만 가능합니다.");
  const body = lines.join("\n");
  return `[PRC_NOTICE ${sha256Bytes(Buffer.from(body, "utf8")).slice(0, 16)}]\n${body}`;
}

export function handoffStatus({ receipt, currentSha, planPath }) {
  if (!receipt) return { reviewStatus: "UNVERIFIED", reason: "NO_RECEIPT" };
  if (receipt.status !== "APPROVED") {
    return { reviewStatus: "UNVERIFIED", reason: receipt.reason ?? "NOT_APPROVED" };
  }
  if (receipt.planSha256 !== currentSha || receipt.reviewedBodySha256 !== currentSha) {
    return { reviewStatus: "UNVERIFIED", reason: "PLAN_SHA_MISMATCH" };
  }
  if (!receipt.reviewedSnapshotRef) {
    return { reviewStatus: "UNVERIFIED", reason: "EVIDENCE_UNAVAILABLE" };
  }
  if (!receipt.taskId || !receipt.childSessionId) {
    return { reviewStatus: "UNVERIFIED", reason: "EVIDENCE_UNAVAILABLE" };
  }
  return {
    reviewStatus: "APPROVED",
    planPath,
    planSha256: currentSha,
    roundId: receipt.roundId,
    receiptId: receipt.taskId,
  };
}
