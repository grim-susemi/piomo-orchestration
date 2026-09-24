# Version History Contract — PiOMO Orchestration Mod

Owner-approved scope for the private `piomo-orchestration` history: **two chronological commits**, first the currently installed custom harness, second the staged refresh-04 review-gate candidate. Both are source-only records under `provenance/allowlist.json`; neither is a public release.

**Supersession clause.** The paused plan in the source workspace (`.omo/plans/piomo-modpack-curated-github-sync.md`, still paused, not edited by this contract) forbids refresh-04 bytes from the curated set. This user-approved two-commit scope **supersedes that exclusion only for the second commit**, confined to a distinct owner-authored source namespace `patches/refresh-04/**` (separate from `patches/beta88/**`). The first commit contains **no refresh-04 source** in any form. No historical backfill: older revisions (beta.85 lane, refresh-02/03, retired guard/compaction) are never committed.

## Commit 1 — installed-current (installed-state snapshot)

Label: `installed-current` — **partial source coverage; not reproducible release**. This commit records the custom harness actually running today; it is expressly *not* a reproducible source release, because the receipt-era slot-4 authored inputs are unrecoverable (SOURCE_GAP).

Contents (owner-authored, `UNLICENSED`, except the recorded MIT exception below):
- The **actually applied loose tuning extension** (`omo-model-tuning.ts`, active) plus its import/test closure — not merely QA tooling.
- The **owned package sources** for all five pinned packages, each carrying its truthful status label (see glossary): `piomo-personal-skills` (configured, incl. the executable `omo-check` skill and its command dependency `scripts/pr-watch.mjs`), `local-intent-clarifier-hook` (configured), `local-omo-subagent-skill-correction` (configured), `piomo-judgment-workflow` (library-only), `piomo-personal-core` (stale — included only as a documented stale manifest, excluded from the verified activation example). The three pins are recorded as **configured**, not active: pin and file presence are proven, but no current runtime loader receipt or behavioral probe proves activation, so the glossary's `active` label is not claimed for them.
- The **four verbatim MIT-licensed Senpi prompt-preset resolver regex lines** (`packages/local-omo-subagent-skill-correction/extensions/omo-subagent-skill-correction.mjs`, lines 23/27/29/31, derived from `@code-yeongyu/senpi` 2026.9.23-5, installed `presets.js` sha256 `85b59dac…`, upstream tag `v2026.9.23-5` commit `97e48c48…`): recorded per-line in `provenance/components.json` with the verbatim upstream MIT notice carried in full at `licenses/senpi-MIT.txt`. Every other committed file is owner-authored `UNLICENSED`; unknown-rights third-party code is excluded from publication.
- The **required `omo-check` command** (where provenance and rights allow), clone-local evidence-output behavior, no historical snapshots.
- A **safe config example** (`examples/settings.json`, relative clone-local package paths, no personal identifiers, no raw settings content).
- The **audit tools present in the curated root today**: `qa/audit-publish.mjs` and `qa/audit-packages.mjs`. `qa/audit-components.mjs` is a **planned** companion (authored during curation); it is not yet present and the first commit must not claim it until it exists.

Recorded metadata (hashes only; the referenced bytes are never published):
- Installed OMO generated tail `f1aa0994317cdaaa347a5b90bbbd030c42188e351b0e83ef8d99b6f807d10f78` (input-source hotfix; predecessor `3aec04b1bdebf6721eb418aa8dd3ee0162e871ee0bb5d92ee97a925dcb108840`; pristine base `77b6747d35aa92e8618e4fe011dac36eddbfd4fe6edfbb2ad39ceb0639f63562`; installed intermediates `413806f5b8ab4a45f4d6f042d0397b3f5203cc385199a7549574ed1d26fcd9f9`, `41177014654be1f4cc565bd5ca6f91bb06615cefbaeee9d22a60cc9d9a075a0a`, `121cc2856510863f1cb62e2898831c6782c00e342d7fb9906c9887aa03ce6d37` per pins `8aa76f092dee387876be721f54394eb06f8868cfe8d2cede03d08be149bbc2cc`).
- **Seven Senpi installed preimages** (package `@code-yeongyu/senpi` 2026.9.23-5, installed bytes at the refresh-04 preimage identities):

  | file | installed preimage sha256 |
  | --- | --- |
  | `dist/core/extensions/runner.js` | `a7bef394fba1922a1844722f2b35e6215dbd4ae8e01e179a1335d2563767d5af` |
  | `dist/core/extensions/types.d.ts` | `fe5240513f159b8fe28a00a10df37b31b12894fcf956be56bdd820e7e62a8ef8` |
  | `dist/core/agent-session.js` | `2e09991555bbea1446bee3f6e0d2bf334343ca0cf17a228c13625caa3b4b8ba9` |
  | `dist/core/extensions/wrapper.js` | `2b982ac483b2318b022338d4741fd2aa38dbae2afb7918503008e430e7c7507f` |
  | `dist/core/extensions/runner.d.ts` | `84a26abc200f8f5fdfb8383fc22444098aa0f2e43da1880c51c54dbdc75fc73f` |
  | `dist/bundle/chunks/chunk-RRSND33J.js` | `cb247dce3c390a8cc87494b98c1acc7f7fa9218a7935d94c065e0a9ab32904ba` |
  | `dist/bundle/chunks/session-worker.js` | `4fc3b9dc1baa8245f05e193d7b9e989a2b20dd983c0989cfccf0de44b0cbb880` |

