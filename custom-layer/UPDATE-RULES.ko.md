# 업데이트 때 커스텀 보존 규칙

대상 목록은 [`PATCHES.md`](PATCHES.md) 하나뿐이다. 이 문서는 그 행 이름별로 업데이트 때 지킬
규칙만 담는다. 행을 여기에 다시 나열하지 않는다.

2026-10-21에 omo-check 스킬의 `references/stable-500-custom-patches.md`에서 옮겨 왔다.
옮긴 규칙은 그대로 두고, 대상 경로처럼 원장과 겹치는 내용만 원장으로 넘겼다.

소유자 요청: 업데이트할 때 R19뿐 아니라 조금씩 적용한 커스텀도 에이전트가 기억해서
빠짐없이 처리한다. 개별 패치 이름을 다시 요청할 필요가 없다.
`omo-check`와 업데이트 절차는 업데이트나 점검을 요청받았을 때만 이 문서를 따른다.
예약 실행이나 무단 설치를 뜻하지 않는다.

## 1. 먼저 실제 적용 상태를 읽는다

- 레인은 `C:/Users/USER/.omo-stable-500`, 홈은 `<lane>/home`, 설정 루트는 `<home>/.omo`다.
  실제 설치는 `C:/Users/USER/.bun/install/global/node_modules`에 있다.
- `omo.cmd`의 실행 파일·플러그인·재진입·버전, `agent/settings.json`의 확장 경로,
  `agent/extensions`의 연결 파일과 그 대상, 각 제품의 현재 세대 기록을 읽는다.
- `node custom-layer/check-patches.mjs --strict --json`을 실행하고 출력을 증거로 남긴다.
  - exit 1(fail): 실패를 고치거나 원장을 바로잡기 전에는 업데이트를 진행하지 않는다.
  - exit 3(incomplete): `unverified` 줄마다 처리 결과를 업데이트 영수증에 적는다.
  - 원장에 없는 새 사용자 확장이 나오면 `PATCHES.md`에 행을, 검사기에 같은 이름의 행을
    추가하고 근거와 검증 방법을 함께 적는다.
- 원장의 세대 번호는 기록 시점의 스냅샷이다. 이후에는 실제 연결을 따르고 옛 세대를 덮어쓰지 않는다.
- 파일 존재, 해시 보존, 실제 로드, 기능 작동은 서로 다른 결과다. 미시험은 미시험으로 남긴다.

## 2. 모든 행에 공통으로 적용

1. 현재 연결된 세대·외부 경로·실재 파일·해시·새 엔진에 의존하는 API를 먼저 기록한다.
   `current.json`과 연결이 다르면 어느 쪽이 실제로 로드되는지 확인하고, 임의로 되돌리지 않는다.
2. 항목마다 **유지 / 새 버전용 재이식 / 공식 수정으로 대체(은퇴) / 판정 불가**로 분류하고
   근거를 남긴다. 파일 보존만으로 기능 호환이 끝났다고 보고하지 않는다.
   공식 원본에서 행동 프로브를 실행한다. 프로브가 코드를 알아보지 못하면 판정 불가로 남긴다.
3. 업데이트 전에 필요한 소스·활성 세대·연결·상태·설정을 보존한다.
   원본 패키지 변경과 독립 확장 보존을 나누고, 다른 세션의 새 변경을 옛 백업으로 덮어쓰지 않는다.
4. 수정이 필요하면 해당 제품의 기존 시험과 격리 동작을 먼저 통과시킨다.
   화면이 있는 기능은 실제 화면에서 확인한다. 소유자 창은 함부로 닫거나 재시작하지 않는다.
5. 새 실행에서 실제 로드와 해당 기능의 시험 범위를 남긴 뒤 원장을 현재 상태로 갱신한다.
   사용자에게 R19 등 개별 이름을 다시 기억해서 지시하라고 요구하지 않는다.

상황판·대시보드 등은 원본 패키지 패치가 아니라 독립 확장이다. 업데이트 때 무조건 다시
설치하지 않고, 실제 연결·대상 파일 보존과 호환성을 확인한다.

## 3. 행별 규칙

### memory-overlay (R19 → R21 메모리 거래 원복)

원본 글로벌 번들을 직접 고치지 않는다. 다음 업데이트 때:

1. 실제 활성 wrapper·재진입·generation·manifest·의존성 연결과 현재 사용자 설정을 읽고,
   이번 업데이트 백업 범위에 **활성 수정 사본과 선택 경로**도 포함한다.
