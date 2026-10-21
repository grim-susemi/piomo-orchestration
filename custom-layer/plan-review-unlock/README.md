# Explicit plan review after execution

Removes only the historical `ulw-execute` prohibition for `plan-consultant` and
`plan-reviewer`. Explicit user `ulw-plan` requests and a real plan artifact remain
required. Reviewer path binding and one-shot behavior are unchanged.

The tracker currently counts reading `skills/ulw-execute/SKILL.md` as invocation,
so even reference-only exploration can lock review for the rest of a conversation.
This patch removes that prohibition, not the workflow approval boundary.

## Check and apply

From the repository root:

```sh
node --test custom-layer/plan-review-unlock/test/patch.test.mjs custom-layer/test/check-patches.test.mjs
node custom-layer/plan-review-unlock/probe.mjs --omo-root <omo-package-root>
node custom-layer/plan-review-unlock/patch.mjs --omo-root <omo-package-root> --check
node custom-layer/plan-review-unlock/patch.mjs --omo-root <omo-package-root> --apply
node custom-layer/check-patches.mjs --only plan-review-unlock
```

Apply separately to the stable overlay package and installed global omo package.
Only `plugin/extensions/omo-task.js` contains this gate. The main `omo.js` only
contains related documentation and is not modified. Backups use
`.plan-review-unlock.bak`; all files are preflighted and unrelated changes are
preserved. Applying twice is a no-op. This version is qualified for omo-ai 5.1.38.

Already running processes retain their imported functions. Disk application does
not prove that an existing conversation has reloaded them; test a new process and
report old conversations separately. Do not restart unrelated sessions.

## Update lifecycle

Before and after every update run `check-patches.mjs`. On the new official package,
run `probe.mjs` first:

- `defect-present`: reapply only when the version and exact anchors are qualified;
  otherwise rederive the delta in this repository and run the tests.
- `defect-absent`: inspect the two still-required prerequisites, retire this patch
  when the official implementation already allows review after execution.
- `needs-review`: the probe cannot establish the contract; do not guess or apply.

The ledger checks earlier patches by undoing only this exact delta in memory and
comparing the **entire** resulting baseline hash. Unrelated corruption remains
drift. No commits or upstream publication are implied by installation.

## 한국어 요약

실행 전후 고정밀 계획 검토를 다시 요청할 수 있게 과거 실행 이력 차단만 제거한다.
사용자의 계획 요청·계획 파일 확인·검토 신원 확인은 유지한다. 기존 대화는
이미 읽은 코드를 계속 쓸 수 있으므로 설치와 재시작 후 동작을 구분해 보고한다.
