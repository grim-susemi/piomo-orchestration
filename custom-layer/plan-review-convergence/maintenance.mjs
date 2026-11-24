/**
 * Update-time maintenance verdict for the plan-review-convergence candidate.
 *
 * This module never installs, applies, or retires anything. The verdict is built
 * from real probe reports: the isolated stock replay, the candidate's single /
 * batch / delegation / resume / forged cases, and the source anchors. A boolean
 * a caller supplies is not evidence.
 */
export function classifyMaintenance({
  stockConforms = false,
  candidatePass = false,
  anchorsMatch = false,
  evidenceComplete = false,
} = {}) {
  if (!anchorsMatch || !evidenceComplete) return "needs-review";
  if (stockConforms) return "official-conforms-retire-candidate";
  if (candidatePass) return "candidate-pass";
  return "needs-review";
}

const REQUIRED_CANDIDATE_CASES = [
  "native-single-review",
  "native-batch-review",
  "native-auto-progress-allows",
  "native-auto-sha-only-denies",
  "native-owner-findings",
  "native-resume",
  "native-delegation-handoff",
  "native-handoff-freshness",
  "native-r83-replay",
  "native-r84-prehash-denied",
  "native-r84-hash-bound-once",
  "native-r84-intent-denied",
  "native-recovery",
  "probe-forged-records",
  "probe-forged-handoff",
  "candidate-second-review",
  "native-ledger-deleted",
];

function findScenario(report, caseId) {
  return Array.isArray(report?.scenarios)
    ? report.scenarios.find((scenario) => scenario.caseId === caseId) ?? null
    : null;
}

function boundariesMatch(boundary) {
  if (!boundary || boundary.state !== "managed-delta") return false;
  const anchors = boundary.anchors ?? {};
  const r83 = boundary.r83 ?? {};
  return anchors.gateDefinitionCount === 1
    && anchors.callSiteCount === 1
    && anchors.spawnPolicyHasGate === true
    && anchors.stateProviderCount === 1
    && anchors.budgetMentions === 0
    && r83.limit === 83
    && r83.childCount === 1;
}

/**
 * Derive the verdict from what the probes observed.  `stockReport` is the
 * isolated stock replay; `candidateReport` is the candidate's `--case all`.
 */
export function maintenanceFromReports({ stockReport = null, candidateReport = null, boundary = null } = {}) {
  const stockScenario = findScenario(stockReport, "stock-second-review")
    ?? findScenario(stockReport, "candidate-second-review")
    ?? findScenario(stockReport, "boundary-stock-replay");
  const candidateSecond = findScenario(candidateReport, "candidate-second-review")
    ?? findScenario(candidateReport, "boundary-stock-replay");
  const candidate = Object.fromEntries(
    REQUIRED_CANDIDATE_CASES.map((caseId) => [caseId, findScenario(candidateReport, caseId)]),
  );
  const stockLaunchCount = stockScenario?.evidence?.stockReviewerTaskIds?.length ?? 0;
  const candidateLaunchCount = candidateSecond?.evidence?.candidateReviewerTaskIds?.length
    ?? candidateSecond?.evidence?.reviewerTaskIds?.length
    ?? 0;
  const parityOk = stockLaunchCount === 2
    && candidateLaunchCount === 1
    && Boolean(candidateSecond?.evidence?.candidateDenial);
  const stockConforms = stockLaunchCount === 1 && candidateLaunchCount === 1;
  const anchorsMatch = boundariesMatch(boundary);
  const candidateEvidenceOk = REQUIRED_CANDIDATE_CASES.every((caseId) => {
    const scenario = candidate[caseId];
    return Boolean(
      scenario
      && scenario.realChild === true
      && scenario.evidence
      && scenario.state === scenario.expectedState,
    );
  });
  const stockEvidenceOk = stockLaunchCount >= 1
    && candidateLaunchCount >= 1
    && Boolean(candidateSecond?.evidence);
  const evidenceComplete = candidateEvidenceOk
    && stockEvidenceOk
    && (parityOk || stockConforms)
    && Boolean(candidateSecond?.evidence?.candidateDenial)
    && candidate["native-resume"]?.evidence?.answerSource === "owner-chat"
    && candidate["native-resume"]?.evidence?.manualUsed === 1
    && candidate["probe-forged-handoff"]?.evidence?.delivered === true
    && candidate["probe-forged-records"]?.evidence?.forgedBind === "QUESTION_NOT_PUBLISHED";
  const resumeFeatureImplemented = Boolean(
    candidate["native-resume"]?.state === "chat-question-bound"
    && candidate["native-resume"]?.evidence?.hostRequestId
    && candidate["native-resume"]?.evidence?.answerEventId,
  );
  const handoffFeatureImplemented = candidate["native-handoff-freshness"]?.state === "handoff-approved-then-stale";
  const onceFeatureImplemented = candidate["native-r84-hash-bound-once"]?.state === "manual-once-then-stopped";
  const findingsFeatureImplemented = candidate["native-owner-findings"]?.state === "owner-findings-delivered";
  const budgetFeatureImplemented = candidate["native-r83-replay"]?.state === "r83-limit-held";
  const candidatePass = candidateReport?.ok === true
    && parityOk
    && resumeFeatureImplemented
    && handoffFeatureImplemented
    && onceFeatureImplemented
    && findingsFeatureImplemented
    && budgetFeatureImplemented
    && REQUIRED_CANDIDATE_CASES.every((caseId) => candidate[caseId]?.state === candidate[caseId]?.expectedState);
  return {
    verdict: classifyMaintenance({
      stockConforms,
      candidatePass,
      anchorsMatch,
      evidenceComplete,
    }),
    inputs: {
      stockConforms,
      candidatePass,
      anchorsMatch,
      evidenceComplete,
      stockLaunchCount,
      candidateLaunchCount,
      parityOk,
      resumeFeatureImplemented,
      handoffFeatureImplemented,
      onceFeatureImplemented,
      findingsFeatureImplemented,
      budgetFeatureImplemented,
      candidateStates: Object.fromEntries(
        REQUIRED_CANDIDATE_CASES.map((caseId) => [caseId, candidate[caseId]?.state ?? "missing"]),
      ),
      stockReplayState: stockScenario?.state ?? "missing",
      boundaryState: boundary?.state ?? "missing",
      ownerTranscriptSha256: candidateReport?.ownerTranscript?.sha256 ?? null,
    },
  };
}
