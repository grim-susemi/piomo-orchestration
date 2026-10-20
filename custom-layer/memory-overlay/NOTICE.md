# Local modification notice

This is a private local compatibility patch, not an official omo-ai release.
It adapts only the memory transaction rollback and literal Git path changes from
MoerAI's PR #10000 in code-yeongyu/oh-my-openagent.

- Upstream PR head: 4406c7776ca6582cc206819fadc1b34a060d4729 (semantic source of the port).
- Local source base: the official omo-ai 5.1.35 package (re-derived from the verified
  5.1.34 / memory-rollback-r1 delta; minified bindings pB/qW/$J re-read from the new bytes).
- Runtime dependency: the installed Senpi 2026.10.16, unchanged.
- Local revision: memory-rollback-r1.

Only three generated bundles are changed. Their upstream source fingerprint is
retained as the base identifier, and their actual new body digests are recomputed.
The local manifest records both original and modified SHA256 values.

The installed upstream package is not overwritten. This copy is selected through
the stable-500 custom routing mechanism. Existing processes retain old modules.
See UPSTREAM-LICENSE.md for the upstream terms. No MIT license is asserted.