2. 새 배포 tarball의 실제 구현을 확인한다. PR #10000 병합이나 버전 번호만으로
   포함됐다고 판정하지 않는다. 기준 커밋은 `4406c7776ca6582cc206819fadc1b34a060d4729`
   (2026-10-21 현재 PR head는 `dd86ddb7f9fd919ed4921bca2668c0016be7817e`).
   필요한 동작은 일반 커밋 실패의 거래 경로만 원복, DirtyRepoError 보존,
   기존 no-effective-change·보안 검사 유지, Git literal pathspec 처리다.
3. 공식 배포본에 동등 수정이 있으면 그 배포본에서 같은 회복 시험을 통과시킨 뒤
   새 stock 실행 경로로 전환하고 선택을 해제한다. 소스·이력은 보존하고 행을 은퇴로 갱신한다.
   병합만 됐고 아직 배포되지 않았으면 그대로 유지한다.
4. 없으면 새 배포본을 기준으로 필요한 변경만 새 관리형 사본에 재이식한다.
   옛 minified 심볼명·사본·해시나 R19를 그대로 복사하지 않는다. 기존 도구의 해시 거부는
   정상 보호이므로 값을 바꾸어 우회하지 않는다.
5. 실제 memory 도구와 실제 Git 훅으로 실패 파일 원복·다음 정상 저장, 실패 중 이웃 편집 보존,
   대소문자 별칭·대괄호 경로·기존 검사 유지 여부를 격리 시험한다.
   `build/test-captured/native-scenarios.mjs`(원래 `test/`)는 **그 버전의 소유자를 실제 로드하는지
   확인한 뒤** 재사용한다. 옛 `test/patch.test.mjs`는 R18/5.1.34 전용이므로 새 버전 검사로 오인하지 않는다.
6. 승인된 업데이트 범위 안에서 byte-preserving 설치와 새 wrapper/reentry를 함께 전환한다.
   새 일반 실행에서 수정 소유자 1개, 기존 사용자 확장 로드, 설정 보존, 오류 없는 정상 종료를 확인한다.
   설치됨과 기존 창의 캐시를 구분하고 완전 종료·재실행 조건을 안내한다.
7. 버전 고정·gate·선택 경로를 함께 갱신한다(`stable-500-launcher` 행). stock updater는 실제 Bun 설치를
   유지해야 하며 수정 사본 경로에서 잘못된 npm 대상을 고르지 않게 한다. 글로벌 패키지만 먼저 올린 채
   옛 경로를 남기면 버전 gate가 실행을 거부한다.

이력:
- 2026-10-19: 5.1.38 업데이트에서 위 절차 수행 — generation `memory-rollback-5.1.38-r1`, wrapper R21.
  5.1.38 catch는 업스트림이 stranded-lock 분기(zG→zV)를 추가해 모양이 바뀌었다. 그 분기를 맨 앞에
  보존하고 바인딩(wB=DirtyRepoError, OK, LV)을 재도출했다. 격리 시험은 senpi 2026.10.19 격리 트리
  (`staging/upgrade-5.1.38/scratch-tree`, 환경변수 `MEMORY_ROLLBACK_SENPI_ROOT`)에서 baseline 결함
  재현/patched 회복 PASS. 컷오버 7단계 PASS, 기동 프로브 cmd·reentry PASS(소유자 1개, 67 확장,
  커스텀 11개 전부 로드), 보존 1399파일 drift는 런타임 `state.json` 1건.
  영수증 `C:/Users/USER/.omo-stable-500/staging/upgrade-5.1.38/WORKING.md` + `install/CUTOVER.json`.
- 2026-10-18: 5.1.35에서 같은 절차(2·4·5·6·7) 수행 — generation `memory-rollback-5.1.35-r1`, wrapper R20,
  격리 baseline/patched PASS, 기동 프로브 2종 PASS, 커스텀 804파일 해시 보존.
  영수증 `C:/Users/USER/.omo-stable-500/staging/upgrade-5.1.35/WORKING.md` + `install/CUTOVER.json`.
- 최초 설치·복구 기록: `C:/Users/USER/orca/projects/piomo-memory-rollback/MAINTENANCE.md`(5.1.34;
  `evidence/installation.json`, `evidence/FINAL-REPORT.md`), `C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.35/MAINTENANCE.md`.

### stable-500-launcher

`memory-overlay` 7단계와 같이 움직인다. `--strict`의 `pin-consistency`가 실패하면 글로벌 패키지와
wrapper/reentry/manifest 핀이 어긋난 상태다. 캡처 사본을 레인에 되돌려 쓰지 않는다.

