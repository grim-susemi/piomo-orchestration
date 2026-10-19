# 독립 Herdr reporter 코드 검토

검토자: OmO 주 에이전트. 날짜: 2026-10-13.
범위: 새 production 파일 `repair/herdr-senpi.mjs` 전체와 이를 검증하는
`test/repair.test.mjs`, `test/real-launch.test.mjs`, 두 launcher/probe fixture.
이는 실행 QA와 별개의 코드 검토 기록이다. 원래 source-patch 조사 보고서나
독립 gate 보고서를 이 검토서로 대체하지 않는다.

## 결론

staged repair 경계에서 blocking 구현 결함을 찾지 못했다.
이번 보완은 문서뿐이며 production/test 코드를 변경하지 않았다.
실사용 승인이나 기존 누락 복구가 완료됐다는 결론은 아니다.

## 검토 방법과 기준

두 skill 파일을 직접 읽고 아래 관점을 적용했다.

- `C:/Users/USER/.bun/install/global/node_modules/omo-ai/plugin/skills/remove-ai-slops/SKILL.md`
- `C:/Users/USER/.bun/install/global/node_modules/omo-ai/plugin/skills/programming/SKILL.md`

정리 작업 요청이 아니라 read-only 코드 검토이므로 removal workflow,
추가 refactor, dependency 설치는 실행하지 않았다. 언어는 JavaScript
ESM `.mjs`다. programming의 Python/Rust/TypeScript/Go 전용 compiler,
typed-error, exhaustive-match 규칙을 JS에 적용해 통과했다고 주장하지
않는다. 공유 원칙의 재사용·경계·async·오류·테스트 검토는 아래에 명시한다.

## remove-ai-slops 관점

| 기준 | 관측 및 판단 |
| --- | --- |
| 자명한 주석·debug leftovers | production에 설명 중복 주석, TODO, debug 출력이 없다. fixture 출력은 실행 증거를 위한 것이며 production logging이 아니다. |
| 과도한 방어·오류 은폐 | 불필요한 catch/fallback을 추가하지 않았다. header I/O는 `finally`로 닫고 오류를 stock 호출자에게 전달한다 (`herdr-senpi.mjs:45-53`). |
| 과도한 복잡도 | production은 55 nonblank/noncomment LOC다. 변환은 own-path, metadata, label/resume 세 경계뿐이다 (`:10-40`). 새 reducer나 retry 정책이 없다. |
| 불필요한 추상화 | exported factory는 stock dependency interface를 유지하며 unit transport seam을 제공한다 (`:10-41`). default entry는 실제 loader 계약이다 (`:43-58`). 둘 다 실제 호출자가 있다. |
| 경계 위반·숨은 결합 | private installed factory import는 명시된 version-coupling이다 (`:5`). 이 설치 조합의 opt-in repair로 제한했다. global discovery/파일을 수정하거나 다른 socket의 write를 바꾸지 않는다 (`:15-17`). |
| dead code | 모든 production import와 두 entry가 사용된다. 사용하지 않는 compatibility/helper 경로가 없다. |
| 중복 구현 | stock factory/client/reducer/lifecycle를 복사하지 않았다. 두 clear flag의 공통 변환은 한 loop이며 scope가 metadata RPC에만 한정된다 (`:20-27`). |
| 숨은 성능 비용 | 각 reporter message의 JSON parse/serialize 1회, loaded paths의 한 번 filter다. benchmark 없이 별도 최적화나 caching을 추가하지 않았다. |
| 행동 coverage | 네 unit test는 RPC label/source/session/seq/resume, self-deferral, 다른 reporter 양보, unnamed clear flags를 관측한다. 실제 host test가 downstream acceptance와 native-exit/replacement 경계를 별도로 관측한다. |
| oversized production module | production 55 pure LOC로 250 ceiling 아래다. integration test의 긴 lifecycle narrative를 production module 규모나 새 abstraction 정당화로 사용하지 않았다. |

## programming 관점

- **재사용/root cause:** stock reporter가 Pi와 같은 effective label을
  공유하는 소실 경계를 분리한다. 표시 문자열만 바꾼 UI 수정이 아니다.
  state/reducer/client를 다시 구현하지 않았다 (`herdr-senpi.mjs:11`).
- **입력·책임 경계:** `socket.write` 입력은 사용자가 준 임의 JSON이 아닌
  installed client's NDJSON request다. 그 wire 경계에서만 parse하고
  자신의 socket만 rewrite한다 (`:15-18`, `:36`). upstream 신뢰 계약을
  또 검증하는 schema/fallback layer를 추가하지 않았다.
- **부분 dispatcher:** metadata method와 Pi label만 선택적으로 변환하고
  나머지는 그대로 전달한다 (`:20-36`). 모든 protocol variant를 새로
  소유하는 dispatcher가 아니므로 알려지지 않은 method를 막는
  exhaustive switch를 넣지 않았다.
