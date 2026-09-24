---
name: reference-adaptation
description: 외부 참조 구현을 해부하고 최소 슬라이스로 차용하는 워크플로. 포크(fork), 차용, 응용, adapt, 레퍼런스(reference-led), "이런 거 비슷하게" — reuse an existing implementation 이라는 트리거에서 시작된다. 전체 모듈을 복사하지 않고, 복사할 기능 슬라이스를 명시하고 계약을 먼저 읽은 뒤 해부 보고서를 작성하여 절단점에서 도메인 배선만 교체한다.
metadata:
  short-description: reference dissection & adaptation — 외부 참조 구현을 해부하고 최소 슬라이스로 복사·적응·검증하는 워크플로
---

# Reference Adaptation

외부(또는 기존) 구현을 레퍼런스로 삼아 기능을 차용·응용할 때, 감으로 복사하지 않고 구조적으로 해부하고 검증하는 6단계 워크플로. "이런 거 비슷하게 만들어줘", "이 라이브러리 fork 해서 우리 프로젝트에 붙여", "이 컴포넌트 재사용할 수 있어?" 같은 요청에서 실행된다.

## When This Skill Activates

다음 트리거 중 하나라도 해당하면 이 스킬을 먼저 실행한다:

- 사용자가 포크(fork), 차용, 응용, 레퍼런스, "이런 거 비슷하게", adapt, reference-led, reuse an existing implementation 등의 어휘를 사용한다.
- 기존 코드베이스, 외부 라이브러리, 오픈소스 컴포넌트, 라이브 사이트, 스크린샷, 인터랙션 예시에서 기능 슬라이스를 가져오려 한다.
- 참조 구현 전체를 복사하지 않고 최소 슬라이스만 차용하려 한다.

## Composition

- **프로젝트 UI 작업**: `uiux-work-harness` 흐름 안에서 실행한다. 어댑터(adapter), 티어(tier), 체인지 패킷(change packet) 구조를 따르며, 레퍼런스 획득은 프로젝트의 `docs/design/uiux-reference-implementation-contract.md` Reference Acquisition 섹션 계약에 종속된다.
- **일반 코드 작업**: 단독 실행한다. uiux-work-harness 없이 이 스킬의 6단계 워크플로만 적용한다.

## UI Reference Routing Table

레퍼런스 종류별 획득 소스와 규칙. 프로젝트 UI 작업에서는 아래 표가 `docs/design/uiux-reference-implementation-contract.md` Reference Acquisition 섹션의 구체적 실행 지침이 된다.

| 참조 종류 | 획득 소스와 규칙 |
| --- | --- |
| 기능 이름/설명만 | 패턴에 이름을 붙인다 (예: command palette, collapsible sidebar). beui.dev 카탈로그에서 가장 가까운 패턴을 찾아 실소스 1개를 live-fetch한다 (벤더 금지 — `~/.agents/skills/uiux-work-harness/references/external-sources.md` Tier C 규칙 준수). 컴포넌트 레지스트리 (shadcn registry directory / 21st.dev / Aceternity UI / Magic UI / Origin UI / registry.directory)에서 메커니즘만 차용한다 (토큰은 DESIGN.md). 프로젝트 내 형제 표면 재사용을 먼저 조사한다. |
| 스크린샷/정적 이미지 | `frontend` 스킬의 image-to-code 메커니즘(이름 기반 참조, 절대경로 하드코딩 금지)으로 토큰·기하·복사·상태·반응형 의도를 추출한다. visual-qa reference-fidelity로 결과를 검증한다. |
| 라이브 URL/사이트 | `frontend` 스킬의 clone-from-url 메커니즘(이름 기반 참조, 절대경로 하드코딩 금지)으로 실제 브라우저 + getComputedStyle로 런타임 진실을 추출한다. CSS 파일 파싱 금지. visual-qa reference-fidelity로 검증한다. |
| 인터랙션/모션 | `frontend` 스킬의 interaction-skill 계약(이름 기반 참조, 절대경로 하드코딩 금지). "never design an interaction from memory". beui.dev에서 가장 가까운 패턴의 실소스를 읽고 메커니즘(스프링 값·레이아웃 전략·진입/퇴장 순서·중단/역전)만 추출해 DESIGN.md 토큰으로 적응한다. |
| 컴포넌트 코드 | shadcn registry / 21st.dev / Aceternity UI / Magic UI / Origin UI / registry.directory의 복사 가능 TSX 소스에서 메커니즘·해부만 차용한다. 프로젝트 토큰은 DESIGN.md에서 결정한다. 저작권·라이선스 규칙(external-sources.md LICENSE RULES) 준수. |

## Phase 1: Borrow scope

복사할 기능 슬라이스를 명시한다. 모듈 전체가 아니라 최소 슬라이스를 정의한다.