- **Live agent settings hash** (recorded as metadata only, the file itself is never published): sha256 `8d3fa7a6a33186483d5120883e81768be482db87552e56958dcd67c8db596e65`, 8311 bytes, observed at `2026-09-24T10:45:50Z` by read-only re-hash — the live agent settings file pinning the five package sources above. This value **drifted from the previously recorded `a82b4322a12ab4652ee43a7eb1cf503e91a9eb7bd80fa37f8481d698655582e6`**: the drift is explicitly acknowledged, the prior value is superseded, and the current observation is recorded instead; no claim is made about when or why the file changed.
- **Live engine config hash** (observed 2026-09-24, re-hashed read-only at contract revision): sha256 `c35a9a6bfacbe54f657806f94cea3307b4452d4ddf2ac605fb6867ef502769a4`, 129175 bytes — the live OMO `omo.jsonc` configuration; this matches the previously recorded `c35a9a6b…` identity, so no concurrent change was detected. These are two distinct live files and must never be conflated into one "config hash".
- **Three SOURCE_GAP authored-input hashes** (receipt-era installed slot-4 inputs; unrecoverable, therefore no partial three-slot snapshot and no generated-tail substitution — the generated tail alone cannot substitute for authored source):
  - anchor `qa/gate-repair-anchor.mjs`: `ae5284618c065acf48e7872260ee35d1cb2c6af8dfc45d5700fc1a39ce5878de`
  - fixture `qa/gate-request-fixture.test.mjs`: `25ee327e6a1bc5fd695792754221860cfad1007589c4c811a49fa1871fe3f958`
  - fragment `patches/deltas/slot-4-gateRepair.insert.js`: `9b6d4ba593266f22b8977decfd9db3922fd1abb51458f7b86c88caf034b99a3a`

The first-commit source for the unrecoverable slot-4 authored inputs **remains missing** (SOURCE_GAP); no provenance may be invented for it.

**Publication-adapted source tracking (commit 1).** A commit-1 file may be adapted for publication — personal-path sanitation, line-ending/final-newline normalization. For **every** adapted file, provenance must be tracked per file with: the **original as-installed SHA-256**, the **published SHA-256**, and the **exact diff class** (e.g. `path-sanitized`, `line-ending-normalized`, `final-newline-normalized`). Bounded path/output adaptations (e.g. the pr-watch ROOT/output path adaptation and the omo-check command path) are intentional, bounded behavior changes: each must be described by its exact before/after and verified with the relevant tests; they are NOT claimed byte- or behavior-identical to the live installed source.

## Commit 2 — refresh-04-staged (staged candidate)

Label: `refresh-04-staged` — **stage-only / not installed**. Zero live apply invocations; no installation performed or implied; a separate owner decision is required before any future install.

Contents, exclusively under the owner-authored namespace `patches/refresh-04/**` (supersession applies here only):
- **17 owner-authored source/test/pin files** from the sealed refresh-04 authoring sources (recorded SHA-256 identities in the sealed source-identity manifest):
  - engine-bridge build transform, library, identity/original-text/rollback-guard/tool-effect-lifecycle tests, and the pinned rebuild inputs (`pins.json`);
  - the four-slot delta fragments (slot-4 gateRepair, todo-7-retry, todo-8-quota, todo-9-health);
  - the lane QA anchors (gate-repair, quota-routing, bundle-health, retry-budget), the gate request fixture test, and the rebuild ledger.
