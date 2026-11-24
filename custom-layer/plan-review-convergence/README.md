# plan-review-convergence (candidate)

검토 루프 개선 후보. **설치·활성화·원격 커밋하지 않는다.** 실사용 경로는 별도 승인 범위다.

## 구성

- `state.mjs` — 작업공간·계획별 영속 예산 원장(`B/U/status/launchKey/...`)과 CAS·잠금. 예약은 기대 리비전을 확인하고, 미결 예약과 중복 실행 키를 거절하며, 첫 원장 생성에는 관측된 스폰 요청이 필요하다.
- `owner-resume.mjs` — 중단 뒤 해시에 결속된 소유자 1회 수동 예약. 답변은 환경변수 ID가 아니라 호스트 세션의 `ask-user:question → ask-user:settlement(answered) → inputSource:"extension" 답변` 체인에서만 읽는다.
- `receipt.mjs` — 실제 `plan-reviewer` 완료·종료 이벤트·자식 세션·응답 바이트·검토 스냅샷 바이트를 결속. `reviewedBodySha256`은 스냅샷 바이트에서 계산하며 계획 SHA를 복사하지 않는다.
- `convergence.mjs` — 지적 분류와 **다음 회차 리뷰 결과 기반** 진전 판정. 예약 회차의 결속 REJECT와 다음 회차의 구조화 차단 키를 비교해 같은 키 재발은 `SAME_BLOCKER`, 다른 키/APPROVED는 허용, 리뷰 결과 없음은 `NO_REVIEW_RESULT`로 닫는다. 계획 문장의 어휘·극성·순서를 판정하지 않는다.
- `display.mjs` — 소유자 알림·인계 카드(H0/H1) 렌더러. 알림 첫 줄에 전달 ID를 붙인다.
- `handoff.mjs` — 스폰 경계에서 검토 바이트를 동결하고, 실제 호스트 task 레코드·자식 세션·종료 이벤트와 현재 바이트를 비교해 `APPROVED`/`UNVERIFIED`를 판정하는 인계 리졸버. 자식 세션의 실제 `read` 도구 결과 바이트가 스냅샷 SHA와 같을 때만 승인한다. `bindReceipt`의 실제 호출자다.
- `lead-submission.mjs` — 리드가 제출한 지적 후보를 영수증·응답 SHA·검토 스냅샷에 결속해 검증하는 경계. 리뷰어 응답의 JSON/불릿은 수납 근거가 아니다.
- `extension.mjs`/`patch.mjs` — 후보 호스트의 스폰 경계 `Lk`에서 stock 결정 뒤, 최종 반환 전에 `__prcGate`·`__prcHandoff` 관리 델타 주입. `PRC_PROGRESS_ALLOW` 같은 플래그는 없다.
- `workflow-contract.md` — 유한 기본·중단/재개·승인 요건을 한 번 기록.
- `probe.mjs`/`boundary.md` — 격리 stock/candidate 재생 러너와 단일/배치/위임/재개 커버리지 맵.

## 검증

- 단위: `node --test custom-layer/plan-review-convergence/test/*.test.mjs`
- 격리 재생(후보 전체): `node custom-layer/plan-review-convergence/probe.mjs --variant candidate --case all --out <evidence>/candidate.json`
- 격리 재생(stock 경계): `node custom-layer/plan-review-convergence/probe.mjs --variant stock --case boundary-stock-replay --out <evidence>/stock.json`
- F3 위임/H1: `native-delegation-handoff`, `stock-handoff-freshness` 케이스가 실제 executor 자식의 프롬프트에서 H0 승인과 H1 `PLAN_SHA_MISMATCH`를 관측한다.
- 유지보수: `node --test custom-layer/plan-review-convergence/test/maintenance.test.mjs custom-layer/test/check-patches.test.mjs`, 그리고 `node custom-layer/check-patches.mjs --only plan-review-convergence --behavior`(또는 이미 찍힌 실제 보고서로 `--behavior-evidence <dir>`).

## 현재 한계 (fail-closed)

- 자식 세션에 `read` 도구 결과가 없거나 그 바이트가 스냅샷과 다르면 승인 receipt는 `UNSUPPORTED_BY_HOST`/`CHILD_READ_SHA_MISMATCH`로 닫힌다. 가짜 승인은 없다.
- 리드 제출 파일이 없거나 결속이 어긋나면 반려는 유지되지만 지적은 표시하지 않고 `PRC_FINDINGS_REQUEST`만 낸다.
- ask-user UI가 없는 모드에서는 질문을 호스트 거절 행에서 발행한다. 인용된 답변·`no`·질문보다 오래된 답변은 거부하고 수동 재개는 `OWNER_QUESTION_...`/`OWNER_ANSWER_MISSING`으로 닫힌다.
- 카드 게시·실행자 소비는 미구현이며 승인 경로에서 제거했다. 실행자 프롬프트의 H0 승인·H1 `PLAN_SHA_MISMATCH` 표시까지만 구현했다.

## 유지보수 판정

`maintenance.mjs`의 `maintenanceFromReports`는 실제 probe 보고서에서 판정을 파생한다:

- `candidate-pass` — 격리 stock 재생이 두 번째 검토를 허용하고, 후보의 단일/배치/자동진전/무진전/소유자 지적/재개/위임/인계/한도 재생/사전해시/단회/복구/forged 케이스가 모두 실제 자식과 함께 기대 상태를 만족.
- `official-conforms-retire-candidate` — stock 재생이 이미 후보와 같은 계약을 충족; 은퇴 추천.
- `needs-review` — 앵커·근거·케이스 중 하나라도 빠지거나 실패; 자동 적용 금지.

## 경계·차단

- managed delta: 단일 `Lk` 스폰 게이트 + `handoff.mjs`(호스트 task 레코드와 live SHA로 `APPROVED`/`UNVERIFIED` 판정) + `workflow-contract.md`. 실제 소유자 알림·다음 실행자 handoff 소비의 표면 QA는 F3에서 미검증이다.
- 라이브 설치·설정 변경 0건; 자동 적용·롤백·푸시 없음.
- 원장 행: `custom-layer/PATCHES.md`의 `plan-review-convergence`; 검사기: `custom-layer/check-patches.mjs`의 같은 이름.