- **슬라이스 정의**: "이 레퍼런스에서 무엇을 가져올 것인가?"를 한 문장으로 쓴다. 예: "command palette의 fuzzy 검색 + 키보드 네비게이션 슬라이스" (전체 command palette 프레임워크가 아님).
- **성공 기준 1줄**: 차용 완료 후 어떤 관측 가능한 동작이 성공인지 1줄로 명시한다. 예: "사용자가 Cmd+K 입력 시 검색창이 열리고 방향키로 결과 항목을 선택할 수 있다."
- **제외 항목 명시**: 가져오지 않을 것도 1-2줄로 적는다. 예: "레퍼런스의 테마 시스템, 아이콘 세트, 라우팅 가정은 제외."
- **스칼라 제한**: 복사 대상 파일 수, 컴포넌트 수를 미리 한정한다. "파일 3개 이하, 컴포넌트 2개 이하" 식으로 경계를 긋는다.

슬라이스와 성공 기준을 change packet에 기록한 뒤 Phase 2로 넘어간다.

## Phase 2: Contract-first reading

참조 슬라이스를 구현 코드부터 읽지 않는다. 계약(타입·스키마·시그니처) → 테스트(실행 가능한 명세) → 엔드투엔드 시나리오 순으로 읽고, 구현 코드는 마지막에 읽는다.

1. **타입 / Zod 스키마 / 시그니처**: 함수 시그니처, 타입 정의, Zod 스키마, 인터페이스를 먼저 읽는다. 입력·출력·불변 조건을 파악한다.
2. **테스트 (실행 가능한 명세)**: 참조 슬라이스의 테스트를 읽는다. 테스트가 명세다 — 테스트가 검증하는 동작이 슬라이스의 실제 계약이다. 테스트가 없으면 이 단계에서 characterization test 필요성을 Phase 5에 기록한다.
3. **엔드투엔드 시나리오 1개 추적**: 사용자 입력 → 최종 출력까지 하나의 시나리오를 끝까지 추적한다. 중간에 모킹된 경계가 있으면 기록한다.
4. **구현 코드 (마지막)**: 계약과 시나리오를 이해한 뒤 구현 코드를 읽는다. 구현이 계약과 일치하는지 확인하고, 구현에 종속된 가정(매직 넘버, 하드코딩된 경로, 환경 변수)을 기록한다.

## Phase 3: Anatomy report

참조 슬라이스의 해부 보고서를 1페이지 이내로 작성한다. change packet에 남긴다.

- **파일 역할 목록**: 각 파일의 역할을 한 줄로 적되, generic machinery (도메인과 무관한 범용 기계장치)와 domain wiring (특정 도메인에 묶인 배선)을 구분한다.
  - generic machinery: fuzzy 검색 엔진, 키보드 이벤트 핸들러, 가상 스크롤 유틸, 포커스 트랩 — 복사 후 재사용 가능.
  - domain wiring: 특정 라우트(`/settings`) 참조, 특정 스토어 키(`user.preferences`), 특정 권한 검사(`isAdmin`), 특정 CSS 클래스(`.schedule-row`) — 절단점에서 교체 대상.
- **데이터 흐름**: 입력 → 변환 → 출력까지의 데이터 이동 경로를 간단히 그린다. 상태 관리가 있으면 상태 전이를 표시한다.
- **불변식 (invariants)**: 슬라이스가 유지하는 불변식을 나열한다. 예: "선택 인덱스는 항상 결과 개수 범위 내", "열려 있을 때만 포커스 트랩 활성".
- **숨은 결합 (hidden coupling)**: 겉보기에 독립적이지만 암묵적으로 결합된 것을 기록한다:
  - CSS 클래스 의존 (`.cmd-palette-item` 같은 전역 클래스)
  - 저장소 키 (localStorage 키, 쿠키 이름, 스토어 경로)
  - 권한 가정 (`admin` 롤 체크가 슬라이스 내부에 숨어있는지)
  - 라우트 가정 (`/search` 경로 하드코딩, 특정 라우트 파라미터 존재 가정)
  - 환경 변수 / 전역 객체 참조
- **import 그래프**: 슬라이스 파일들의 import 관계를 간단한 트리로 그린다. 외부 패키지 의존성, 내부 모듈 의존성을 구분한다.

보고서는 1페이지 이내. 길어지면 슬라이스 범위를 다시 확인한다.

## Phase 4: Coupling audit + seam selection

해부 보고서를 바탕으로 결합도를 감사하고 절단점(seam)을 선택한다.

- **in/out imports 감사**: 슬라이스가 외부에서 import하는 것(in)과 슬라이스를 외부에서 import하는 것(out)을 나열한다.
  - in imports: 슬라이스가 의존하는 외부 모듈 — 복사 시 같이 가져올지, 대체할지, 제거할지 결정.
  - out imports: 슬라이스를 사용하는 외부 코드 — 복사 후 기존 호출자가 깨지지 않는지 확인.
