const CLASSIFICATION = {
  "actual-blocker": "실제 차단",
  duplicate: "중복",
  "out-of-scope": "범위 밖",
  "evidence-unconfirmed": "근거 미확인",
};

export function renderReviewNotice({ receipt, findings = [], usage = { U: 0, B: 5 }, childId = null, stopReason = null }) {
  const verdict = receipt?.status === "APPROVED"
    ? "승인"
    : receipt?.status === "CHANGES_REQUESTED"
      ? "반려"
      : "미확정";
  const lines = [
    `검토 ${verdict}`,
    `사용량 ${usage.U}/${usage.B}`,
    `최근 자식 ${childId ?? "없음"}`,
  ];
  if (stopReason) lines.push(`중단 사유 ${stopReason}`);
  if (verdict === "반려") {
    for (const finding of findings) {
      const display = CLASSIFICATION[finding.classification] ?? CLASSIFICATION["evidence-unconfirmed"];
      const location = finding.location ?? "근거 위치 미확인";
      const duplicate = finding.duplicateOf ? ` (기존 키 ${finding.duplicateOf})` : "";
      const reason = finding.reason ? `: ${finding.reason}` : "";
      lines.push(`- ${display}${reason} ${location}${duplicate}`);
    }
  }
  lines.push("수동 재개는 중단 건과 수정본 SHA에 결속된 1회만 가능합니다.");
  return lines.join("\n");
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
  return {
    reviewStatus: "APPROVED",
    planPath,
    planSha256: currentSha,
    roundId: receipt.roundId,
    receiptId: receipt.taskId,
  };
}