- **Excluded from this commit**: the install helper and its test/prose, generated engine output of any kind, install helper bytes, README prose copies, the superseded `.orig` fragment snapshot. `EVENT-CONTRACT.md` is optional companion prose, **not one of the 17**; it may be carried separately or omitted, but the count of authored source/test/pin files stays exactly 17. **No generated output or install helper is committed.**

Recorded metadata (hashes only; generated bytes never published):
- Staged OMO tail `b56c4a3f5bd6af054f0b4b9177d2fdd7286286c90ae3d5bc31b99f51f4c85636` (four-slot chain over pristine base: `a2176b1d2ff59dd57c402988b4082e866ad0e211211c65ae639c26e778bedfd1` → `2a3eb09c0f8306d8bfb6e5def0c64a74a1369f709f655e15de799519b861b9bd` → `5f58e45d871e46cceb6973af3ddff1e4df659530cf6b4b03d7d8ab64f5f68f5f` → `b56c4a3f…5636`).
- **Seven staged Senpi outputs** (same package/version; staged bytes are metadata hashes, not published files):

  | file | staged sha256 |
  | --- | --- |
  | `dist/core/extensions/runner.js` | `d9f074a83c0cc39ea46bc78f0b593f193428851325f9ee59a174c7f51bae651e` |
  | `dist/core/extensions/types.d.ts` | `0bc35c94126abf682c42f4ae2b8a6da7fc855e11c5bb19df19f3712bad19391e` |
  | `dist/core/agent-session.js` | `9dbda0628f1cd54d4a37b5a6aa7ef5549ae95bd7fab520c8a5439f9c06f3db9a` |
  | `dist/core/extensions/wrapper.js` | `b59630d6008cc15926d8a14fec1253fd9e3adff75accdfb715f5d01780beee0d` |
  | `dist/core/extensions/runner.d.ts` | `79e218938762dc2b44f62c952df43d9d9c683e686c1f2c05343c62360cc8a7c2` |
  | `dist/bundle/chunks/chunk-RRSND33J.js` | `31bba2da710d03315d5cf4326d8c3c01ea4f42eaf2d2c16b43c691d537021ac5` |
  | `dist/bundle/chunks/session-worker.js` | `89efa93666997c15fd47fd0879babcae45e63bbd9e4ab5f94df66ec8d7ca0119` |

- Engine manifest `f0bb93c9f1c10f488a00337fa322fcc96f294157a847d8bc2e82ae4677691eec`; staged slot-4 fragment `f65e1b4fc4f43b1f4294bf887c90c0cbab11e35803b5c59a7d10abafadb0c639`. Any future install must re-verify the seven live preimages above before applying.

## Status labels (used in both commits)

- **configured** — pinned in the live configuration, carried as source, but runtime activation not separately proven.
- **active** — verified runtime activation (loader receipt or behavioral probe) on the recorded chain.
- **library-only** — imported as a library; no runtime extension/skill activation proven.
- **stale** — declared entrypoints/imports do not exist; documented as stale, never presented as active.

## Exclusions (both commits)

No raw settings/auth/models/trust files or content; no generated OMO/Senpi bundles or engine outputs; no third-party material with unresolved rights; no evidence/log/snapshot/cache/session/memory/rollback copies; no archives or upstream trees; no machine-local absolute paths as runtime prerequisites; no historical backfill of older chains.

## Gates and review

