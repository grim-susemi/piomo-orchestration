# piomo-personal-skills

Publication-adapted snapshot of three personal skill bodies, carried by the
private `piomo-orchestration` curation repo (T13 skills lane). This package is a
source record: it is not a runtime installation, it installs and activates
nothing, and the shipped bodies are adapted from read-only machine-local
sources exactly as `skills.json` records. No runtime activation, installation or
live-byte parity is claimed.

## Contents

Three skill bodies under `skills/<id>/SKILL.md`, stored exactly as published.
`skills.json` records both the canonical original revision (`originalRevision`,
machine-local source bytes) and the shipped publication revision
(`publishedRevision`), with an explicit parity class and diff summary per skill:

| skill | parity class |
| --- | --- |
| `intent-clarifier` | content-identical; CRLF -> LF normalization only (87 line endings) |
| `omo-check` | sanitized: three recorded lines changed (fixed-path header, machine-local pr-watch command path, machine-local desktop mirror-test path citation); all other lines byte-identical |
| `reference-adaptation` | all lines byte-identical; one final newline added (canonical body had none) |

No published file contains a machine-local absolute path (user home, `.omo`
home, workspace root, or user desktop); source locations are recorded symbolically as
`<user-home>`, `<omo-home>`, `<user-desktop>` and `<workspace-root>`.

Updated 2026-09-24: the shipped `omo-check` body carries the live GLM-5.3 max
reasoning-levels checklist addition under the recorded sanitization. The external
desktop mirror test that the checklist references
(`<user-desktop>/OpenCode_Modes/OMO_Native_ReasoningLevels.Tests.ps1`) remains
unbundled: it is a machine-local script, it is not shipped in this package, and it
is not runnable in the clone.

## The omo-check command

`omo-check` is the executable skill in this package. Its fixed command is:

    node scripts/pr-watch.mjs --upgrade

Run it from the **clone root** only. The clone-root `scripts/pr-watch.mjs` is a
curated-repository dependency, not part of this package; this package neither
ships nor installs it, and until that script is present in the clone the command
line is a documented dependency, not a working installation. The skill body
documents its evidence snapshot as `.omo/evidence/pr-watch/<stamp>.json`; run
from the clone root so that record stays clone-local. The script's output
behavior is carried by the separate clone-root script workstream and is not
proven by this package. Default sweep behavior stays read-only except that
snapshot; the backup and overlay-upgrade steps in the skill body still require
separate explicit approval.

## Manifests

- `skills.json`: per-skill canonical original revision (raw SHA-256, byte count,
  loader-convention body digest), publication revision (SHA-256 and digest of the
  shipped bytes) with the exact parity class and diff summary, parsed frontmatter
  fields, cited-only references, and original manifest hashes
  (`manifestProvenance`). References are never packaged: hooks, sweep scripts,
  external adaptation inputs, and dev harnesses stay out by the scope exclusions.
- `duplicates.json`: the explicit `omo-check` duplicate record. The canonical A
  row (I4-21) ships once; the U copy (I4-29) is the recorded loser,
  nonactivated. The two live copies were byte-equal at observation, so no variant
  is needed; the shipped body is the canonical one under the recorded
  publication sanitization, never an invented merged body and never a second
  copy.

## Sanitization and rights

Publication normalization is limited to what `skills.json` records: CRLF -> LF
line endings, removal of machine-local absolute paths, and a final newline where
the canonical body lacked one. `bodyDigest` follows the native loader convention
(CRLF normalized to LF, frontmatter block stripped, trimmed) and is recomputed
from the shipped bytes.

All three bodies are owner-authored workflow prose distributed under
`UNLICENSED` (private repository). `reference-adaptation` cites third-party
registries and implementations by name only; no third-party code is copied,
vendored or packaged, and no third-party snippet with unresolved rights is
included.

## Out of scope here

Extensions (`local-*` lanes), profiles (`P/profiles/personal-modpack.json`),
switcher/selection state, secrets, dormant policies, generated assets,
ECC/port/unknown skills, and Gemini/Ox. Live sources are read-only and were
never edited to build this package.
