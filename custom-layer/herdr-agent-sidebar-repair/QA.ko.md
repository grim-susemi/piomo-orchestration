# 독립 Herdr reporter 수리 QA

## 범위와 최종 구현

실사용 미적용. 수정 경계는 이 프로젝트이며 설치 bundle, global home,
owner pane 입력/등록/종료/포커스는 변경하지 않았다.

구현: `repair/herdr-senpi.mjs`

- stock factory/reducer/client를 재사용한다. 설치 파일에 patch하지 않는다.
- 자기 entry만 양보 검사에서 제외한다. 다른 사용자 reporter는 숨기지 않는다.
- 세 lifecycle label을 `senpi`로 보낸다. source/session/sequence는 보존한다.
- resume에는 `omo --extension <entry> --session <reference>`를 기록한다.
- 이름 없는 새 세션의 빈 metadata는 공식 clear flag로 정리한다.

검증한 설치 조합은 OMO 5.1.32 / Senpi 2026.10.12 / Herdr 0.9.3이다.
private factory import이므로 업그레이드 후 동일성을 재검증해야 한다.

## 실제 코드·로더 증거

실행기는 pinned Node + installed bundle CLI + installed OMO plugin이라는
stock interactive 실행 경로를 사용한다. stock `omo.cmd` 자체는 global
state root를 강제로 설정하므로 실행하지 않고, fixture wrapper가 같은
실행 요소와 brand를 쓰되 state root만 `isolated/baseline`으로 바꿨다.
이 차이를 "변경 없는 stock launcher 실행"이라고 표현하지 않는다.

실제 host의 session-start stack은 이 프로젝트의 isolated snapshot
`runtime/651852241c988b73-4d63ae59570c/dist/bundle/chunks/chunk-5AVFHHDF.js`
를 가리켰다. 전체 loadedExtensionPaths에 `<builtin:herdr>`, stock OMO
entry, probe와 candidate entry를 확인했다. candidate는 한 번 로드됐다.

builtin 번들의 같은 chunk 828행에서 세 Pi labels, deferral, caching,
state subscriptions, quit-only release를 직접 읽었다. 실제 reporter
요청은 fixture-only proxy로 검증했다. proxy는 네 reporter method와
자체 pane ID만 허용한다. ACK 뒤 실제 agent list도 확인했다.

원본 소실 재현은 native Pi를 먼저 획득하고 reporter를 정상 host reload로
연결하는 제어된 순서다. reporter pause는 자체 fixture에만 주입했다.
native 획득이 동일 effective label 아래 공개 이벤트에 안 보이는 문제를
고정 sleep으로 우회하지 않았다. 이 조건을 숨긴 재현이라고 주장하지 않는다.

## RED / GREEN

- `REPAIR_VARIANT=stock node --test test/repair.test.mjs`:
  label과 self-deferral 두 요구에서 실패했다.
- opt-in 없는 resume command도 별도 RED로 확인했다.
- unnamed metadata clear도 별도 RED로 확인했다.
- 최종 `node --test test/repair.test.mjs`: 4개 PASS, exit 0.
- 최종 `HERDR_QA_WINDOW_HANDLE=657382 node --test test/real-launch.test.mjs`:
  실제 bundle baseline 및 repair integration 2개 PASS, exit 0.
- new scripts의 Node syntax check는 exit 0이었다.
- LSP는 typescript-language-server 미설치로 실행하지 못했다. 설치하지 않았다.

기존 조사 단계의 테스트 6개를 이 구현의 최신 테스트 수로 합산하지 않는다.

## Lead-owned QA matrix

실행 QA와 별개인 필수 코드 검토 범위는 `repair/CODE-REVIEW.ko.md`다.
`remove-ai-slops`, `programming`, 과적합·test-slop 관점을 명시했다.

| 항목 | 실행/관측 | 기대 | 결과 | 근거 |
| --- | --- | --- | --- | --- |
| 실제 로더 | real-launch fixture의 stack/loaded paths | 실제 bundle, 단일 candidate | PASS | `test/real-launch.test.mjs` |
| 원본 baseline | actual host + native exit | Node 생존 중 Pi 등록 소실 | PASS | 같은 test의 baseline |
| 단일 reporting owner | 실제 proxy wire + registry | 세 agent 필드 모두 senpi, 중복 owner 없음 | PASS | 같은 test의 records 검사 |
| Working/Idle/Blocked | 실제 host의 wake/approval events | 대응한 registry 상태 | PASS | 같은 test의 state 검사 |
| Native exit | 종료 event 먼저 구독, child 정상 종료 | senpi 등록과 Working 유지 | PASS | 같은 test의 native exit 검사 |
| Stale sequence | 동일 source/세션에 seq 1 전송 | 최신 Working 보존 | PASS | `REPAIR_STALE_SEQUENCE_IGNORED` |
| Reload | 실제 `/diag-reload` | 동일 SID, release 없음 | PASS | `REPAIR_RELOAD_PRESERVED` |
| New session | 실제 `/diag-new` | 새 SID/ref, release 없음, 이전 이름 제거 | PASS | `REPAIR_NEW_SESSION_PRESERVED` |
| Quit | 실제 `/quit` | release 한 번, 목록에서 제거 | PASS | records 및 registry 검사 |
| Cold resume | 기록한 argv suffix만 실행 | 같은 SID, candidate 재로드 | PASS | `REPAIR_RESUME_PRESERVED` |
| Rollback | candidate args 없이 새 fixture 실행 | candidate 없음, stock Pi 복귀 | PASS | `REPAIR_ROLLBACK_STOCK_RESTORED` |
| Working 화면 | OS window-content capture | own repair 행 표시 | PASS | `evidence/repair-working.png` |
| Blocked 화면 | 같은 capture | own 행의 blocked 표시 | PASS | `evidence/repair-blocked.png` |
| Quit 화면 | 같은 capture | own 행 제거 | PASS | `evidence/repair-quit.png` |

실행 결과의 관측 excerpt는 `repair/TEST-RUNS.txt`에 있다. 표의 테스트
소스 경로는 실행 방법을 가리키며, 실행 결과 자체는 이 excerpt와 실제
monitored-run 결과가 근거다.

최종 화면은 `repair-pH9` 행을 주 에이전트가 직접 확인했다. Working의
orange dot, Blocked의 pink dot, Quit 뒤 행 제거를 확인했다. 다른 대화의
내용은 QA 대상이 아니다. desktop engine은 win32-x64 binary 부재여서
대신 Windows PrintWindow 기반 읽기 전용 캡처를 썼다. 포커스를 올리거나
키보드/마우스를 보내지 않았다. 첫 screen-copy의 가려진 화면은 기각했고,
window-content 방식으로 교체했다.

## 한계와 적용 경계

provider 호출은 하지 않았다. Working/Blocked는 실제 host의 producer
event를 fixture에서 발생시켜 검증했다. Herdr daemon 자체의 global
restart/restore나 기존 owner session 복구는 수행하지 않았다.
cold process restart + 같은 session 파일 재개는 검증했다.

원복은 opted-in session을 정상 종료한 후 새 pane에서 original arguments로
재개하는 경로다. 이미 실행 중인 candidate를 Pi로 hot-switch한 검증은
아니다. 기존 Pi reporter를 candidate로 바꾸는 live hot-reload도 이번
scope에서 수행하지 않았다.

현재 실사용 누락 세 pane은 별도의 승인 대상이다. 새 fixture의 성공을
기존 누락 복구라고 표현하지 않는다.
