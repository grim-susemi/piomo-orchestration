# PiOMO Orchestration Mod (curated source repository)

Owner-authored source curation for the PiOMO orchestration modpack. This is an
**installed-state provenance snapshot, partial source coverage, NOT reproducible release**.
No generated OMO/Senpi bundles, engine outputs, raw machine settings or auth material are
published here; recorded hashes are metadata only.

## Contract

See `docs/version-history-contract.md` for the approved two-commit scope
(`installed-current` snapshot first — the pre-refresh installed baseline, committed as
`ab208f042a617889056b681a33d2d5d858f0952e` — and the `refresh-04-applied` record
second). This first slice contains **no refresh-04 authored source**: the receipt-era
slot-4 authored inputs are unrecoverable (SOURCE_GAP, per the workspace evidence verdict
`omo-piomo-modpack-curated/task-1-source-verdict/v1`), so this snapshot is expressly
**not** a reproducible release, and the source gap is not healed by commit 2.

The second-commit target was extended by the owner from stage-only to actual live
application. The owner ran the sealed installer in a quiescent maintenance terminal
(`action: applied`, `installedWrites: 8`, exit 0); a separate read-only check matched
all eight live postimages and eight backup preimages, and a fresh OMO help invocation
loaded the Senpi plugin (exit 0). `provenance/refresh-04.json` records the applied
state; the 17 source/test/pin files are the source file count,
docs and provenance metadata are allowed outside the `patches/refresh-04/**` namespace,
and no install helper, EVENT-CONTRACT.md, `.orig` snapshot or generated bundle is
committed.

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
release** label: the first snapshot's slot-4 authored inputs remain unrecoverable.
The subsequent refresh-04 sources are now applied, but no complete source-only clone
reconstruction is claimed without the external pinned base inputs.

`provenance/refresh-04.json` is the stage-2 identity manifest: the exact 17 sealed
identities re-verified against the actual worktree files, the sealed source-identity
manifest identity/hash (recorded symbolically), the staged target `b56c4a3f...` and
engine hashes for the seven staged Senpi outputs and their preimages (metadata only), the
historical 8 preimage identities, and the installed-state and backup verification. It is a separate
commit-2 record: `provenance/source-adaptations.json` remains the commit-1-only
publication-adaptation ledger and is unchanged even as README/contract hashes change in
this worktree.

## Recorded installed-state metadata

`provenance/installed-state.json` records the pre-refresh installed chain at commit 1: OMO generated
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
Optional machine-local package inventory (reads the live agent settings; not a clone-only check):

    node qa/audit-packages.mjs --mode inventory --source-root "../기타 작업"

This reports the known-stale core entries without claiming dynamic package activation.

## License

Owner-authored portions are UNLICENSED. Commit 1's sole exception is the four
verbatim MIT-licensed Senpi prompt-preset resolver regex lines in
`packages/local-omo-subagent-skill-correction/extensions/omo-subagent-skill-correction.mjs`
(lines 23/27/29/31, derived from `@code-yeongyu/senpi` 2026.9.23-5, upstream commit
`97e48c48…`). Commit 2 also embeds byte-exact Senpi input anchors (MIT) in
`patches/refresh-04/engine-bridge/pins.json` and OmO beta.84/beta.88 source
context (Sustainable Use License 1.0) in the four delta fragments and their
QA anchors. **MODIFIED:** the owner authored the refresh-04 gate, retry, quota
and health transforms against those upstream versions; these are custom
derivatives, not unmodified upstream software. The portions, source versions,
and full notices are recorded in `provenance/components.json`,
`licenses/senpi-MIT.txt` and `licenses/omo-SUL.txt`. OmO's terms permit
personal/internal use and free non-commercial redistribution with the terms
and modification notice; no commercial redistribution is claimed.
Unknown-rights third-party code remains excluded. Private repository; not a
public release.

## 한국어 요약

설치 상태 기록 전용 큐레이션 저장소입니다. **부분 소스 커버리지, 재현 가능한 릴리스가
아님**을 명시하며, 슬롯-4 원작 소스는 복구 불가(SOURCE_GAP)라 이 첫 슬라이스에
refresh-04 저작 소스가 없으며, 커밋 1은 기록 베이스라인 `ab208f042a...`이고 소스 격차는 아직
메워지지 않았습니다. 두 번째 커밋의 목표는 실제 라이브 적용으로 확장되었으며, 소유자가 정지된
유지보수 터미널에서 설치가 exit 0로 끝나고 사전 백업·포스트이미지 해시 검증·새 호스트 점검을
마친 뒤에만 생성됩니다. 소유자 설치 영수증은 8개 쓰기·exit 0이며, 독립 읽기 전용 검사에서
설치 파일 8개와 백업 8개의 해시가 일치하고 새 OMO 도움말 실행도 성공했습니다.
`provenance/refresh-04.json`은 `status: applied`를 기록합니다. 17은 소스 파일 수
정의이며 문서·프로비넌스 메타데이터는
`patches/refresh-04/**` 네임스페이스 밖에 둘 수 있고, 설치 도우미·EVENT-CONTRACT.md·
`.orig`·생성물은 커밋하지 않습니다. `provenance/source-adaptations.json`은 커밋 1 전용
장부로 그대로 두며 스테이지-2 메타데이터는 별개입니다.
`provenance/installed-state.json`은 설치된 OMO 꼬리
`f1aa0994...`, Senpi 사전 이미지 7개, 느슨한 튜닝 익스텐션 `65ac2d42...`, 라이브 해시
2종(에이전트 설정은 드리프트되어 현재값 `8d3fa7a6...`을 기록, 엔진 `omo.jsonc`는
`c35a9a6b...` 유지), SOURCE_GAP 해시 3개를 메타데이터로 기록합니다.
`examples/settings.json`은 5개 패키지 핀만 담은 **위생화된 목록 예시이지 검증된 실행
가능 구성이 아니며**, 클론 활성화를 주장하지 않습니다. 감사 명령은
`node qa/audit-publish.mjs --root . --allowlist provenance/allowlist.json --strict`
입니다. 설치 바이트와 그대로인 복사본과, 게시를 위해 의도적으로 수정된 9개 파일은
엄격히 구분되며, 후자의 원본 SHA·게시 SHA·차등 클래스는
`provenance/source-adaptations.json`에 파일별로 기록됩니다. 소유자 저작 부분은
UNLICENSED입니다. 첫 커밋의 Senpi MIT 정규식 네 줄 외에, 두 번째 커밋의
`pins.json`에는 Senpi 원문 앵커(MIT), 04 델타와 앵커에는 OmO 원본 문맥
(Sustainable Use License 1.0)이 포함됩니다. 소유자가 원본을 수정·확장한
커스텀 소스이며 원본 그대로의 배포가 아닙니다. 상세 출처는
`provenance/components.json`, 전체 고지는 `licenses/senpi-MIT.txt`와
`licenses/omo-SUL.txt`에 담습니다. OmO 조건은 개인·내부 사용 및 무료
비상업적 재배포에 한하며 상업적 재배포는 주장하지 않습니다. 권리 불명
제3자 코드는 제외됩니다.

게시된 `omo-check` 스킬은 2026-09-24 GLM-5.3 max 추론단계 점검 추가분을 반영하며, 그
점검이 참조하는 데스크톱 미러 테스트는 머신 로컬·미번들로 클론에서는 실행되지 않습니다.
