# Boundary: plan-review admission

## Result

**`managed-delta`.** The stock 5.1.69 host has exactly one pre-spawn plan-review gate and no review-budget field. The gate allows a second `plan-reviewer` call whenever the user requested `ulw-plan` and a plan artifact exists; the recorded r83 call changed the draft limit from 1 to 83 and a new child was still admitted. The exact source and consume anchors are the `Lk` spawn policy and its single `Ca(...)` call.

## Baseline observed

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `P/plugin/extensions/omo-task.js` | 1317047 | `719c1eac06b34bac708506fd62b6d4614b8ceb25c39c3fe10f9b2e03547d9eb7` |
| `P/package.json` (version `5.1.69`) | 546 | `2e8441299591f4941d19a2120727bb64d1d6485a12802adf4a73429926f066b4` |
| Senpi bundle `dist/bundle/cli.js` | 26259 | `5711189e5c20229d0df66c3905232980ac045750e57679aa833aedb99f86c95e` |
| `S/omo.cmd` (live pin `5.1.81`) | 13858 | `a39a6cf78f703d82b7e128b10de97ffd621d8eb9c512b5d42294208fe3104cdd` |

The `P` baseline is 5.1.69 (the r83 session's package). The live `omo.cmd` pin is 5.1.81; it is recorded separately and is not treated as the baseline.

## Exact anchors

- Gate definition: `function Ca(e,t){let n=Ma(e);...}` at source offset **144658** (`Ca(` token at 144667); `Ca` is the only `function Ca` in the host.
- Spawn policy: `function Lk(e,t,n,r){...}` at source offset **313804**; it calls the gate exactly once as `Ca(r,e.resolveSkillInvocations?.(n)??Pa)` at source offset **313904**.
- Trusted state provider: `stateFor:e=>(...hasUserRequested...hasPlanArtifact...)` at source offset **1284771**.
- `review_round_limit` occurrences in `omo-task.js`: **0**.
- `plan-consultant` and `plan-reviewer` both have `requiresSkills:["ulw-plan"]`, `requiresPlanArtifact:true`, `forbidsSkills:[]`.

## Observed decisions

| Scenario | Gate result |
| --- | --- |
| `plan-reviewer`, user requested `ulw-plan`, plan artifact present | allow |
| same, no user request | deny |
| same, no plan artifact | deny |
| same, draft `review_round_limit` 1 or 83 | allow both |

The gate does not read the draft's `review_round_limit`; the field is not part of `stateFor`. The existing `plan-review-unlock` extension only removes the historical `forbidsSkills` entry for these roles; it does not add a budget, a trusted owner-event binding, or a receipt check. It is not the boundary for this plan.

## Recorded actual call (r83)

- Reservation: `J:5816` recorded `review_round_limit: 83` and `status: launching`.
- Launch: `J:5827-5831` admitted `st_01a203eb` (`plan-reviewer`) with the same limit.
- Result: `st_01a203eb` returned `[REJECT]` against `ab92ce5d927336a74dfdddd4c404db8e08ae7f378fcf0dd59e07245fe02ec5d1`.
- Child count for this recorded call: **1**.

## Decision

The stock gate is real and is the only pre-spawn check, but it has no budget. The reproduction shows the missing boundary (limit 83 accepted). The smallest managed delta belongs at the `Lk`/`Ca` call site, before `plan-reviewer` creation, and must consult the host-owned budget state. Task 4 supplies the state, Task 8 binds the actual entry points, and F3 executes the actual host.

## Limitation

Task 2 evaluates the actual host source in a VM and uses the recorded r83 call; it does not start a new host process. The report therefore records `loadedInProcess: false`, `evaluatedInVm: true`, `launchesFromHost: 0`, and the recorded child count. Task 8/F3 must exercise the actual spawned path before any candidate pass. Candidate edits in this task: **0**.
