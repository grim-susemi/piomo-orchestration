# Requested-update preservation

This contract adds acceptance checks to the existing stable-500 requested-update
procedure. It isn't an updater. Installation and launcher changes require their
own installation scope; this record performs neither.

## Current native capability

The observed Senpi 2026.9.30 source at
`dist/core/dynamic-prompt/working-task.js:4` already directs independent tool
calls into a parallel wave. Use the existing `eval` and `parallel(thunks)` path
for bounded independent reads, searches, listings and diagnostics. Inspect every
result, including failures and truncated output. Calls that need a preceding
result stay sequential. Edits, installs and Git operations also stay sequential,
with one writer for the curated tree.

Task11 exercised two actual native `read` calls in one wave: the native
working-task source and the current tuning event-handler source. Both returned
complete bounded results. This proves availability of this session's read path,
not model adherence, a fresh engine's loading, update survival or a speed gain.
No model call, fresh engine or benchmark was run.

Don't copy the native paragraph into another prompt or extension. No new role,
interceptor, server, watcher or runtime is needed for this observation.

## Seven acceptance checks for a requested update

Run these steps within the existing update procedure when an update is separately
requested. Keep old and new evidence distinct and retain failed or unavailable
rows. All post-update steps below are future, unperformed work in this record.

1. **Freeze the old state.** Record runtime versions and pins, launcher/re-entry
   paths, selected home/plugin, and hashes and sizes of managed custom files.
   Record safe model/provider/thinking/profile and permission/routing identities
   separately from raw settings hashes. Usage-history byte drift alone isn't
   semantic drift. Keep raw configuration and original machine paths private.
2. **Stage and assess the new version.** Use the existing staging process.
   Compare old/new pins, dependencies and compatibility with the selected
   custom layer and overlay. Name missing inputs or incompatible seams before
   installation; a preserved source file doesn't establish compatibility.
3. **Update and re-pin under installation scope.** Change launcher/re-entry
   selection only as authorized for that requested update. Record the exact
   new pins and selected targets. This documentation grants no installation,
   restart or permission changes.
4. **Check preservation and selection.** Compare managed home-file identities
   with the old inventory and classify intentional changes. Confirm that the
   launcher still selects the intended home and plugin. Don't revive parked
   historical plugins, overwrite foreign settings, or restore foreign context
   files to force the desired result.
5. **Verify the restarted engine's actual surface.** After an authorized restart,
   verify required loading and intended model applicability separately. Exercise
   two bounded independent read-only tool calls through the supported path and
   retain both inputs, results and failures. File discovery isn't loading;
   a matcher result isn't behavior. Observe any required custom behavior with
   its own bounded check rather than inferring it from preserved bytes.
6. **Check native parallel support.** Confirm the new native rule and supported
   call path remain present. If either changed or disappeared, assess that
   specific difference and record an incompatible or unverified row. Don't
   blindly paste the old prompt into a package or enable legacy tuning to
   replace native support. Two reads aren't a speed benchmark.
7. **Record the exact updated state.** Update the custom-source record with
   old/new identities, publication adaptations and bounded check receipts.
   Separate source prepared, preserved bytes, loading, matcher applicability,
   actual behavior, applied state and pushed state. A Git commit or matching
   remote ref establishes neither deployment nor runtime behavior. Publish only
   reviewed source and sanitized metadata through the existing publication gate.

## Model applicability and evidence limits

The current legacy tuning source uses exact model-ID sets.
`gpt-6.1-sol` and `chatgpt-subscription/gpt-6.1-sol` both match no family.
Task9's pure exported-function check returned `null` for each and preserved the
input for null-family tuning. Its source handler returns without prompt mutation
when no family matches. These are bounded source/API facts, not proof that the
extension loaded or ran in this session. Don't add Sol 6.1 to the legacy set:
that would activate unrelated old directives as well.

Source preservation, extension loading, matcher applicability, actual custom
behavior, native read-path availability and remote publication are separate
claims. Task11 records source reads and the current read path only. A new version
hasn't been staged, installed, restarted or tested here.

## Restoration and publication boundary

See [current-state.md](current-state.md) and
[`provenance/current-state.json`](../provenance/current-state.json) for component
identities and status. Current tuning source and its companion are prepared;
launcher, R6 and overlay build/test inputs remain metadata-only gaps. Historical
slot-4 SOURCE_GAP remains unrecoverable. External runtime/base bytes, activation
verifier, credentials and raw home/configuration aren't shipped. Hashes don't
restore missing bytes, so this tree isn't a standalone runnable release.

Task9's whole-worktree strict audit remains blocked by the linked-worktree
`.git` pointer. Sealed historical machine-path comments also need independent
publication review. Task11 re-runs the unchanged strict auditor and retains its
actual verdict outside this tree. No metadata allowlisting, historical rewrite,
commit or push is implied by this maintenance contract.
