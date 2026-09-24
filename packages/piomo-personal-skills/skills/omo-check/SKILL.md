---
name: omo-check
description: OMO 통합점검. 프체크, 올체크, PR 상태, 리빌드, 업그레이드 확인, 커스텀 패치, 내 PR 어떻게 됐어, 업데이트 패치 과정 같은 말에 발동. PR 6건 상태+개발자 멘트+리빌드 판정, 전역 omo 버전, 커스텀 보존, 업데이트 패치 과정을 한 번에 점검하고 바뀐 것만 보고.
---

# omo-check — OMO 통합점검 (PR·업그레이드·커스텀·업데이트패치)

사용자가 "프체크"(별칭 유지), "올체크", "PR 어떻게 됐어", "리빌드할 거 있어?", "업그레이드 확인해줘", "내 패치 깨졌어?", "업데이트 패치 과정 봐줘" 같은 말을 하면 이 스킬이 발동한다. 읽기 전용이 기본이다.

## 실행 (고정 절차, 판단 금지)

일반 호출도 항상 최신 beta를 조회한다. 1·2는 아래 명령 한 번으로 함께 수행하고, 새 beta가 있으면 준비 상태까지 자동 보고한다. 1·2·5는 증거 스냅샷 저장 외 읽기 전용이며, 3(백업)·4(설치)는 각각 명시적 승인 후에만 실행한다:

1. 보기(점검): `--upgrade`를 포함한 스크립트 실행 → PR 6건·버전·커스텀 상태 보고.
2. 새판 확인: 같은 실행에서 registry beta vs 로컬 밀림, 커스텀 4종 충돌 위험,
   `*-upgrade/pre/manifest.json` 전체 탐색으로 해당 beta용 백업 준비 여부까지 보고. 엔진 프리셋(`prompt-preset/` .js 목록) 변경분도 함께 보고 — 본품 모델별 튜닝이 바뀌면 우리 덧씌움과 겹칠 수 있어서 별도 판정. 설치·수정 실행 없음.
3. 짐싸기(백업): 올리기 전 커스텀 4종(조율파일·집규칙·모델목록·지휘문구백업)을
   `.omo/evidence/beta<NN>-upgrade/pre/`에 복사. 더해 금번 추가분(loose 모델튜닝+테스트·후크 패키지·리포트 CLI)도 같은 폴더에 복사. 별도 승인 없이 하지 않음.
4. 올리기(승인 후 실행): 사용자가 "올려"라고 하면 overlay 방식으로 업그레이드.
   npm 잠금(EBUSY) 시 즉시 중단하고 보고. 잠긴 파일은 건너뜀.
5. 물건확인(검증): 버전·도움말 동작 + 커스텀 4종 바이트 동일 + 지휘문구 존재 확인 후 보고. 더해 기능 3종 초록 확인(튜닝 suite·후크 픽스처·리포트 CLI --help 수준 실행)과 메인 모델 네이티브 프리셋 겹침 1회 프로브 — 겹치면 덧씌움 유지/조정 판정으로 보고.

1. 스크립트 실행 (클론 루트 고정 경로):
   - 항상 (클론 루트에서): `node scripts/pr-watch.mjs --upgrade`
   - 기본 점검과 레지스트리 beta 조회·커스텀 충돌 위험·pre 백업 점검을 한 번에 수행한다. 옵션 없는 기본 실행은 레지스트리를 조회하지 않으므로, 그 출력의 새 beta 표시를 실행 조건으로 삼거나 중복 실행하지 않는다.
   - exit 0 확인. 스냅샷은 `.omo/evidence/pr-watch/<stamp>.json`에 자동 저장.
2. 출력 diff 보고:
   - 새 beta로 밀림이 확인되면 변경 유무와 무관하게 해당 beta·커스텀 충돌 위험·백업 준비 여부를 보고한다. 조회 실패는 확인 불가로 보고하며 최신으로 단정하지 않는다.
   - 위 보고 사항과 바뀐 게 모두 없으면 "바뀐 거 없음" 한 줄로 끝.
   - 있으면 항목별 한 줄씩: PR(상태/머지가능/리뷰/코멘트 변동), ENV 버전 변동, CUSTOM 깨짐(sha 변경·directive 소멸·floor 변동).