- **호스트 가정 감사**: 슬라이스가 실행 환경에 대해 암묵적으로 가정하는 것을 나열한다. (전역 상태, 라우터, 테마 프로바이더, i18n, 인증 컨텍스트 등)
- **절단점(seam) 식별**: generic machinery와 domain wiring의 경계를 절단점으로 정한다. 절단점은 인터페이스(함수 시그니처, props, 이벤트 핸들러)여야 한다 — 구현이 아니라 계약에서 자른다.
- **결정표 작성**: 각 요소에 대해 copy / adapt / re-wire / re-implement 중 하나를 결정한다:

| 요소 | 결정 | 이유 |
| --- | --- | --- |
| generic machinery (fuzzy 검색 등) | copy | 도메인 무관, 그대로 복사 |
| domain wiring (라우트/스토어/권한) | re-wire | 절단점에서 프로젝트 도메인 배선으로 교체 |
| 일부 인터페이스 (props/API) | adapt | 프로젝트 타입 시스템에 맞춤 |
| 외부 의존성 중 불필요한 것 | re-implement | 최소 슬라이스에 맞게 단순화 |
| CSS 클래스 / 디자인 토큰 | adapt | 프로젝트 DESIGN.md 토큰으로 교체 |

## Phase 5: Behavior lock

복사 전에 참조 슬라이스의 현재 동작을 characterization test로 고정한다. 이 테스트는 슬라이스의 관측 가능한 동작을 기록하는 명세 역할을 한다.

1. **characterization test 작성**: 참조 슬라이스의 핵심 동작(입력 → 출력, 상태 전이, 엣지 케이스)을 테스트로 기록한다. 테스트는 참조 슬라이스의 현재 동작을 있는 그대로 고정한다 — 이상적인 동작이 아니라 실제 동작.
2. **RED → GREEN 증명**: characterization test를 참조 소스에 대해 실행하여 GREEN을 확인한다. 테스트가 참조 슬라이스의 실제 동작을 정확히 포착했음을 증명한다.
3. **복사 기준선 확보**: GREEN characterization test가 복사 후에도 동일한 동작을 보장하는 기준선이 된다. 복사 후 이 테스트가 GREEN이면 동작이 보존된 것이다.

characterization test가 없으면 복사 후 동작 변화를 감지할 수 없다. RED → GREEN 증명 없이 Phase 6로 넘어가지 않는다.

## Phase 6: Adapt + verify + learn

최소 복사를 수행하고, 절단점에서 도메인 배선만 교체한 뒤, 검증하고 패턴을 등록한다.

1. **최소 복사**: Phase 1에서 정의한 슬라이스만 복사한다. Phase 4 결정표에 따라 generic machinery는 그대로, domain wiring은 절단점에서 교체 대상으로 표시한다.
2. **절단점에서 도메인 배선 교체**: Phase 4에서 식별한 절단점(seam)에서만 도메인 배선을 프로젝트 코드로 교체한다. generic machinery는 건드리지 않는다. CSS 클래스는 프로젝트 토큰/클래스로, 저장소 키는 프로젝트 스토어로, 라우트 가정은 프로젝트 라우터로, 권한 검사는 프로젝트 인증으로 교체한다.
3. **참조 테스트 유지**: Phase 5의 characterization test를 복사된 슬라이스에 대해 실행한다. GREEN이면 동작 보존 확인. RED면 절단점 교체에서 동작이 변한 것 — 원인을 찾아 수정한다.
4. **검증**: Phase 1의 성공 기준 1줄을 실제로 확인한다. 프로젝트 UI 작업이면 visual-qa reference-fidelity 검증을 추가한다.
5. **패턴 등록**: 검증 완료 후, 이 차용에서 발견한 패턴을 프로젝트 패턴 레지스트리에 등록한다:
   - **규칙 (rule)**: "이런 류의 슬라이스를 차용할 때는 이 절단점에서 도메인 배선을 교체한다."
   - **회귀 (regression)**: characterization test를 회귀 테스트로 유지한다.
   - **증거 (evidence)**: RED → GREEN 증명, 해부 보고서, 결정표를 evidence 경로에 저장한다.

## Failure Patterns

- 레퍼런스 전체를 복사하고 나중에 필요 없는 부분을 지운다 — 최소 슬라이스를 먼저 정의하지 않으면 전체 복사가 된다.
- 구현 코드부터 읽는다 — 계약(타입·테스트)을 먼저 읽지 않으면 구현 디테일에 고착된다.
- 해부 보고서 없이 복사한다 — 숨은 결합(CSS 클래스·저장소 키·권한·라우트)이 복사 후 깨진다.
- characterization test 없이 복사한다 — 동작 변화를 감지할 수 없다.
- 절단점이 아닌 곳에서 도메인 배선을 교체한다 — generic machinery가 오염되어 재사용성이 사라진다.
- 검증 없이 완료 보고한다 — 성공 기준 1줄을 실제로 확인해야 한다.
