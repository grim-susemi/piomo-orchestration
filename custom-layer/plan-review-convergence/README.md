# plan-review-convergence (candidate)

검토 루프 개선 후보. **설치·활성화·원격 커밋하지 않는다.** 실사용 경로는 별도 승인 범위다.

## 구성

- `state.mjs` — 작업공간·계획별 영속 예산 원장(`B/U/status/launchKey/...`)과 CAS·잠금.
- `owner-resume.mjs` — 중단 뒤 해시에 결속된 소유자 1회 수동 예약.
- `receipt.mjs` — 실제 `plan-reviewer` 완료·응답 바이트·스냅샷을 현재 계획 SHA에 결속.
- `convergence.mjs` — 지적 분류(실제 차단/중복/범위 밖/근거 미확인)와 진전 원장.
- `display.mjs` — 소유자 알림·인계 카드(H0/H1) 렌더러.
- `extension.mjs`/`patch.mjs` — 후보 호스트의 스폰 경계 `Lk`에 `__prcGate` 관리 델타 주입.
- `probe.mjs`/`boundary.md` — 격리 stock/candidate 재생 러너와 경계 판별.

## 검증

- 단위: `node --test custom-layer/plan-review-convergence/test/*.test.mjs`
- Task 8 native: `task-8-native*.tap`, `task-8-native-r84-once.json`, `task-8.json`(probe).
- F2: `f2.tap`(budget/resume/receipt/convergence).
- 유지보수: `node --test custom-layer/plan-review-convergence/test/maintenance.test.mjs custom-layer/test/check-patches.test.mjs`

## 유지보수 판정

`maintenance.mjs`의 `classifyMaintenance`:

- `candidate-pass` — 앵커·근거가 완전하고 후보의 실제 재생이 통과.
- `official-conforms-retire-candidate` — 공식 stock이 모든 실제 케이스를 충족; 은퇴 추천.
- `needs-review` — 앵커·대상 해시·근거가 불완전; 자동 적용 금지.

## 경계·차단

- 실제 소유자 메시지 게시와 다음 실행자 인계 소비: **`BLOCKED_NO_BOUNDARY`** — 현재 델타는 `Lk` 스폰 게이트만 연결한다.
- 라이브 설치·설정 변경 0건; 자동 적용·롤백·푸시 없음.
- 원장 행: `custom-layer/PATCHES.md`의 `plan-review-convergence`; 검사기: `custom-layer/check-patches.mjs`의 같은 이름.
