# Task owned-work reclaim guard

Isolated candidate for OMO 5.1.40. **Not installed, activated or published.**
It connects the existing Senpi `AgentSession.isSessionBusy` contract to task
resident reclamation. No Senpi, terminal, recorder or product changes are needed.

## Delta

Six exact replacements affect only `plugin/extensions/omo-task.js`:

1. Read current session busy state through the native in-process handle.
2. Forward it through the resident adapter.
3. Protect automatic idle eligibility and its existing post-claim check.
4. Recheck capacity eviction after its claim; release the claim on refusal.
5. Report a refused capacity eviction as rejected, not as a freed slot.
6. Preserve the existing explicit cancellation park, including pending-send checks.

`parkTerminalResident` in this version is called from explicit cancellation.
It is not an automatic sweep. That explicit action retains its old behavior.
The automatic idle suspension/park is `wZ -> CJ`; it is blocked while owned work
is live. Explicit cancel and real shutdown continue to abort/dispose busy work.
After owned work settles, ordinary idle and capacity reclamation still operate.

Only the in-process handle contract changes, inside this one OMO bundle.
The Senpi getter already exists. RPC/process handle behavior is unchanged.
No new timeout, heartbeat, retry, recorder or concurrency setting is introduced.

## Deterministic isolated verification

From this directory:

```sh
node --test test/patch.test.mjs
node probe.mjs --omo-root C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package
node patch.mjs --omo-root C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package --check
```

The test reads the pinned installed source but never imports or writes it.
`transformText` creates an in-memory fixture copy. The probe extracts the actual
native handle, adapter, idle/capacity/park/dispose functions, then invokes those
copies in an isolated VM with a virtual clock and observed abort/dispose effects.
No fixture launches a shell or subprocess, waits on wall time, or creates background
load. The ordinary Node test runner is the only test process entrypoint.
The runtime boundary supplies changing busy values for live background and monitor
ownership; no real terminal process or OS cleanup is exercised.

Tests compare original RED behavior with candidate GREEN behavior. They cover
live background, monitor-only work, settlement, ordinary idle, idle/claim race,
capacity/claim race and claim refusal, automatic park, pending sends, explicit
cancel/park, shutdown, and live getter propagation. Inverse-delta tests preserve
all unrelated bytes. The installed-source hash is checked before and after.

## Update check and retirement

`patch.mjs --check` is read-only and returns:

| Action | Meaning |
|---|---|
| `reapply` | Defect reproduced, exact six anchors, qualified version and whole baseline hash. This is advice, not an installation. |
| `keep` | Our full candidate is present, inverse restores the qualified hash, and all behavior checks pass. |
| `rederive` | Defect reproduced on an unqualified version/hash/shape. Derive a new delta; do not auto-apply. |
| `retire` | The probe confirms fixed behavior without any exact candidate fragments. Independent review must confirm it is the official fix. |
| `needs-review` | Missing extraction boundaries, partial candidate, failing controls or unknown drift. No claim that an upstream fix exists. |

Partial candidates are `needs-review` whether RED or GREEN. Any unexpected scenario
error takes priority over otherwise reproduced defects and is also `needs-review`.

Unresolved/rederive CLI checks exit 3; bad arguments/read errors exit 2.
The behavioral probe exits 3 for unresolved extraction/control failures.
It does not count a known original RED as a harness/test failure.

There is deliberately **no installed-root `--apply` command** in this deliverable.
`patch.mjs` is read-only. The separate `installer.mjs` accepts
`--fixture-root <root> --apply|--remove` only for disposable roots below
`os.tmpdir()` named `task-owned-work-fixture-*`, with the explicit
`.task-owned-work-disposable.json` marker. It refuses the installed package.
Apply checks exact before/after hashes, preserves an exclusive backup and staging
files, rechecks the target before atomic replacement, and removes only its exact
delta. It never restores over unrelated drift. The fixture fence is not a live
deployment approval or a live installer entrypoint.

The shared ledger/checker now contain a candidate-only, uncommitted row and exact
owned-work inverse before plan-review normalization. Existing expected hashes are
unchanged. Deployment and replacing active sessions remain unapproved.

Run only the related fixture/registration integration tests with:

```sh
node --test --test-name-pattern="owned-work|every checker row|installed baseline accepts" test/installer.test.mjs ../test/check-patches.test.mjs
```

Retire only after a clean official source passes the entire behavioral probe and
independent review; changed minifier names that prevent extraction are
`needs-review`, not evidence of a fix. An update retaining the defect requires a
qualified reapply or a new exact delta, with the whole inverse baseline hash
checked so unrelated patches/corruption are not hidden.

## Limits and shared impact

The VM verifies the lifecycle decision and native-to-resident wiring, not Windows
process termination, PTY persistence, notification delivery or a running-session
cutover. The original G8 PID exits remain unknown. No product rerun was done.
An actually busy resident keeps its memory/slot until settlement; the tests ensure
settled and ordinary idle residents remain reclaimable.

The separately authorized no-model AgentSession contract probe was stopped before
initialization: this installed SDK creates `AuthStorage`/`ModelRuntime` and calls
`findInitialModel` when no model is supplied. The services-based factory reaches
the same path. No provider/auth/model selection, SDK import or real runtime probe
was executed. A supported no-selection construction seam remains a deployment
acceptance gap; a fake model/runtime is not a substitute.

## 한국어 요약

대화 답변이 끝나도 검사·감시가 살아 있으면 자동 회수가 작업실을 닫지 않게 하는
격리 후보다. 가상시간으로 원본의 실패와 후보의 통과를 비교하며 실제 설치본은
읽기만 한다. 명시 취소·종료는 그대로 동작한다. 설치·활성화·재시작은 미승인이고,
최종 독립 검토와 공유 적용 조율은 별도다.
