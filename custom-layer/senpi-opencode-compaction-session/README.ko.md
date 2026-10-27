# senpi-opencode-compaction-session

## 무엇을 고치나

senpi 2026.10.21-3(omo 5.1.44)의 기본 압축(`compaction.model`)이
`opencode-go` 모델(예: `opencode-go/muse-spark-1.3-contributor`)을 쓸 때
`400 MissingSessionID`로 거부된다. 원인은 압축 요약 요청이
`options.sessionId`를 provider에 넘기지 않아 `x-opencode-session` 헤더가
붙지 않는 것이다. 일반 대화 요청은 `sessionId`를 넘기므로 정상이고,
압축 경로만 빠져 있었다.

이 패치는 `speculative-summary.js`의 `generateSummaryMessage`가
opencode/opencode-go 모델에 한해 현재 세션 id를 전달하게 하고, 번들에
복제된 같은 함수에도 같은 전달을 넣는다. `opencode` provider 래퍼가
`options.sessionId`를 `x-opencode-session`으로 바꾸는 기존 로직을 그대로
사용하므로 헤더를 직접 위조하지 않는다.

## 적용 대상

- 전역 설치: `C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi`
- 레인 런타임 스냅샷: `<agent>/runtime/<snapshot>`
  (`599a2a2d…`, `bb7a5bb4…`, 그리고 stock `.senpi`의 `bf255b91…`)

패치 스크립트는 `dist/core/extensions/builtin/compaction/speculative-summary.js`와
`async function generateSummaryMessage` 앵커를 가진 모든
`dist/bundle/chunks/chunk-*.js` / `session-worker.js`를 자동으로 찾는다.

## 적용·점검·되돌리기

```bash
node patch.mjs --senpi-root <senpi-root> --check
node patch.mjs --senpi-root <senpi-root> --apply --receipt <file>
node probe.mjs --senpi-root <senpi-root>
node patch.mjs --senpi-root <senpi-root> --remove
```

- `--check`는 읽기 전용. `pristine` / `patched` / `unknown`을 JSON으로 낸다.
- `--apply`는 앵커가 정확히 한 번인지 확인하고 `.opencode-session.bak`을
  남긴 뒤 원자적으로 교체한다. 이미 패치된 파일은 건드리지 않는다.
- `--remove`는 마커가 있는 파일만 백업으로 되돌린다.
- `probe.mjs`는 런타임 모듈 그래프를 import하지 않고 설치된 바이트에서
  두 연결(요약 요청의 `sessionId` 전달, provider 래퍼의 헤더 생성)을
  확인한다. `defect-absent`가 기대값이다.

## 업데이트 때

새 senpi/omo로 올린 뒤, 세션을 재시작하기 전에 전역 설치와 모든 런타임
스냅샷에서 `patch.mjs --check`를 실행한다.

- `patched`면 유지.
- `unsupported`면 새 버전의 `generateSummaryMessage` 원문을 다시 읽고
  앵커를 재도출한다. 앵커가 사라졌다고 자동으로 retire하지 않는다.
- 공식 원본이 이미 `sessionId`를 넘기면 `probe.mjs`가 `defect-absent`를
  내는지 확인한 뒤 `--remove`로 은퇴한다.

`node custom-layer/check-patches.mjs --only senpi-opencode-compaction-session`
가 설치와 레인 스냅샷의 상태를 한 번에 보여준다. 검사기는 프로세스 안의
실제 로드를 확인하지 않으므로, 재시작 뒤 실제 압축 1회는 별도 수용
단계다.

## 실사용 확인 (2026-10-27)

세션 `01a16913-cb31-7d6b-8104-ed254b1b3fec`가 630,528 토큰에서 같은
`MissingSessionID`로 두 번 막혔다. 패치 적용 뒤 세션을 재시작하고
`/compact`를 실행하자:

- `[compaction] compacted from 630,528 tokens`
- 세션 JSONL에 `compaction` 엔트리 추가
- 상태줄 `21K/1M (2.0%)`
- `MissingSessionID` 재발 없음

이 확인은 패치된 번들을 실제로 로드한 새 프로세스에서 수행했다.
