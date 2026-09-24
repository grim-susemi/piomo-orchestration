# local-intent-clarifier-hook

Private local native TypeScript package for the personal intent-clarifier
prompt gate (ledger I2-03). The manifest loads exactly one extension:
`./extensions/intent-clarifier-hook.ts`. No runtime dependencies or original
loose-extension imports are required.

Behavior is the reference hook verbatim: short vague requests without
scope/criteria/constraints (Korean patterns plus the approved English batch)
receive a hidden `omo-intent-clarifier:gate` directive (ask 1–3 short
questions, propose one refined sentence, wait for confirmation) before any
tool call. Current-request image attachments are additionally inventoried
through the package-local `extensions/lib/custom-mode-policy.ts` (shared
attachment policy), so an image-only or long-path request still reports
count/source/needs-vision facts as a machine-readable `[intent-clarifier:details]`
line — advisory only, never a read authorization. File/error/line, explicit
"just do it", slash commands, `ulw`/`hyperplan`, long prompts, and empty input
pass through untouched. Failures return `undefined` without throwing. No model
calls, no tool blocking, no settings writes.

Compatibility starts at OMO 5.0.0-0.beta.51 / Senpi 2026.9.9-2 on Windows x64,
Node 24. The `before_agent_start` hook contract is the only host surface used.
Do not load beside the original loose `intent-clarifier-hook.ts`; registration
is exact-once. The personal skill body (`A/intent-clarifier/SKILL.md`) stays a
local reference and is not shipped here. No dormant, private, unknown, Gemini,
or Ox content is included.

Build offline from an isolated copy with the pinned host tooling
(`npm pack --offline --ignore-scripts`); the archive preserves native TS and
never bundles the host. Installation and live handover require separate
approval.

Owner-provided personal extension, distributed locally only. No third-party
host sources, settings, credentials, fixtures, or private data are included.
No public redistribution license is granted (UNLICENSED).
