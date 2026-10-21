# senpi-stream-hash-leak

A managed anchor patch for senpi `2026.10.19` and `2026.10.19-2` that stops the heap
growth that killed long-running agent sessions on the Claude subscription provider.

## Defect

The builtin `anthropic-subscription` extension registers a `message_update` handler that
calls `AssistantCommitBoundary.captureProviderFinal` on every streamed delta.
`captureProviderFinal` stores `assistantContentHash(message)`, i.e. sha256 of
`JSON.stringify` of the whole partial message. Each call flattens the growing text, and
the flattened copies stay reachable until the message ends. During one long generation
(opus, thinking `max`) a process's retained heap grows roughly quadratically.

Measured on 2026-10-20, with one print-mode worker per process, unpatched:

- elapsed 6.3 min: 725 MB
- 11.7 min: 1,657 MB
- about 19 min: 3,225 MB

A forced full GC left heapUsed at 1,243 of 1,248 MB. A sampling heap profile attributed
137.9 of 139.7 MB of retained new allocations to `digest`, called from
`captureProviderFinal` inside the `message_update` handler.

An interactive lead running four such children in-process crossed the default 4 GB heap
after 11-12 minutes. It died with no log: `process-crashes` recorded `unclean_exit`.

With the patch, the same workloads stayed at 266-296 MB.

Evidence:

- `C:/Users/USER/orca/projects/기타 작업/.omo/ulw-research/20261020-032103/sb6/` (`mem.jsonl`, `probe/heap-sample-slice-c5.json`)
- `C:/Users/USER/orca/projects/기타 작업/.omo/evidence/senpi-stream-hash-leak/`

## What it changes

| File | Edit |
| --- | --- |
| `dist/bundle/chunks/chunk-35M5MVUZ.js` (2026.10.19) | main-thread copy (identifiers `key`, `modelId`) |
| `dist/bundle/chunks/chunk-F4ZU4RBE.js` (2026.10.19-2) | main-thread copy (identifiers `key`, `modelId`) |
| `dist/bundle/chunks/session-worker.js` | worker-thread copy used by in-process children (`key2`, `modelId2`) |
| `dist/core/extensions/builtin/anthropic-subscription/session-commit-boundary.js` | unbundled module |

The bundle chunk is renamed between builds; `FILE_CHUNKS` maps a version to its
chunk and `targetsFor(version)` returns the three targets. The anchors themselves
are unchanged for `2026.10.19-2`.

In each copy:

- `captureProviderFinal` stores `{role, api, provider, model, content.map(semanticContentBlock)}`. It keeps string references only and does not hash. A `/*omoStreamHashLeakFix*/` marker identifies the edit.
- `commit` compares `sessionSyncDigest(providerFinal)` with `assistantContentHash(message)`. It hashes exactly once, at `message_end`.

The verdicts stay the same: `clean` for an unchanged message, `rewritten` for a changed one, and `not-resident` otherwise.

## Where it must be applied

Senpi does not execute the install. `dist/bundle/cli.js` hands off to a runtime snapshot
copied into `<agent>/runtime/<buildId>-<installId>/`. Senpi reuses that snapshot as long
as its `buildId` matches, and editing files does not change the `buildId`. A patch on
the install alone is therefore **not live**.

Apply to both:

- the snapshot, which is what sessions run;
- the install, so the two stay consistent.

`check-patches.mjs` checks every snapshot and reports drift when one is not patched.
Already-running processes keep the code they loaded. Sessions started after the apply
use the patched code.

## Layering with senpi-freeze-fix

Both patches edit the two bundle files. This patch decides its state from anchors, not
from whole-file hashes. The freeze-fix checker reports a file as `patched` with
`layered: true` when its own edits are intact under another layer.

Order:

1. Apply freeze-fix first, then this patch.
2. When removing, remove this patch first.

## Commands

```bash
node patch.mjs --senpi-root <dir> --check            # read-only, exit 0
node patch.mjs --senpi-root <dir> --apply [--receipt <file>]
node patch.mjs --senpi-root <dir> --remove [--receipt <file>]
node probe.mjs --senpi-root <dir> [--from-backups]   # defect-present | defect-absent | needs-review
node --test test/patch.test.mjs test/probe.test.mjs
```

Exit codes:

- `0`: success or no-op.
- `2`: unsupported version, missing file, or anchor mismatch. Nothing was written.
- `3`: a write failed and every replaced file was rolled back. Also returned when the receipt could not be written.

`--apply` writes `<file>.leak-fix.bak` once, writes each result to `<file>.leak-fix.new`,
then renames it into place. `--remove` reverses the edits (replacement back to anchor)
the same way, then deletes the backups. Reversing instead of restoring the backup keeps
any layer applied before or after this one.

`probe.mjs` is independent of the anchors:

- **static**: whether any copy of `captureProviderFinal` computes a digest.
- **behavioral**: imports the unbundled module from `<dir>` and times 20 captures of a 4 MB thinking block. Measured: about 5 ms per call pristine, about 0.003 ms patched. It also checks that `commit` still returns `clean` and `rewritten`.

## At every senpi update

1. Install the update and start one session, so the new runtime snapshot is materialized.
2. Run `node probe.mjs --senpi-root <new snapshot>`.
   - `defect-absent`: upstream fixed it. Do not apply. Mark the ledger row `retired (upstream <version>)`.
   - `defect-present`: run `patch.mjs --check`.
     - If the anchors are found once each, add the version to `SUPPORTED_VERSIONS` and apply to the snapshot and the install. Freeze-fix first.
     - Otherwise, re-derive the anchors from each file's own text. Bundled copies rename locals (`key2`, `modelId2`).
   - `needs-review`: read the upstream change by hand.
3. Run `node custom-layer/check-patches.mjs`. Every `runtime:*` entry must be `patched`, or the row must be retired.

## Upstream

- `code-yeongyu/senpi` main still has this code as of 2026-10-20: `packages/coding-agent/src/core/extensions/builtin/anthropic-subscription/session-commit-boundary.ts`, last changed 2026-09-22.
- A search on 2026-10-20 found no related issue or PR.
- Issue and PR drafts: `upstream/` in this directory.
