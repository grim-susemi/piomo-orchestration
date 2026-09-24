---
name: intent-clarifier
description: Clarify ambiguous user intent before acting. Use when the user's request is vague, underspecified, or open to multiple interpretations (missing scope, criteria, or constraints). Proposes a refined one-sentence request and asks for confirmation before execution. Skip when the request is already concrete.
---

# Intent Clarifier — 요청 다듬기

## Purpose

사용자가 자연어로 모호하게 말했을 때, AI가 추측해서 잘못 실행하는 것을 막는다.
코드를 짜기 전에 1~3개 질문으로 의도를 확정하고, 다듬은 요청 한 문장을 제안해 "예" 한 번으로 진행한다.

## When to Use

- 요청에 범위·기준·예외가 빠졌을 때 ("로그인 고쳐줘", "예쁘게 해줘", "빠르게 해줘")
- 한 문장에 두 가지 이상 해석이 가능할 때
- 스킬 조합이 달라질 만큼 방향이 갈릴 때

**Skip when:**
- 요청이 이미 구체적일 때 ("오타 고쳐줘: 42번째 줄 `teh` → `the`")
- 단순 확인·조회일 때 ("이 파일 뭐야?")
- 사용자가 "그냥 해줘", "추측해서 해줘"라고 명시했을 때

## Workflow — 3 Steps, Fast

### Step 1: Detect Ambiguity (10초)

요청을 읽고 빠진 3축을 체크한다:
- **어디(범위)**: 어느 파일/화면/기능까지?
- **어떻게(기준)**: 어떤 스타일·성능·품질 기준으로?
- **제외(제약)**: 건드리면 안 되는 것, 꼭 지켜야 할 것?

빠진 축이 없으면 스킵하고 바로 실행.

### Step 2: Ask 1–3 Questions (짧게)

- 질문은 최대 3개, 각 질문의 선택지는 2~3개로 짧게.
- 장문 설문 금지. 한 질문 한 줄.
- 예시:

> → [intent-clarifier] 요청이 모호해서 2가지만 확인할게요:
> 1. 어디를 고칠까요? A) 로그인 화면만 B) 회원가입·비번찾기 포함
> 2. 기준은? A) 기존 디자인 유지하며 깨짐만 수정 B) 새로 예쁘게 리디자인
> → 다듬은 요청: "로그인 화면의 레이아웃 깨짐을 기존 디자인 유지하며 고치고, 브라우저로 확인까지 해줘"
> 이대로 할까요? [예 / 수정]

### Step 3: Confirm and Dispatch

- 사용자가 "예" 하면 다듬은 요청을 그대로 실행하고, 관련된 스킬을 자동 조합한다.
  - 예: 위 요청 → `frontend + uiux-work-harness + visual-qa`
- "수정" 하면 한 문장으로 고쳐서 다시 확인.
- 확인 없이 추측 실행 금지.

## Rules

- 질문은 1~3개, 선택지는 2~3개 — 그 이상은 피로하다.
- 항상 **다듬은 요청 한 문장**을 제안한다. 사용자가 "예"만 하면 되게.
- 단순 요청은 스킵 — 과도한 되묻기는 금지.
- 다듬은 요청에는 스킬 조합 힌트를 포함한다 (예: "브라우저로 확인까지" → visual-qa).
- 이 스킬은 다른 스킬보다 먼저 발동한다 (스킬 조합 전 단계).

## Anti-patterns

- ❌ "더 자세히 알려주세요" 같은 열린 질문 — 선택지를 줘야 한다.
- ❌ 5개 이상 질문 — 사용자가 지친다.
- ❌ 추측해서 바로 실행 — 이 스킬의 존재 이유를 부정한다.
- ❌ 명확한 요청에도 되묻기 — 스킵해야 한다.

## Example — Full Flow

**User:** "로그인 좀 고쳐줘"

**Agent (intent-clarifier):**
→ [intent-clarifier] 2가지만 확인할게요:
1. 무엇을 고칠까요? A) 화면 깨짐/디자인 B) 오류/버그 C) 기능 추가
2. 범위는? A) 로그인만 B) 회원가입·비번찾기 포함
→ 다듬은 요청: "로그인 화면의 레이아웃 깨짐을 기존 디자인 유지하며 수정하고, 브라우저로 확인까지 해줘"
이대로 할까요?

**User:** "A, A로 해줘"

**Agent:** (다듬은 요청으로 실행, frontend+visual-qa 조합)

## Integration with AGENTS.md

`~/.omo/AGENTS.md`의 "스킬 자동 활용 원칙"과 함께 동작한다.
모호성 감지 → intent-clarifier → 의도 확정 → 스킬 조합 실행 순서.
