# PiOMO Orchestration Mod (curated source repository)

Owner-authored source curation for the PiOMO orchestration modpack. This is an
**installed-state provenance snapshot, partial source coverage, NOT reproducible release**.
No generated OMO/Senpi bundles, engine outputs, raw machine settings or auth material are
published here; recorded hashes are metadata only.

## Contract

See `docs/version-history-contract.md` for the approved two-commit scope
(`installed-current` snapshot first, `refresh-04-staged` candidate second). This first
slice contains **no refresh-04 authored source**: the receipt-era slot-4 authored inputs
are unrecoverable (SOURCE_GAP, per the workspace evidence verdict
`omo-piomo-modpack-curated/task-1-source-verdict/v1`), so this snapshot is expressly
**not** a reproducible release. The `refresh-04-staged` commit is **stage-only, not
installed**; a separate owner decision gates any future install.

## As-installed bytes vs publication-adapted source

This repository carries two distinct classes of files, and they are never conflated:

- **As-installed bytes (byte-identical copies).** Some files are published exactly as
  installed, e.g. `extensions/omo-model-tuning.ts` and its companion test (verified
  against the `65ac2d42...` / `8901043a...` identities in
  `provenance/installed-state.json`), `scripts/pr-watch.prune.test.mjs`, and most
  package files.
- **Publication-adapted source (NOT byte-identical to the installed source).** Nine
  baseline files were copied and deliberately modified for publication: path
  sanitation (symbolic `<user-home>` / `<omo-home>` / `<user-desktop>` / clone-root locations), CRLF -> LF
  or final-newline normalization, and the bounded pr-watch / omo-check command-path
  and desktop-test-path adaptations. For each one, `provenance/source-adaptations.json` records the
  original as-installed SHA-256, the published SHA-256, the exact diff class and the
  reason. No byte- or behavior-identity beyond the recorded class is claimed for these
  files.

The curated `packages/piomo-personal-skills/skills/omo-check/SKILL.md` reflects the
owner's 2026-09-24 GLM-5.3 max reasoning-levels addition to the live skill, carried
under the recorded publication sanitization. The external desktop mirror test that
the added checklist references
(`<user-desktop>/OpenCode_Modes/OMO_Native_ReasoningLevels.Tests.ps1`) remains
unbundled: it is a machine-local script, it is not shipped in this repository, and it
is not runnable in the clone.

This separation does not change the SOURCE_GAP verdict or the **not a reproducible
release** label: the slot-4 authored inputs remain unrecoverable, and the
`refresh-04-staged` sources remain staged-future-only.

## Recorded installed-state metadata

`provenance/installed-state.json` records the observed installed chain: OMO generated
tail `f1aa0994...`, the seven Senpi (`@code-yeongyu/senpi` 2026.9.23-5) installed
preimage hashes, the current loose tuning extension `65ac2d42...`, the live agent
settings hash `8d3fa7a6...` (drifted from the previously recorded `a82b4322...`; the
current value is recorded after a read-only re-hash), the live engine `omo.jsonc` hash
`c35a9a6b...` (unchanged), and three SOURCE_GAP authored-input hashes. The agent
settings file and the engine config file are two distinct live files and are never
conflated into one "config hash".

Package status labels (see contract glossary) are recorded without unproven runtime
claims: `piomo-personal-skills`, `local-intent-clarifier-hook` and
`local-omo-subagent-skill-correction` are recorded as `configured` (pin and file
presence proven; the task-3 receipt deferred dynamic activation to a later task, so
`active` is not claimed), `piomo-judgment-workflow` library-only, `piomo-personal-core`
stale (kept stale; its
absent guard/compaction entries and missing packaged tuning entry are recorded, and it
is not presented as a runnable activation example).

## Safe settings example

`examples/settings.json` is a **sanitized inventory example, not a verified
ready-to-run configuration**. It lists the five historical package pins as
clone-relative paths (`../packages/<name>`) for recording purposes only; it contains no
account, home, token or machine-local absolute path, and no clone activation is claimed.
The as-installed machine-local `scripts/pr-watch.mjs` paths are recorded in structural
terms in the installed-state metadata, and the published `scripts/pr-watch.mjs` is the
explicitly bounded path-adapted variant tracked in `provenance/source-adaptations.json`
(no silent refactor, no as-installed byte parity).

## QA

Source-only publish boundary audit (run from the curated root):

    node qa/audit-publish.mjs --root . --allowlist provenance/allowlist.json --strict

Exit 0 = pass, 2 = violations, 64 = usage, 66 = missing allowlist, 70 = internal error.
Package-level checks: `node qa/audit-packages.mjs`.

## License

Owner-authored files are UNLICENSED. The single recorded exception is the four
verbatim MIT-licensed senpi prompt-preset resolver regex lines in
`packages/local-omo-subagent-skill-correction/extensions/omo-subagent-skill-correction.mjs`
(lines 23/27/29/31, derived from `@code-yeongyu/senpi` 2026.9.23-5, upstream commit
`97e48c48…`): they are recorded per-line in `provenance/components.json` and carry the
verbatim upstream MIT notice in full at `licenses/senpi-MIT.txt`. Unknown-rights
third-party code is excluded from the repository. Private repository; not a public
release.

## 한국어 요약

설치 상태 기록 전용 큐레이션 저장소입니다. **부분 소스 커버리지, 재현 가능한 릴리스가
아님**을 명시하며, 슬롯-4 원작 소스는 복구 불가(SOURCE_GAP)라 이 첫 슬라이스에
refresh-04 저작 소스가 없습니다. `provenance/installed-state.json`은 설치된 OMO 꼬리
`f1aa0994...`, Senpi 사전 이미지 7개, 느슨한 튜닝 익스텐션 `65ac2d42...`, 라이브 해시
2종(에이전트 설정은 드리프트되어 현재값 `8d3fa7a6...`을 기록, 엔진 `omo.jsonc`는
`c35a9a6b...` 유지), SOURCE_GAP 해시 3개를 메타데이터로 기록합니다.
`examples/settings.json`은 5개 패키지 핀만 담은 **위생화된 목록 예시이지 검증된 실행
가능 구성이 아니며**, 클론 활성화를 주장하지 않습니다. 감사 명령은
`node qa/audit-publish.mjs --root . --allowlist provenance/allowlist.json --strict`
입니다. 설치 바이트와 그대로인 복사본과, 게시를 위해 의도적으로 수정된 9개 파일은
엄격히 구분되며, 후자의 원본 SHA·게시 SHA·차등 클래스는
`provenance/source-adaptations.json`에 파일별로 기록됩니다. 라이선스는 소유자 저작
UNLICENSED이며, 유일한 예외는 `omo-subagent-skill-correction.mjs` 23/27/29/31행의 네 개
Senpi MIT 정규식입니다(전체 고지 `licenses/senpi-MIT.txt`, 구성요소 기록
`provenance/components.json`). 권리 불명 제3자 코드는 제외됩니다.

게시된 `omo-check` 스킬은 2026-09-24 GLM-5.3 max 추론단계 점검 추가분을 반영하며, 그
점검이 참조하는 데스크톱 미러 테스트는 머신 로컬·미번들로 클론에서는 실행되지 않습니다.
