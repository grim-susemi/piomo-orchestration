# Boundary: plan-review admission

## Result

**`managed-delta`.** The stock 5.1.69 host has exactly one pre-spawn plan-review gate and no review-budget field. The gate allows a second `plan-reviewer` call whenever the user requested `ulw-plan` and a plan artifact exists; the recorded r83 call changed the draft limit from 1 to 83 and a new child was still admitted. The exact source and consume anchors are the `Lk` spawn policy and its single `Ca(...)` call.

The source anchors explain **why** a delta is needed; they are not the pass evidence. Every case below is replayed in an isolated copy of the package through a real host process (`probe.mjs`). No fixture writes a receipt, completes a round, or labels a prompt as a publication.

## Baseline observed

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `P/plugin/extensions/omo-task.js` | 1317047 | `719c1eac06b34bac708506fd62b6d4614b8ceb25c39c3fe10f9b2e03547d9eb7` |
| `P/package.json` (version `5.1.69`) | 546 | `2e8441299591f4941d19a2120727bb64d1d6485a12802adf4a73429926f066b4` |
| Senpi bundle `dist/bundle/cli.js` | 26259 | `5711189e5c20229d0df66c3905232980ac045750e57679aa833aedb99f86c95e` |
| `S/omo.cmd` (live pin `5.1.81`) | 13858 | `a39a6cf78f703d82b7e128b10de97ffd621d8eb9c512b5d4229428fe3104cdd` |