3. 리빌드 판정 (스크립트 출력 + 아래 규칙):
   - OPEN+CONFLICTING → 다시밀기 대상 (rebase 후 푸시, 별도 승인 필요). 현재 수리 대상 4건: senpi #899 #913 #927, oh-my-openagent #6740.
   - OPEN+MERGEABLE draft → 유지 (현재 senpi #912 hold).
   - OPEN 관찰 → 손대지 않음 (남의 PR #7268, 지켜보기만).
   - 종결 7건은 폴링 제외, 역사 기록으로만 유지: CLOSED #6533 #6848 #6850 #6973 #7231, MERGED #7082 #7102 (대체 관계 #6850→#7082, #6973→#7102, #6848/#7231→#7268).
4. 절대 자동 수행 금지: 공개 PR 조작(comment/close/rebase/merge/push), 백업 없는 전역 업그레이드 실행. 필요하면 별도 승인 요청.

## 커스텀 추가점검 — GLM-5.3 max (2026-09-24 추가)

올라마 GLM-5.3·5.3-flash의 추론단계 max가 pi 엔진 기본 맵(OLLAMA_THINKING_LEVEL_MAP max→high)에서 접히는 것을 models.json 오버라이드로 우회한 커스텀 수정. models.json은 커스텀 4종(모델목록) 바이트 보존 점검에 포함되지만, 아래 3건은 별도 확인한다(모두 읽기 전용·수정 금지):

1. 행 생존: `~/.omo/agent/models.json` `providers.ollama.modelOverrides`에 `glm-5.3`·`glm-5.3-flash` 행(7키 맵, max:"max") 존재. 사라졌으면 백업 `models.json.bak-before-glm53-max-20260924` 대조해 보고. — **기본 점검(1·2)에서도 매번 확인.**
2. 미러 일관성 (데스크톱 로컬 스크립트, 클론 미번들 — 클론에서는 실행 불가): `powershell -NoProfile -ExecutionPolicy Bypass -File "<user-desktop>/OpenCode_Modes/OMO_Native_ReasoningLevels.Tests.ps1"` → FailedCount 0(53/53). 실패 시 psm1 미러 드리프트 의심 보고. — **5단계(물건확인) 때 실행.**
3. 엔진 드리프트: pi-ai(`.../node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`)의 `OLLAMA_THINKING_LEVEL_MAP`·`getSupportedThinkingLevels` 계열이 기존과 달라졌으면 "미러 재실측 필요"로 보고(재실측 수정은 별도 승인). — **5단계(물건확인) 때 실행.** 원본 pi(earendil-works/pi) HEAD에서는 이 맵이 이미 제거돼 있으므로, 연규 포크가 원본을 재동기화하는 업데이트에서는 이 점검이 거의 항상 발동할 것.

근거·복구(백업 3종 경로 포함): memory `notes/facts/2026-09-24-ollama-glm53-max-reasoning-diagnosis.md`의 "업그레이드 대응 체크리스트" 절.

## 추적 대상 (활성 6건)

- 수리 대상 4건: senpi #899 #913 #927, oh-my-openagent #6740.
- 유지 1건: senpi #912 (OPEN draft hold).
- 관찰 1건: oh-my-openagent #7268 (OPEN, 남의 PR이라 지켜보기만).

## 보고 형식 (한국어 1/2/3, 쉬운 말)

1. 핵심 결과: 바뀐 것만 한 줄씩. 단, 새 beta로 밀림·준비 상태 또는 조회 실패는 반드시 보고하고, 모두 없으면 "바뀐 거 없음".
2. 쉽게 말하면: 쪽지 비유 (밖의 쪽지=PR, 집안 물건=커스텀, 이사=업그레이드). 파일명·영어 금지.
3. 다음 권장 조치: 승인 필요한 것만 (리빌드 N건 시키면 별도 작업으로).

## 주의

- `code-yeongyu` 계정의 sisyphus-bot 영어경고는 개발자 멘트가 아니다. 보고 시 "봇 경고"로 명시.
- `gh` 조회 실패 시 UNKNOWN으로 표기하고 다음 항목 계속 (1건 실패가 전체를 막지 않음).
- 기본 점검은 증거 스냅샷 저장 외 읽기 전용. 백업·설치는 각각 명시적 승인 후에만 수행하며, 제품 코드 수정·신규 구현 없음.
