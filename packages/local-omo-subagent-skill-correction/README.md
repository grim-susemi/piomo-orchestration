# local-omo-subagent-skill-correction

Private local owner package for the confirmed-personal subagent-skill correction.
It ships the original hook plus its owned helper inside this package only.

- Extension: `extensions/omo-subagent-skill-correction.ts` (single
  `before_agent_start` handler, fail-open, no banner handlers).
- Helper: `extensions/omo-subagent-skill-correction.mjs` (matching gate,
  capability routing, owned markers, rule data). Not a separate module and not
  an auto-discovery target; imported by the sibling TS only.
- Types: `extensions/omo-subagent-skill-correction.d.mts` (helper declarations
  for strict diagnostics; no runtime behavior).
- Sources are byte-identical to
  `U/agent/extensions/omo-subagent-skill-correction.ts` and the associated
  `.mjs` helper. No new correction policy and no preset coverage change:
  `deepseek-v4-1-flash` stays uncorrected, exactly as the original.
- Targets: `deepseek-v4-flash`, `deepseek-v4-flash-0731`, `deepseek-v4-pro`,
  `kimi-k3`. Signature plus id/name mirror must agree (fail-closed).
- Removal: delete this package directory and reload; owned blocks strip back
  to the base prompt. No host, settings, or shared-file changes required.
