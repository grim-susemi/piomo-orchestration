# piomo-personal-core

Private local native TypeScript package for multi-model tuning plus GPT/Muse
orchestration. The manifest loads exactly three extensions: model-specific
tuning, the tool guard, and the fail-open compaction summarizer. The tuning
and summarizer have no runtime dependencies; only the guard keeps its
approved host imports. No original loose-extension imports are required.

The tuning supports five exact Gemini IDs, seven exact Muse IDs, one Ox Alpha
ID, and thirteen exact GPT IDs, lowercased without trimming. GPT shares only
Muse's two orchestration rules. The compaction summarizer reads settings.json
from the live agent directory with node builtins only and returns undefined
when unconfigured, so native compaction runs untouched. The guard preserves its existing worker exemption
and tool/wire policy; headings alone do not establish worker identity.

Compatibility starts at OMO 5.0.0-0.beta.51 / Senpi 2026.9.9-2 on Windows x64,
Node 24, with the awaited model_select_prepare host extension and prior reload
identity correction. Stock pins and the reload-only candidate are not supported
for this artifact's model-selection lifecycle. Native package registration alone
does not enforce this capability: use the candidate-bound QA preflight.
This is a first-package artifact, not a live migration or lifecycle
certification. Broader parity and reload/remove/composition checks belong to T4/T5.
Do not load beside the old guard or the old full orchestration tuning. The local
non-orchestration residual is a separate migration asset and is not shipped here.

Build and audit from the development root with `npm run check`, `npm test`,
`npm run build`, then `node qa/package-content.mjs --case muse-gpt-core
--evidence <output.json>`. The archive preserves native TS; it does not bundle
the host. Extract the archive to an independent directory before using the
native local-package path. Installation and live handover require separate approval.

These are owner-provided personal extensions, distributed locally only. No
third-party host sources, settings, credentials, fixtures, or private data are
included. No public redistribution license is granted (UNLICENSED).