1. **Per-commit gate**: each commit is gated by a full-tree source-only + secret audit (`node qa/audit-publish.mjs --root . --allowlist provenance/allowlist.json --strict`, exit 0) against the exact tree, and an **exact source identity proof**: every committed file's sha256 must match its applicable recorded identity — never from prose. Owner-authored files with a pre-existing sealed-source identity (receipt/pins/manifest) must match it, with the commit-2 strict 17 identities unchanged below; **curation-only docs/audit files** authored during curation (contract, README, installed-state metadata, audit tools) carry a **publication hash/file inventory** instead, and no fictional sealed identity is claimed for them; staged output claims must match CLI recomputation where supported, while the **installed tail claim is a read-only live hash receipt** (SOURCE_GAP prevents full source reconstruction of the installed chain). For commit-1 publication-adapted files, the identity proof is the recorded per-file pair — original as-installed SHA-256 plus published SHA-256 with its exact diff class — and no as-installed byte parity is claimed for those files; this does **not** weaken commit 2, whose 17 owner-authored files must still match their sealed source identity and CLI reconstruction exactly, with no generated files committed.
2. **Final review**: one final reviewer approves both histories together — chronological order, labels, supersession confined to `patches/refresh-04/**`, absence of refresh-04 bytes in commit 1, and the private remote check that the pushed ref SHA equals the approved tip before any remote write.
3. **Authorization status**: the owner approved the recommended two-commit workflow ("proceed with the recommended direction"), so **local commits are already authorized** once each commit passes its per-commit QA gate — no further generic approval is needed. Only the **private external remote create/push** waits for the final concrete approval of the exact ref SHA and file list (see item 2). Installed/live software is never touched by these commits: curation is source-only and no install or live-host write is authorized or performed.

## 한국어 요약

승인된 두 개의 시간순 커밋: (1) `installed-current` — 현재 설치된 커스텀 하네스 스냅샷. 실제 적용 중인 튜닝 익스텐션과 소유 패키지 소스, `omo-check` 명령, 안전 설정 예시, 현재 존재하는 감사 도구 2종(구성요소 감사는 예정)을 담고 설치된 OMO 꼬리 `f1aa0994…`, Senpi 7개 사전 이미지, 라이브 해시 2종(5핀 에이전트 설정은 이전 기록 `a82b4322…`에서 드리프트하여 `2026-09-24T10:45:50Z` 재해시 관측값 `8d3fa7a6…`을 기록, 엔진 `omo.jsonc` 설정은 `c35a9a6b…` 유지, 서로 구분), 복구 불가(SOURCE_GAP) 슬롯-4 소스 해시 3개를 메타데이터로 기록한다. 게시 적용(개인 경로 위생화, 줄바꿈·파일 끝 개행 정규화, pr-watch 경로 출력 등 경계된 경로/출력 적용)으로 달라진 파일은 파일별로 원본 SHA·게시 SHA·정확한 차등 클래스와 전후 변경을 추적하고 관련 테스트로 검증하며, 설치 소스와 바이트·동작 동일성을 주장하지 않는다. 세 핀은 런타임 활성 증빙이 없어 `configured`로 기록된다. 소유자 저작 파일은 `UNLICENSED`이며, 유일한 예외는 `omo-subagent-skill-correction.mjs` 23/27/29/31행의 네 개 Senpi MIT 정규식이다(전체 고지 `licenses/senpi-MIT.txt`, 구성요소 기록 `provenance/components.json`). 권리 불명 제3자 코드는 게시에서 제외된다. 슬롯-4 원작 소스가 없어 **부분 소스 커버리지, 재현 가능한 릴리스가 아님**을 명시한다. (2) `refresh-04-staged` — **스테이지 전용, 미설치**. 봉인된 저작 소스 중 생성물·설치 도우미를 제외한 17개 소유 저작 파일만 `patches/refresh-04/**` 네임스페이스로 담고, 스테이지된 OMO `b56c4a3f…`와 Senpi 7개 산출물은 해시 메타데이터로만 기록한다. 기존 일시중지 계획의 refresh-04 배제 조항은 이 두 번째 커밋에 한해서만 대체되며, 첫 커밋에는 refresh-04 소스가 없다. 각 커밋은 전체 트리 소스 전용·시크릿 감사와 기록된 신원 증명으로 통과한다(봉인 신원 파일은 원본과 일치, 큐레이션 전용 문서/감사 도구는 게시 해시·파일 목록으로 증명, 스테이지 산출물은 지원되는 범위에서 CLI 재계산과 일치, 설치 꼬리는 읽기 전용 라이브 해시 영수증 — SOURCE_GAP으로 전체 소스 재구성은 불가), 최종 리뷰어 1인이 두 이력과 비공개 원격 SHA를 함께 확인한다. 과거 이력 소급(백필)은 없다. 소유자가 권장 두 커밋 워크플로 진행을 승인했으므로 커밋별 QA 통과 시 로컬 커밋은 이미 허용된다. 비공개 외부 원격 생성·푸시만 최종 확정 승인(정확한 SHA·파일 목록)을 기다리며, 설치된 소프트웨어는 건드리지 않는다.