### omo-briefing (상황판·짧은 채팅 보고)

연결·현재 세대·사용자 상태를 보존하고 새 엔진의 도구·답글·보고 이벤트 계약을 확인한다.
소스 변경이 필요할 때 제품 저장소의 기존 `npm run check`를 쓴다. 실제 브라우저 표시와 답글 전달은 따로 확인한다.

### omo-herdr-dashboard

실제 현재 세대와 todo/worker/DAG 상태·복구 자료를 보존한다. 새 실행에서 확장 로드와 소유한 시험 pane의
표시를 확인한다. 이전 세대 번호를 재설치하지 않는다.

### omo-oracle-advisor

2026-10-18 설치(generation-000001). 도구 4종(oracle_consult·bind_seed·record_stop·advisor)이 세션에 등록되고
비활성·오류 기록이 없는 것을 확인했다(온디맨드 대기). 연결·세대·정책 파일을 보존하고 새 실행의 로드를 확인한다.

### settings-guard (설정 유실 경고)

소유자 선택은 **알림만**이다. 보호 키 유실 시 경고·사본 보존, settings.json 자동 복원 금지.
새 엔진의 설정 저장과 충돌하지 않는지 격리 확인하고, 의도한 설정 변경을 덮어쓰지 않는다.

### task-record-publish-retry (작업기록 게시 재시도)

Windows의 작업기록 임시 파일 rename에만 제한된 보정이다. 새 엔진의 저장 경로·임시 파일 규칙·재시도
구현과 대조한다. 공식 보정이 동등하면 이중 적용을 제거하고, 유지하면 대상 오류 재시도·비대상 오류
전달·상한 뒤 오류 전달을 격리 검증한다. 범위를 일반 파일 쓰기로 넓히지 않는다.

### herdr-agent-sidebar-repair (Herdr 세션 연결 보정)

외부 소스 경로까지 보존한다. 엔진 내장 Herdr 확장을 import하므로 새 API·metadata·resume argv·자기 확장
중복 제외를 확인한다. 기존 repair의 PLAN/QA/RESULT 기록을 읽고 공식 수정이 동등하면 중복 보정 제거를 판단한다.

### user-config-selection (사용자 모델·역할·메모리·설정 선택)

현재 사용자 선택과 모델 재정의(컨텍스트·출력 상한·추론 수준 포함)를 보존한다. 파일별 실제 소비자를
확인하고 새 설정 형식·공식 프리셋과 충돌한 항목만 조정한다. 옛 모델 튜닝 TS나 고정 모델 값을 자동
부활시키지 않는다. 인증·사용자 데이터는 원래 위치에 보존하고, 검토 증거·공유 사본에는 내용을 넣지 않는다.
구체적인 설정 값 이력은 이 공개 저장소에 적지 않는다(omo-check 스킬 쪽 로컬 메모).

### omo-compaction-model (요약 모델 실사용)

새 엔진의 `getCompactionModel`이 아직 공급자 소진 때만 설정 모델을 쓰는지 확인한다. 상류가 고쳤으면
은퇴 후보. 유지하면 `ExtensionRunner` `bindCore`/`dispatchEmit`·runner 필드 존재를 확인하고 격리 시험
정상·멈춤·실패 3종, 새 실행의 `agent/logs/omo-compaction-model.jsonl` `session-start`에서 설정 모델을 확인한다.

### coordination-adapters (협업 모드)

모드 3도구는 패키지로 로드되고, 어댑터는 네이티브 엔진 연결용으로 오버레이·전역 `omo-task.js`에 적용된다.
**어댑터가 없으면 도구 호출이 `unsupported_runtime`/`capture_missing`으로 거절된다(실호출 실측) — 핵심 기능
정지**이므로 새 버전에서는 재빌드와 레인 사본 적용이 필수다. 재빌드 때 앵커를 재검증하고 영수증을 갱신한다.

이력:
- 2026-10-18: 5.1.35 업데이트로 전역 파일이 원본으로 교체됨. 레인은 오버레이 사본을 로드하며 어댑터는
  원래 미적용(프로브 `carrierPresent:false`). 재빌드는 상황판 결정 #170 → 소유자 착수
  (`.omo/drafts/coordination-adapter-5135-rebuild.md`).
