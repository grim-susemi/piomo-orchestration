# DRAFT (not posted) - issue for code-yeongyu/senpi

**Title:** anthropic-subscription: `captureProviderFinal` hashes the whole message on every `message_update`, so retained heap grows quadratically during long generations

## Summary

`registerSessionRegistry` registers a `message_update` handler. For each streamed delta of
a resident assistant message, the handler calls
`AssistantCommitBoundary.captureProviderFinal(sessionId, event.message)`. That method stores
`assistantContentHash(message)`, which is `sessionSyncDigest` → sha256 of
`JSON.stringify(stableValue(...))` over the full partial message.

The cost of each call is linear in the size of the message, so total CPU per message
is quadratic. More importantly, the memory retained while the message streams also
grows quadratically: a forced full GC does not release it. The process is released
only when the message ends.

With opus and thinking `max`, one generation can stream for 15-35 minutes. The process
then reaches several GB and is killed by V8's heap limit with no JS-level log. On
Windows this shows up as an unclean exit.

Files: `src/core/extensions/builtin/anthropic-subscription/session-commit-boundary.ts`
(`captureProviderFinal`) and `session-registry-wiring.ts` (`pi.on("message_update", ...)`).
They are unchanged on main as of 2026-10-20 (senpi 2026.10.19, npm 2026.10.19-2).

## Measurements (Windows 11, Node 24.19, senpi 2026.10.19)

Each run is one `senpi -p` process with opus 5.5, thinking `max`, and a synthesis prompt
over ~15 local files. Private bytes by elapsed time:

| elapsed | unpatched (3 runs) | patched (4 runs) |
| --- | --- | --- |
| 4.3 min | 471-517 MB | 266-280 MB |
| ~14 min | 1,855-2,225 MB | 268-292 MB |
| ~18-19 min | 2,918-3,165 MB (2 runs; the third run's message ended at ~17 min and it dropped to 855 MB) | 275-296 MB |

A full research run on the same machine on 2026-10-20 gave the same split. Each worker is one `senpi -p` process with opus 5.5 at thinking `max`. Peak private bytes come from the runner's `mem.jsonl`:

- Unpatched installed CLI, 4 workers in parallel: peaks were 1,738, 2,331, 2,951 and 3,225 MB at 21.4 min, when the runner was replaced.
- Patched CLI, 7 workers (6 of the same slice tasks plus one final reduce):
  - Peaks were 377-578 MB over runs of 16.7-81.5 min.
  - The longest run (81.5 min) peaked at 534 MB.
  - Node wrote no fatal-error reports.

- At ~16 min, one unpatched process had heapUsed 1,248 MB. After `HeapProfiler.collectGarbage` it was still 1,243 MB.
- A 45 s sampling heap profile attributed 137.9 of 139.7 MB of retained new allocations to `digest`. The stack is `digest ← (message_update handler) ← registeredHandler`.
- Memory fell back to ~400-850 MB when the message ended.
- CPU stayed low, about 1 s per minute, so this is not an event backlog.

An interactive session that ran four such generations as in-process children died four
times out of four, 11-12 minutes after they started. It left no exception log, which
matches four quadratic curves together exceeding the default ~4 GB heap.

## Inference (not proven)

Something keeps per-update message snapshots alive until `message_end`. Without the
digest, those snapshots would share string ropes and grow linearly. The per-update
`JSON.stringify` flattens each snapshot's text into its own full copy. I did not
identify the holder of the snapshots. Either way, removing the per-update hash removes
the quadratic term.

## Proposed fix

Keep the last streamed payload with string references only, and hash it once in
`commit()`. See the PR draft. The `clean` / `rewritten` / `not-resident` verdicts are
unchanged, and so is the result-only turn, where there is no preceding delta and
`providerFinal` is undefined.
