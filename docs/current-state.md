# Current stable-500 source record

Observed 2026-10-01. This is selected owned source with partial recovery coverage,
not a standalone runnable release. The historical snapshots at
ab208f042a617889056b681a33d2d5d858f0952e and
4c14d9ef463e03f1218a955ba4cef735139ad102 remain historical.
Their installed-state, refresh-04 and source-adaptation ledgers are unchanged.

## Current versus historical state

The current lane uses omo-ai 5.1.6 and Senpi 2026.9.30, stable-500 launcher,
R6 re-entry and the task-builtins-5.1.6-r1 overlay. Earlier launcher comments
mention earlier pins; they are not the active version identity. The selected
native profile is native-cmd-glm-deepseek; the default root is
chatgpt-subscription/gpt-6.1-sol with high thinking. These are observations,
not configuration or deployment changes.

The curated tuning source and its direct-entry companion now contain the
current observed bytes. Their source revisions are unknown (null), not guessed
from this repository's base commit. provenance/current-state.json separately
records original, publication and deployment identities, rights, dependencies,
closure, coverage and status. Publication identity means Git-normalized UTF-8
blob bytes; worktree CRLF is not a substitute for that identity.

The tuning companion is executed directly with Node, with positive test and
assertion counts. Importing its no-op auto-discovery factory proves nothing.
The separate pure matcher check returns null for both gpt-6.1-sol and
chatgpt-subscription/gpt-6.1-sol, and null-family application preserves input.
Those checks do not start the extension or an application. This legacy tuning
must not be described as applying to Sol 6.1. No matcher widening is made.

## Recoverable portions

The current tuning pair is recoverable from its named extensions paths.
Historical package sources, scripts, safe inventory example, rights notices
and the 17 sealed refresh-04 authoring inputs remain recoverable from the
historical tree. The old tuning pair remains obtainable at the historical
commits; the current pair does not backfill those commits. The new management
direction is a sanitized derivative, not the original local document.

## Nonrecoverable and unavailable portions

Historical receipt-era slot-4 SOURCE_GAP remains: qa/gate-repair-anchor.mjs,
qa/gate-request-fixture.test.mjs and patches/deltas/slot-4-gateRepair.insert.js
at their historical missing identities cannot be restored from hashes.
The sealed refresh-04 files with similar names have different identities and
are not repairs of that gap.

Current launcher omo.cmd and R6 re-entry are metadata-only here. Both require
the unbundled task-builtins-activation-r1/verify-overlay.mjs, lane directories,
engine stamp and installed entry points. Its admission needs an exact-path
rights/dependency amendment and isolated publication-adapter checks; executing
the current launchers is not an authorized way around that boundary.

Current task-builtins-5.1.6-r1/build.mjs and tests.mjs are also metadata-only.
The builder embeds seven SUL-covered OmO seams and needs the full SUL notice
and MODIFIED provenance if later admitted. Its companion imports the builder
and spawns native parent/child CLI probes. This lane forbids nested workers;
that closure and machine-path adapter are not certified or published here.
Previously retained overlay RESULTS.json is a prior receipt, not a fresh run.

External omo-ai 5.1.6 and Senpi 2026.9.30 runtime/base bytes, pinned upstream
base c5d4972f53421d31a2568f56ef1b2bc0a268fa2a, engine outputs, credentials,
raw settings/models/configuration, backups and local receipts are not shipped.
The external desktop mirror test used by the historical omo-check skill is
also unbundled. Public pins identify inputs to obtain separately; hashes alone
do not reconstruct them. No complete clone recovery or runtime readiness is
claimed. Raw agent settings and engine configuration have distinct hash-only
records; volatile settings drift is classified by safe per-field identities.

## Status and maintenance

Direction finalized, source prepared, self-verification, applied, runtime
verified and pushed are separate labels. This curation does not change the
live home, launcher, runtime, models, permissions or sessions. It does not
commit or push. Independent publication review remains required.
Native parallel capability is reused, not reimplemented or benchmarked here.
The requested-update preservation acceptance belongs to Task11 and is not
reported as completed by this Task9 record.

## Publication audit boundary

The source auditor excludes only root .git administration, whether an ordinary
directory or a linked-worktree pointer file. Nested .git entries and metadata
lookalikes remain subject to default-deny; symlinks remain rejected. Git metadata
is never admitted or published. The original failed audit receipts are retained
outside the curated tree, alongside the source-bound repair and regression proof.

Eight inherited machine-path comment literals in the sealed refresh-04 slot-4
fragment and gate-repair anchor remain an explicit historical NOTE, not a
whole-tree machine-path-free PASS. Approved plan line 129 requires machine-path
review of changed blobs; lines 84 and 242 preserve sealed historical bytes.
Whole-tree UTF-8, NUL, binary, mode and token checks remain required. This source
repair does not grant publication approval; independent review and any later
same-commit audit remain separate gates.
