# Plan-review workflow contract (candidate, not installed)

This file records the finite default, stop/resume, and approval rules once for the
candidate. Installed skill texts are not modified; only the managed delta and the
test copy carry these rules.

## Budget

- The host fixes the automatic budget `B` at 5 for the first explicit plan request.
  Only an integer 1-5 written in that request's own `<user-request>` body can lower
  it (`review_round_limit: N`, `review limit: N`, `검토 한도 N회`). A draft's
  `review_round_limit`, a process environment value, or two different limits in one
  body cannot change it; an ambiguous body is refused.
- Usage `U` increases monotonically at reservation and is never rolled back by a
  denial. No round count, file edit, new session, or agent claim can raise `B`.
- When `B` is exhausted, the only remaining authority is one manual reservation
  bound to the stopped round and the reviewed plan SHA. It is not a budget reset.

## Stop and resume

- Stop on `REJECT`, no progress, exhausted budget, or a plan/scope exit. The stop
  state survives compaction, goal restart, and process restart.
- A manual resume is allowed once for the current stop and reviewed SHA. The
  question is created from the rejected snapshot digest and the live digest; the
  answer is read only from the host transcript chain
  `ask-user:question -> ask-user:settlement(answered) -> inputSource:"extension"
  [Answer to question ...]` or from the host-written deny row plus the owner's
  own user message. A chat answer counts only when the frame starts the message,
  names the same question id and body digest, and is followed by an explicit
  approval token (`yes`/`y`/`승인`/`네`/`예`/`동의`). A quoted frame, a code fence,
  a `no` answer, an old answer that predates the question, or an event id supplied
  by an agent or the environment is not authorization.
- Automatic resume requires the bound next-round review result: a host receipt
  for a `[REJECT]` on the reserved round, then the following reviewer receipt.
  Same structured blocker key in both rounds -> `SAME_BLOCKER`; a different key
  set or an `APPROVED` next result -> allow; no next reviewer result ->
  `NO_REVIEW_RESULT`. The blocker key comes only from the reviewer's structured
  finding fields; this module does not parse or compare the plan's sentences,
  synonyms, polarity or line order. A changed SHA alone, a lead's assertion, a
  draft field, or an allow flag is not progress. Cause keys persist across
  rounds, so the same key in a later round is reported as a duplicate, never as
  a new blocker.

## Approval and handoff

- Approval exists only as a host receipt: a completed task record whose first
  verdict line is `[OKAY]`, its reviewer role, its non-parent child session, its
  terminal event, the exact frozen plan snapshot bytes, and a live plan digest
  equal to those bytes. The reviewer's own child transcript must also contain a
  `read` tool call for the plan path whose tool-result bytes hash to that same
  snapshot; if the host leaves no such read event, the receipt closes as
  `UNSUPPORTED_BY_HOST` and never as approval. A draft `approved` field, an old
  chat message, an agent-written document, or a bare verdict string is not
  approval.
- Findings are accepted only from the lead submission file
  `.omo/plan-review-convergence/lead-submission.json`, and only when its receipt
  id, response digest and reviewed snapshot digest match the bound receipt. The
  owner notice row carries a delivery id, the four classifications, the evidence
  line ranges/digests, and the duplicate's previous cause key; findings that name
  another round or plan are dropped from the current notice.
- The handoff card is `APPROVED` only while the live plan bytes match the
  reviewed snapshot. Any mismatch is `UNVERIFIED` with `PLAN_SHA_MISMATCH`; it
  never issues an execution command or a target-session launch.
- The managed delta runs after the stock `Ca`/prompt-contract decisions and
  before `Lk` returns, so a stock denial never leaves a candidate reservation.
  The owner notice, findings, usage `U/B`, recent child ID, and one-shot resume
  text are rendered from the same host state and receipt.
