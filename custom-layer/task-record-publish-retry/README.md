# task-record-publish-retry

Elapsed-time-bounded retry for Windows task-record publication
(`senpi-task/tasks/st_*.json` tmp + `renameSync`), plan D9 (r4).

## Rule

- Budget `budgetMs` (default 1000 ms) from before the first attempt.
- Each attempt is timed; `maxAttempt` is the slowest attempt so far in the call.
- Each sleep is timed; `reserve = max(20, maxOvershoot)`.
- After a retryable failure (`EPERM`/`EBUSY`/`EACCES`):
  `allowance = min(nextDelay, budgetMs - elapsed - maxAttempt - reserve)`.
  `allowance <= 0` means exhausted. Otherwise sleep `allowance`
  (once `delays` runs out, the last delay repeats).
- After each sleep, `budgetMs - elapsed - maxAttempt <= 0` means exhausted
  with no further attempt.
- Only an attempt slower than every earlier attempt, or a sleep overshooting
  by more than the reserve, can end past the budget — and nothing starts after
  either. A first attempt alone using up the budget is never retried.
- Any other error rethrows at once; non-task paths pass straight through.

## Exhaustion log

On exhaustion the wrapper schedules one JSON line with `setImmediate` and
rethrows at once, so logging never blocks the calling thread:

`{"ts","event":"publish_retry_exhausted","src","code","attempts","elapsedMs","maxAttemptMs"}`

The real log appends it to `<agentDir>/logs/task-record-publish-retry.log`
(`OMO_CODING_AGENT_DIR`, falling back to `PI_CODING_AGENT_DIR`), rotating
once to `.1` above 1 MB. The pending write is exposed as `pendingLog` on the
marker state `globalThis[Symbol.for("omo.custom.taskRecordPublishRetry.v1")]`;
a log failure is recorded there as `logFailures` (count) and `lastLogError`
(message) — never thrown, never dropped.

**Note: a process that exits before the log write lands loses that line.**
The throw is synchronous but the write is not; a crash or a fast exit in
between drops the exhaustion record.

## Tests

`node --test test/extension.test.mjs` — fake clock shared by the fake
rename, sleep and log; `end` = clock at throw/return.