- 2026-10-19: 새 창 렉의 원인이 이 모드였다. `exposeTools`가 런타임 이벤트마다 `listOwned`(작업 기록 전체
  동기 stat, 1회 112~351ms)를 호출했다. `src/extension.ts`에 1초 목록 재사용을 넣어 설치본 dist를 해시
  보호 교체(9c512cd8→564af63c, 82/82, 영수증
  `C:/Users/USER/orca/projects/기타 작업/.omo/evidence/lag-diag-20261019/LAGFIX-RECEIPT.json`; 봉인 receipt
  인벤토리는 옛 해시라 제거 전 백업 복원 필요).
- 2026-10-19: 5.1.38 재빌드 실적용. VERSION 게이트 2026.10.19, 어댑터 베이스라인 36d98c7a → 후보 2b559bb1을
  오버레이·전역 `omo-task.js` 2곳에 해시 보호 적용, 설치본 dist 564af63c → 25583d00(렉 수리 유지).
  앵커 12개 재도출, 전체 시험 80/82(실패 2건은 baseline 옆 node_modules 누락 → 해당 파일 재시험 5/5),
  acceptance PASS, 임시 사본 적용·제거·재적용 PASS, 새 세션 coordination_* 도구 3개·경고 없음.
  영수증 `C:/Users/USER/orca/projects/piomo-agent-coordination-mod/.omo/evidence/agent-coordination/attempt-5138-rebuild-e1/live-install/LIVE-APPLY-RECEIPT.json`.

### 앵커 패치 (senpi-freeze-fix 등 `patch.mjs`/`probe.mjs`를 가진 행)

각 패치 폴더의 README와 `probe.mjs`가 규칙이다. 새 공식판에서 `probe.mjs`를 먼저 실행해
`defect-present`면 재적용 또는 앵커 재도출, `defect-absent`면 은퇴 검토, `needs-review`면 추측하지 않는다.
senpi 패치는 설치본뿐 아니라 모든 runtime snapshot에 적용돼야 실제로 동작한다.

### task-no-fallback-pkg, early-compaction

원장의 은퇴 조건을 따른다. early-compaction은 새 senpi 버전에서 `scripts/mod.mjs`의 자격 확인을
다시 통과해야 유지한다.

early-compaction 재자격 순서(2026-10-22 19-2에서 확인):

1. `PIOMO_SENPI_DIR=<전역 senpi> node scripts/mod.mjs qualify --agent-dir <agent>`
   - 레인 홈에서는 HOME이 달라 senpi를 못 찾으므로 `PIOMO_SENPI_DIR`이 필요하다.
   - QA는 기본으로 협업 모드 main checkout(`piomo-agent-coordination-mod`)을 빌드한다.
     그 checkout이 설치된 협업 모드와 같은 커밋인지 먼저 본다.
   - 협업 모드 포트가 main에 합쳐지기 전이면 `PIOMO_QA_CM_ROOT`로 그 worktree를 가리킨다.
2. 통과하면 `node scripts/mod.mjs install --agent-dir <agent>`로 `qualified.json`을 반영한다(config는 유지된다).
3. `mod.mjs status`가 `active`이고 `qualified_versions`에 새 버전이 있는지 본다.

### cli-anything

제3자 사본이다. 출처(저장소·버전·라이선스)를 기록하기 전에는 `--strict`가 미검증으로 보고한다.
업데이트 때 트리 해시 보존과 새 실행의 명령 등록만 확인한다.

### pr-watch-script

omo-check 스킬은 작업공간 사본을 실행한다. 저장소 사본은 경로를 일반화한 공개용 이식본이며
두 사본의 동작이 같다는 시험은 아직 없다. 한쪽을 고칠 때 다른 쪽이 따라 바뀐다고 가정하지 않는다.

## 4. 별도 패치로 재적용하지 않을 것

- `agent/extensions/diff.js`, `files.js`, `prompt-url-widget.js`, `tps.js`는 설치된 엔진 내장 확장을
  가리키는 host-generated shim이다. 커스텀 원본으로 저장해 옛 엔진 경로에 고정하지 않는다.
  새 엔진에서 존재·로드만 확인한다(`--strict`가 내용으로 식별한다).
- 과거 npm 레인의 네 슬롯, 이전 memory-selector 사본, 없는 `omo-model-tuning.ts`, 과거 GLM 행·옛 모델
  프로필은 역사 기록만으로 자동 복원하지 않는다. 현재 파일·연결·사용자 선택이 있을 때만 관리 대상으로 삼는다.
- pr-watch는 이 원장 전체를 검사하는 스크립트가 아니다. 원장 검사는 `check-patches.mjs --strict`가 한다.
  새 상시 감시·예약·자동 설치는 없다.
