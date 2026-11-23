/**
 * Update-time maintenance verdict for the plan-review-convergence candidate.
 *
 * This module never installs, applies, or retires anything. It only turns the
 * evidence an update run collected into one of three recommendations:
 *
 * - candidate-pass: the candidate's real host replay passes and the anchors and
 *   evidence are complete, so keep the candidate row.
 * - official-conforms-retire-candidate: the stock/official release satisfies every
 *   real case, so the candidate may be retired after the owner's review.
 * - needs-review: an anchor, target hash, or evidence is missing/changed; never
 *   auto-apply or auto-retire.
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
