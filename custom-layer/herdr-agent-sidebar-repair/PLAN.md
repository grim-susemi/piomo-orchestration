# Independent Herdr reporter repair plan

## Goal and boundary

Use the actual installed PIOMO bundle in an isolated profile to prove a single
reporter owns the fixture pane, preserves state/session/sequence semantics, and
survives unrelated native Pi exits. Do not modify the installation, live-home
configuration, owner panes, or owner processes. Do not create commits.
Implementation approval does not authorize live activation.

## Grounding

`C:/Users/USER/.local/bin/omo.cmd` delegates to
`C:/Users/USER/.omo-stable-500/omo.cmd`. Its interactive branch invokes the pinned
Node executable, installed Senpi `dist/bundle/cli.js`, and installed OMO plugin.
The snapshot CLI dynamically imports `cli-main-RSIYAR4J.js`, which imports
`chunk-5AVFHHDF.js`. Line 828 of that chunk contains the actual builtin Herdr
factory, all three `pi` labels, the user-reporter deferral, unchanged-state cache,
state subscriptions, and quit-only release. These agree with the core factory.

The stock launcher pins the global state roots, so it cannot safely be used as
an isolation wrapper by merely overriding HOME. The fixture launcher will use
the exact same Node, CLI, plugin, brand, and direct arguments, but deliberately
redirect writable state into this project. This deviation must stay visible
in the evidence; it is not a claim that the stock batch file ran unchanged.

## Files and sequence

1. Add `fixture/launch-isolated.mjs` and `fixture/reporter-probe.mjs`.
   The launcher starts the real bundle without provider prompts. The probe
   returns PID, package path, mode, session reference, and loaded extension paths
   through a fixture-only local pipe. No owner-pane registration is allowed.
2. Add a real-launch test using no-focus fixture panes and the official Herdr
   socket subscriptions. First capture builtin ownership and the failure under
   an unrelated Pi child exit. Record exact fixture identities and close them.
3. Extend the existing reporter regression to exercise an independent extension
   loaded by the actual host. Watch the intended failure before implementation.
4. Add `repair/herdr-senpi.mjs`. Reuse the stock factory and client rather than
   copying their reducers or lifecycle. At the transport boundary change the
   three lifecycle labels to `senpi`, preserve source/sequence/session fields,
   and supply `omo --extension <this-entry> --session <reference>` so opt-in repair
   survives a future resume without globally installing an extension. Exclude only
   this extension's path from its own deferral check. The builtin must defer to
   the loaded `herdr-` entry. Other loaded reporters must not be silently hidden.
5. Prove working/idle/blocked, native-child exit, session replacement, true quit,
   stale sequences, and resume identity. Reuse unchanged prior evidence only
   for the exact unchanged artifact. No fixed sleeps or timed polling.
6. Capture the real Herdr surface for the fixture, run one independent gate
   review after lead-owned QA, and write an activation/rollback proposal.

## Acceptance and rollback

The live registry and captured Herdr display must agree with the fixture's
session and state. There must be one effective reporting owner, no ghost entry
after quit, no release on replacement, and a preserved supported resume path.
Remove the candidate from the isolated extension arguments to prove rollback
restores stock loading. A production activation proposal must name the exact
file/config changes and separately identify how existing missing sessions would
be recovered; no existing owner session is restarted during this work.

Use Node tests and syntax checks on the new scripts. LSP is currently unavailable;
do not install it for this repair. Keep generated fixture profile data clearly
separate from the candidate. Existing source-level patch evidence is a reference,
not permission to patch a compiled bundle or skip actual-host verification.
