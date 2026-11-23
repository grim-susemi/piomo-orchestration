import test from "node:test";
import assert from "node:assert/strict";
import { handoffStatus, renderReviewNotice } from "../display.mjs";

const PLAN = ".omo/plans/piomo-three-role-routing.md";

function findings() {
  return [
    {
      classification: "actual-blocker",
      reason: "Gateway access order contradicts",
      location: `${PLAN}:544`,
    },
    {
      classification: "duplicate",
      reason: "same cause restated",
      location: "근거 위치 미확인",
      duplicateOf: "IS-4|gateway-access-order|gateway|contradiction",
    },
    {
      classification: "out-of-scope",
      reason: "not in the approved IS set",
      location: "근거 위치 미확인",
    },
    {
      classification: "evidence-unconfirmed",
      reason: "citation hash mismatch",
      location: "근거 위치 미확인",
    },
  ];
}

test("native-owner-findings: the notice shows all four classifications, reasons, locations, and duplicate keys", () => {
  const body = renderReviewNotice({
    receipt: { status: "CHANGES_REQUESTED", reason: null },
    findings: findings(),
    usage: { U: 1, B: 5 },
    childId: "st_01a20000",
    stopReason: "REJECT",
  });
  assert.match(body, /검토 반려/);
  assert.match(body, /사용량 1\/5/);
  assert.match(body, /최근 자식 st_01a20000/);
  assert.match(body, /중단 사유 REJECT/);
  assert.match(body, /실제 차단: Gateway access order contradicts \.omo\/plans\/piomo-three-role-routing\.md:544/);
  assert.match(body, /중복: same cause restated/);
  assert.match(body, /기존 키 IS-4\|gateway-access-order\|gateway\|contradiction/);
  assert.match(body, /범위 밖: not in the approved IS set/);
  assert.match(body, /근거 미확인: citation hash mismatch/);
  assert.match(body, /수동 재개는 중단 건과 수정본 SHA에 결속된 1회만 가능합니다/);
});

test("native-owner-findings: only the current round findings are rendered", () => {
  const body = renderReviewNotice({
    receipt: { status: "CHANGES_REQUESTED" },
    findings: findings().slice(0, 1),
    usage: { U: 1, B: 5 },
    childId: "st_current",
    stopReason: "REJECT",
  });
  assert.match(body, /실제 차단/);
  assert.doesNotMatch(body, /범위 밖/);
  assert.doesNotMatch(body, /other plan/);
});

test("handoff H0 is APPROVED only for the current bytes", () => {
  const receipt = {
    status: "APPROVED",
    planSha256: "sha-h0",
    reviewedBodySha256: "sha-h0",
    reviewedSnapshotRef: "snapshot:h0",
    roundId: "r90",
    taskId: "st_ok",
  };
  const status = handoffStatus({ receipt, currentSha: "sha-h0", planPath: PLAN });
  assert.equal(status.reviewStatus, "APPROVED");
  assert.equal(status.receiptId, "st_ok");
  assert.equal(status.roundId, "r90");
  assert.equal(status.planPath, PLAN);
  assert.equal("command" in status, false);
  assert.equal("execute" in status, false);
});

test("handoff H0 on changed H1 bytes is UNVERIFIED with PLAN_SHA_MISMATCH", () => {
  const receipt = {
    status: "APPROVED",
    planSha256: "sha-h0",
    reviewedBodySha256: "sha-h0",
    reviewedSnapshotRef: "snapshot:h0",
    roundId: "r90",
    taskId: "st_ok",
  };
  const status = handoffStatus({ receipt, currentSha: "sha-h1", planPath: PLAN });
  assert.equal(status.reviewStatus, "UNVERIFIED");
  assert.equal(status.reason, "PLAN_SHA_MISMATCH");
});

test("handoff restores only after a new receipt matches the newly read bytes", () => {
  const oldReceipt = {
    status: "APPROVED",
    planSha256: "sha-h0",
    reviewedBodySha256: "sha-h0",
    reviewedSnapshotRef: "snapshot:h0",
    roundId: "r90",
    taskId: "st_ok",
  };
  assert.equal(
    handoffStatus({ receipt: oldReceipt, currentSha: "sha-h1", planPath: PLAN }).reason,
    "PLAN_SHA_MISMATCH",
  );
  const newReceipt = {
    status: "APPROVED",
    planSha256: "sha-h1",
    reviewedBodySha256: "sha-h1",
    reviewedSnapshotRef: "snapshot:h1",
    roundId: "r91",
    taskId: "st_new",
  };
  const restored = handoffStatus({ receipt: newReceipt, currentSha: "sha-h1", planPath: PLAN });
  assert.equal(restored.reviewStatus, "APPROVED");
  assert.equal(restored.receiptId, "st_new");
});

test("handoff without a receipt, approval, or snapshot is UNVERIFIED", () => {
  assert.equal(handoffStatus({ receipt: null, currentSha: "x", planPath: PLAN }).reason, "NO_RECEIPT");
  assert.equal(
    handoffStatus({
      receipt: { status: "CHANGES_REQUESTED", planSha256: "x", reviewedBodySha256: "x", reviewedSnapshotRef: "s" },
      currentSha: "x",
      planPath: PLAN,
    }).reason,
    "NOT_APPROVED",
  );
  assert.equal(
    handoffStatus({
      receipt: { status: "APPROVED", planSha256: "x", reviewedBodySha256: "x", reviewedSnapshotRef: null },
      currentSha: "x",
      planPath: PLAN,
    }).reason,
    "EVIDENCE_UNAVAILABLE",
  );
});