The `P` baseline is 5.1.69 (the r83 session's package). The live `omo.cmd` pin is 5.1.81; it is recorded separately and is not treated as the baseline.

## Exact anchors

- Gate definition: `function Ca(e,t){let n=Ma(e);...}` at source offset **144658** (`Ca(` token at 144667); `Ca` is the only `function Ca` in the host.
- Spawn policy: `function Lk(e,t,n,r){...}` at source offset **313804**; it calls the gate exactly once as `Ca(r,e.resolveSkillInvocations?.(n)??Pa)` at source offset **313904**.
- Managed delta: injected at the single `return"deny"===s?.kind?` anchor **after** the stock `Ca` decision and the plan-review prompt contract, so a stock denial never leaves a candidate reservation.
- Trusted state provider: `stateFor:e=>(...hasUserRequested...hasPlanArtifact...)` at source offset **1284771**.
- `review_round_limit` occurrences in `omo-task.js`: **0**.
- `plan-consultant` and `plan-reviewer` both have `requiresSkills:["ulw-plan"]`, `requiresPlanArtifact:true`, `forbidsSkills:[]`.

## Isolated replay coverage map

Each row is `probe.mjs --variant <v> --case <c>` in a fresh temp home, agent dir and state root. "Real child" means the host wrote the task record and the child session id; the fake provider only chooses the next tool call.

| Case | Single | Batch | Delegation | Resume | Real child | What proves the boundary |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `native-single-review` | yes | - | - | - | yes | one `plan-reviewer` record whose own child read hashes to the snapshot; the normal `[OKAY]` is `APPROVED`, and a second same-SHA review is denied with `PRC_ALREADY_APPROVED` |
| `native-batch-review` | - | yes | - | - | yes | two requests in one turn: one child, one `PRC_*` denial |
| `native-auto-progress-allows` | yes | - | - | - | yes | round 1 and round 2 reviewer receipts carry different structured blocker keys; the third request is allowed at 2/3 and a third real child is created |
| `native-auto-sha-only-denies` | yes | - | - | - | yes | round 1 and round 2 carry the same blocker key; the third request is denied with `PRC_NO_PROGRESS_SAME_BLOCKER` and only two children exist |
| `native-owner-findings` | yes | - | - | - | yes | the host-written deny row carries `[PRC_NOTICE]` + the four classifications, evidence line and duplicate key; a foreign-round finding is dropped |
| `native-delegation-handoff` | - | - | yes | - | yes | H0 executor prompt carries `APPROVED` + real receipt id; after a real plan edit H1 carries `UNVERIFIED PLAN_SHA_MISMATCH` |
| `native-handoff-freshness` | - | - | yes | - | yes | same flow as its own `--case all` row: H0 approval, H1 stale rejection, reviewer count 1 |
| `native-resume` | - | - | - | yes | yes | a real `[REJECT]` child, the question published from the host deny row, an explicit `yes` answer, one hash-bound manual launch and an `APPROVED` manual receipt |
| `native-r83-replay` | yes | - | - | - | yes | owner request `review_round_limit: 1` holds after a draft says 83 and a real edit; second request adds no child |
| `native-r84-prehash-denied` | - | - | - | yes | yes | the real r83 historical answer predates this revision; `RESUME_HASH_NOT_BOUND` is logged, the manual and additional-auto counters stay 0, and no child is created |
| `native-r84-hash-bound-once` | - | - | - | yes | yes | two fresh host processes read the same real answer transcript; one consumes it and one reviewer is created; the manual rejection then blocks auto |
| `native-r84-intent-denied` | - | - | - | yes | yes | a real question answered with `no` and with a quoted `yes` authorizes no manual reservation |
| `native-recovery` | - | - | - | - | yes | a second host process keeps the persisted stop and adds no child |
| `probe-forged-records` | - | - | yes | yes | yes | forged task record (role/child/terminal/plan/snapshot) and a forged owner answer all stay unverified |
| `probe-forged-handoff` | - | - | yes | - | yes | a forged `[PRC_HANDOFF APPROVED]` executor prompt gets a recomputed UNVERIFIED notice and the real rejection findings |
| `stock-handoff-freshness` | - | - | yes | - | yes | the stock package replays H0 and H1 with no managed notice (stock boundary is missing) |
| `boundary-stock-replay` | yes | - | - | - | yes | the isolated stock package admits a second review; candidate does not (runs `stock-second-review` and `candidate-second-review` as separate processes) |

`--case all` runs every row. The stock replay is a copied package, never the live install; candidate runs use a copied package with the `Lk`/`Ca` wrapper applied by `patch.mjs`. `boundary-stock-replay` is a meta-case: it runs `stock-second-review` and `candidate-second-review` as separate processes so one host's shutdown cannot colour the other's evidence.

## Observed stock decisions

| Scenario | Gate result |
| --- | --- |
| `plan-reviewer`, user requested `ulw-plan`, plan artifact present | allow |
| same, no user request | deny |
| same, no plan artifact | deny |
| same, draft `review_round_limit` 1 or 83 | allow both |

The gate does not read the draft's `review_round_limit`; the field is not part of `stateFor`. The isolated stock replay additionally shows the second child is actually spawned.

## Recorded actual call (r83)

- Reservation: `J:5816` recorded `review_round_limit: 83` and `status: launching`.
- Launch: `J:5827-5831` admitted `st_01a203eb` (`plan-reviewer`) with the same limit.
- Result: `st_01a203eb` returned `[REJECT]` against `ab92ce5d927336a74dfdddd4c404db8e08ae7f378fcf0dd59e07245fe02ec5d1`.
- Child count for this recorded call: **1**.
- Owner answer: the host transcript holds `ask-user:question` -> `ask-user:settlement(answered)` -> the `inputSource:"extension"` answer frame. That chain, not an environment variable, authorizes the one-shot resume.

## Decision

The stock gate is real and is the only pre-spawn check, but it has no budget, no receipt binding, and no progress judgment. The smallest managed delta belongs at the `Lk`/`Ca` call site, before `plan-reviewer` creation, and consults the host-owned ledger plus the host task record. The source attestation and the isolated replay agree: stock admits the second child, the candidate denies it.

## Limitation

The source anchors are evaluated in a VM; that evaluation is provenance, not acceptance. Acceptance for this boundary comes from the isolated replay rows above, each with a real host process and real task records. The normal first approval now requires the reviewer's own child read, so a host without that event closes as `UNSUPPORTED_BY_HOST`. The owner-chat assistant row and a card publish/consume event are absent from the host transcript; the notice is a toolResult row and the handoff is a prompt prefix, so those boundaries stay unsupported. Live installation, live settings changes and a real owner-visible card remain outside this candidate and require separate approval.
