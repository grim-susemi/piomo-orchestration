# Luna 지정 백업 수리

기존 `task-no-fallback-pkg`의 차단 정책 위에 소유자가 지정한
`chatgpt-subscription/gpt-6-luna:low` 예외만 둔다. 역할 기본 모델과
Google 경로 및 설정 파일은 바꾸지 않는다.

## 원인과 범위

비공개 실행 영수증은 실제 단일 호출을 관측한 기록이다.
계획, 저장 입력, spawn에는 Luna low가 있었다. 첫 누락은 기존 사용자
확장의 `stripRecordFallback`이 작업 JSON을 쓰기 직전에 삭제하는 지점이다.
spawn에는 남아 있었으므로 기록 생략만의 문제는 아니었다.
같은 child의 `getRetryFallbackSettings`가 `modelFallback:false`를 강제해
실행 전환도 차단했다. 본체 planner 결함이 아니다.

`patch.mjs`는 두 함수의 해당 부분만 바꾼다. 기존 확장 원본과 그 설명은
`original.js`에 그대로 보존한다. 생성되는 `candidate.js`의 선두 설명은 기존 차단
정책의 역사이며, 현재의 좁은 예외는 두 수정 함수와 이 문서에 정의한다.
다른 모델, 잘못된 추론 강도, 전역 비활성 설정은 여전히 통과시키지 않는다.

## 재현과 검증

```sh
LUNA_GUARD_TARGET="<installed-guard-file>" node --test probe.test.mjs
node patch.mjs --candidate "<installed-guard-file>"
LUNA_GUARD_TARGET="<this-folder>/candidate.js" node --test probe.test.mjs
node patch.mjs --apply "<installed-guard-file>"
node patch.mjs --check "<installed-guard-file>"
```

기존 설치본: 8개 중 지정 백업 관련 3개 실패, 나머지 5개 통과.
후보: 8개 모두 통과. 이 대조가 변경을 제거했을 때 같은 결함이 재발하는
증거다. 시험은 실제 파일 게시, 정책 경계, 다른 모델 차단을 확인한다.
실제 모델 실행과 부모 반환은 별도의 실사용 영수증으로 판정한다.

## 설치와 갱신

설치 대상:
`<agent-dir>/task-no-fallback-pkg/omo-task-no-fallback.js`

원본 SHA256:
`38c425f04338441641980f6e8d3fa1993728072a2cf8cc1b6700f91e935de505`

후보 SHA256:
`0d44f7d6a7ef6db3c8126983fa17d1a80c64f719d09d565a36e040952181ff99`

설치기는 원본 해시와 각 앵커 1개를 확인하고 원본 사본 및 인접 백업을
보존한다. 이미 적용된 후보는 재설치하지 않는다. 알 수 없는 바이트는
덮어쓰지 않는다. 디스크 설치 후 기존 프로세스의 캡처된 래퍼가 남으므로
해당 수리 대화만 정상 종료하고 같은 대화로 한 번 재기동한다.
원스휴먼 대화는 이 수리에서 재개하지 않는다.

갱신 때 `--check` 후 새 공식 파일을 `LUNA_GUARD_TARGET`으로 지정해 동일
행동 시험을 돌린다. 패치 없는 공식 파일이 지정 백업 보존 및 다른 모델
차단 시험을 모두 통과하면 이 델타를 은퇴시킨다. 실패하면 새 바이트에서
원인을 재확인하고 해시/앵커를 다시 도출한다. 앵커 부재를 해결로 보지 않는다.

기존 전체 관리 검사의 coordination 핀 불일치는 별개로 보존한다.
현재 `task-no-fallback-pkg`의 보존 소스와 원장 설치 핀은 적용된 후보를 가리킨다.
이 폴더의 행은 원본과 최소 델타·프로브를 보존한다. 다른 핀은 바꾸지 않는다.

## 파일 소유권

공개 파일은 `patch.mjs`, `probe.test.mjs`, `original.js`, 이 문서다.
개인 실행 영수증·재시작 체크포인트·로그·설정은 공개하지 않는다.
최종 결과 JSON에 파일별 SHA256과 작성 종료 여부를 남긴다.