- **소유권/단위:** session reference와 source/seq를 재생성하지 않는다.
  release에 resume argv를 붙이지 않는다 (`:28-34`). self filter는
  자기 resolved path만 제외하고 타 사용자 reporter는 남긴다 (`:13-14`).
- **오류/resource:** open/read 실패를 조용히 성공으로 바꾸지 않는다.
  file close는 finally 보장이다. Socket.write의 bound receiver와
  나머지 인자는 유지한다 (`:17-18`, `:36`).
- **async:** unit transport가 queueMicrotask로 connect/NDJSON ACK를
  전달하여 stock async client를 실제 사용한다. host test는 trigger
  전에 구독하고 exact event/ACK를 bounded timeout으로 기다린다
  (`real-launch.test.mjs:40-63`, `:246-340`). sleep/polling으로 성공하지 않는다.
- **API/parameter:** 새로운 public service/type 계약이 없다. deps object는
  installed factory의 실제 dependency interface이며 positional parameters를
  감추기 위한 새 config wrapper가 아니다. native write rest arguments는
  기존 overload를 전달하는 용도다.
- **품질 도구:** Node syntax와 unit 실행은 최초 gate에서도 재현했다.
  LSP는 미설치로 미검증이다. 이 프로젝트에는 package/lint/typecheck
  config가 없으며 JS를 TS strict-build PASS로 표현하지 않는다.

## 과적합·테스트 slop 검토

1. **불필요한 테스트:** four unit cases가 서로 다른 실패 경계를 잡는다.
   baseline host case는 원래 소실을, repair host case는 동일 결함의
   회피와 전체 lifecycle를 검증한다. 조사 단계의 과거 테스트를 새
   구현의 최신 PASS 수에 합산하지 않았다.
2. **삭제만 확인하는 테스트:** unnamed case는 omitted fields뿐 아니라
   downstream이 소비하는 clear flags도 검증한다. 다른 reporter case의
   요청 없음은 ownership 양보 계약을 관측한다.
3. **동어반복/구현 미러링:** production source text를 grep해 녹색을
   만드는 테스트가 없다. wire 필드, registry row, session identity,
   release 수를 관측한다. resume argv는 실제 consumer 계약이고 cold
   fixture가 기록된 값으로 실제 재개한다 (`real-launch.test.mjs:343-359`).
4. **prose 고정:** 이름 설명·prompt 문구·문서 문장을 pin하지 않는다.
   비교하는 fixture title은 runtime 고유 marker이며 이전 metadata가
   남는지 확인하는 machine field다 (`:324-329`).
5. **mock fidelity:** unit은 stock factory/client를 사용하고 transport
   ACK만 fake한다. server acceptance는 실제 Herdr registry로 별도 검증한다.
   ACK나 released event만으로 등록 상태를 단정하지 않는다.
6. **검증용 불필요한 production 추출:** exported factory는 위의 real
   dependency seam이다. test 편의를 위한 새 parser/reducer/cache가 없다.
7. **임의 normalization:** path lowercasing은 이 Windows 설치의 자기
   entry 식별에 한정된다. empty metadata 변환은 API의 clear contract다.
   session/source/seq에는 별도 정규화가 없다.
8. **유지보수/범위:** hardcoded private import과 SDK version coupling은
   남는 제약이다. 이를 범용·portable extension이라고 판매하지 않는다.
   fixed fixture profile은 이 프로젝트의 직렬 실험용이며 병렬 suite
   격리 성능을 검증한 주장도 아니다.

## 근거와 남는 한계

- 현재 구현의 observed GREEN: unit 4 + real-host 2, exit 0.
  실행 excerpt: `repair/TEST-RUNS.txt`.
- 최초 gate는 syntax + unit 4를 직접 실행해 통과했고 구현 결함을 찾지
  못했다. 그 verdict는 필수 prior review artifact 누락으로 REJECT였다:
  `.omo/evidence/herdr-sidebar-independent-repair-gate-review.md`.
- 실제 화면 QA는 `repair/QA.ko.md`와 세 `evidence/repair-*.png`다.
  이 문서 보완으로 runtime tree는 바뀌지 않아 화면 증거는 동일 구현이다.
- provider 호출, owner hot migration, daemon restore, 기존 세 대화
  live 복구는 여전히 미실행이다. 구체적 opt-in/원복 제안은
  `repair/ACTIVATION.ko.md`이며 별도 승인이 필요하다.
- 이 검토서는 lead-authored 코드 검토다. 독립 gate의 최종 APPROVE를
  대신하거나, LSP/portable-version 검증을 했다는 증거가 아니다.
