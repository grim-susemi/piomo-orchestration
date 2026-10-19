# Herdr sidebar 독립 수리 결과

## 결과

승인된 로컬 구현·격리 검증·적용 제안 단계는 완료했다.
**Manual QA PASS / 독립 gate APPROVE / 남은 gate blocker 0개.**
실사용 설치·활성화·전역 설정 변경·기존 owner process 변경·커밋은 하지 않았다.
기존 OBS, OptiScaler, Muse 세 대화의 누락은 아직 복구하지 않았다.

## 확정한 원인과 수리

실제 interactive host가 로드한 bundle의 builtin reporter에서 세 Pi label,
user reporter 양보, unchanged-state cache, state subscriptions와 quit-only
release를 확인했다. 자체 fixture에서는 무관한 native Pi 종료 뒤
Node host가 살아 있는데도 실제 agent registry에서 Pi 항목이 사라졌다.
원본과 native가 같은 effective label을 공유하는 경계의 재현이다.

`repair/herdr-senpi.mjs`는 설치본을 patch하지 않는 opt-in entry다.
현재 설치의 stock factory/client/reducer를 재사용하고 자신의 요청에서만
세 label을 `senpi`로 분리한다. source/session/seq와 lifecycle는 유지한다.
자기 경로만 self-deferral에서 제외하며 다른 사용자 reporter는 숨기지 않는다.
기록하는 resume argv에는 이 entry도 포함한다. 이름 없는 새 세션은
공식 clear flags로 이전 표시 metadata를 제거한다.

이 결과를 소스 수준 `pi → senpi` 후보만 시험한 결과나 기존 live 복구로
표현하지 않는다. 실제 installed Node/CLI/plugin을 쓰고 writable state만
프로젝트 안으로 격리한 host 경로에서 검증했다. stock `omo.cmd`가 변경
없이 실행됐다는 주장도 아니다.

## 완료 기준과 증거

| 요청한 기준 | 현재 증거 |
| --- | --- |
| 실제 launcher/runtime/reporter grounding | `repair/PLAN.md`, `repair/QA.ko.md`, real-launch receipt assertions; r1 gate C1 |
| 최소 변경계획 및 로컬 독립 구현 | `repair/PLAN.md`, `repair/herdr-senpi.mjs` |
| RED/GREEN 회귀 | `test/repair.test.mjs`, `test/real-launch.test.mjs`, `repair/TEST-RUNS.txt` |
| 유효 단일 owner 및 타 reporter 양보 | unit 및 실제 registry/wire assertions; r1 C3 |
| Working/Idle/Blocked 및 무관한 Pi 종료 | real-host state/native-exit assertions; r1 C4 |
| session/source/sequence 보존 | unit RPC assertions, 실제 stale-seq 검사; r1 C5 |
| reload/new/quit | 실제 host replacement 및 registry absence 검사; r1 C6 |
| opt-in cold resume 및 원복 | 기록한 argv로 같은 SID 재개, fresh fixture stock 복귀; r1 C7 |
| 실제 Herdr 화면 | `evidence/repair-working.png`, `repair-blocked.png`, `repair-quit.png`; lead가 직접 확인 |
| 필수 코드 검토 범위 | `repair/CODE-REVIEW.ko.md`; r2 GR-REVIEW-COVERAGE CLOSED |
| 독립 gate | `.omo/evidence/herdr-sidebar-independent-repair-gate-review-r2.md`: APPROVE |
| 정확한 live 적용·원복 제안 | `repair/ACTIVATION.ko.md` |

현재 구현 테스트는 **unit 4 + actual-host 2 = 6개 PASS, exit 0**이다.
최초 gate도 syntax와 unit 4를 독립 실행해 통과했다. r2는 문서 변경분
검토이며 실행 코드를 바꾸거나 테스트/화면을 재실행하지 않았다.
기존 조사 단계 테스트를 이 6개에 합산하지 않았다.

최종 화면의 `repair-pH9` 행은 Working에서 orange, Blocked에서 pink,
Quit 뒤 제거됐다. 생성한 fixture pane 및 launcher가 남지 않은 것도 확인했다.

## 권고하는 실사용 다음 단계

전역 설치 대신 **OBS 한 대화부터 opt-in pilot**을 권고한다.
대상은 `w1:p9V` / `w1:t24`, **OBS NR DLSS5 플러그인 개발 재개**다.
적용 직전 현재 대상·시작 시각·SID·cwd·안전한 입력 대기를 다시 확인하고,
활성 child/DAG가 없는 때 정상 종료 후 같은 session 파일로 재개한다.

추가하는 것은 다음 실행의 `--extension`과
`C:\Users\USER\orca\projects\herdr-agent-sidebar-diagnosis\repair\herdr-senpi.mjs`
인자다. 정확한 전체 명령과 확인 조건은 `repair/ACTIVATION.ko.md:30`에 있다.
원복은 정상 종료 뒤 이 opt-in 인자만 빼고 같은 session을 다시 여는 방식이다.
pilot과 다른 두 대화의 확대 적용은 별도 구체적 승인이 필요하다.

## 남는 한계

- 검증 설치 조합: OMO 5.1.32 / Senpi 2026.10.12 / Herdr 0.9.3.
  private factory import이므로 업그레이드 후 재검증이 필요하다.
- LSP는 language server 미설치로 실행하지 못했다. 설치하지 않았다.
  lint/typecheck/security scan의 새 PASS를 주장하지 않는다.
- provider 호출, live hot migration, Herdr daemon restore, 기존 owner
  복구 및 같은 affected pane에서의 live rollback은 수행하지 않았다.
- actual-host transcript는 curated excerpt로 남았다. 원본 full wire
  receipts를 완전한 별도 immutable artifact로 보존했다는 주장은 아니다.
- gate의 nonblocking 유지보수 메모: 긴 host lifecycle test와 직렬
  fixture profile은 병렬 재사용 suite로 검증된 것이 아니다. 이 작업에서
  unrelated test refactor를 추가하지 않았다.

세 누락 대화 복구와 새 실행의 재발 방지는 다른 단계다. 이번 결과는
후자의 수리 구현과 격리 증거, 전자를 위한 승인 대상 제안까지다.
