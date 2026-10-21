# memory-overlay - provenance

Re-captured 2026-10-22 from the live R22 generation (first captured 2026-10-20 from R21).
This patch has no git repository of its own: the build project
`C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.40`
has `src/`, `test/` and `evidence/` but no `.git`. The files here are the captured
source of the three installed bundles that differ from stock.

## Installed generation

| Item | Path / value |
| --- | --- |
| Overlay package | `C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/package` |
| Generation manifest sha256 | `7a67e6b96c257ea4aad2487a9ddcd25e53b908ba147ab9f6164d5975d346f096` |
| Gate sha256 | `19f1fb535faac06d2b971e8c06713c9ae24e0ad5a4dadd13a504119d0e456fda` |
| Overlay omo version | 5.1.40 |
| Senpi version | 2026.10.19-2 |
| Stock comparison | official omo-ai 5.1.40 tarball (`a4b11265...`), extracted to `staging/upgrade-5.1.40-inspect/pristine-omo-ai`; equal to the installed global package |
| Build project | `C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.40` (`src/stage.mjs`, `src/bundle-patch.mjs`, `src/gate.mjs`; no git) |

## Upstream

- PR: https://github.com/code-yeongyu/oh-my-openagent/pull/10000 (still open on 2026-10-20)
- PR head: `dd86ddb7f9fd919ed4921bca2668c0016be7817e` (R21 used `4406c7776ca6582cc206819fadc1b34a060d4729`)
- PR base at capture: `c2c258d6ea7284b3aeae052fbcee3a5231e0793e`

## R22 rebase note

For 5.1.40 the PR head converts six git call sites to `--literal-pathspecs` (status, restorePaths
restore/rm, unstage restore/rm, stage add). The commit catch was re-derived from the 5.1.40 bytes in
the order of commit-write.ts at `dd86ddb7`: `oP` (no effective changes) first, then `vN` stranded lock
to `vD`, `iP` DirtyRepoError rethrown, then restorePaths, then `lM` MemorySecretError wrapped in `yD`.
Baseline (defect reproduced) and patched (recovered) native scenarios passed on the isolated
2026.10.19-2 engine; a new process through `omo.cmd` and the reentry loaded this generation as the
single `omo.js` owner (`build/test-captured/live-validate-r22.mjs`).

## R21 rebase note

The R19/R20 overlay was not copied. For 5.1.38 the PR was re-derived on the new
bundle bytes: upstream reworked the commit catch (new `zG` stranded-lock branch to
`zV` rollback), so the rebase keeps that branch first and re-derives
`wB` = DirtyRepoError, `OK` = MemorySecretError, `LV` = MemoryToolError. The literal
Git pathspec replacements were re-applied. Anchors were verified unique before any
output; baseline (stock) and patched recovery were both re-run in the isolated
`staging/upgrade-5.1.38` engine. See memory note
`2026-10-19-omo-ai-5138-r21-cutover-and-coordination-lag-fix.md`.

## Captured files

`omo-task.js` is excluded from this row: it belongs to the coordination-adapter row
and is identical in the overlay and the global install.

| Installed file | Size | Overlay sha256 | Stock sha256 | Capture |
| --- | --- | --- | --- | --- |
| `plugin/extensions/omo.js` | see file | `de8408a08dc84a389316af6f6fc407fa260d129b04748e354e291b104cee8c6c` | `99262013ba80365491acdb1224291f6f41c5b0e1013e07ca605e452ed8c83b19` | `omo.js` (byte copy; over 1 MB) |
| `plugin/extensions/omo-memory-doctor.js` | see diff | `900cb31eaf81e6b75e188820a0738f4c8943338d5d1cc45841637151b6a3e813` | `cdea5f06ea8b37cd6bd3c3171d24785af747b423f7ea8bd8acf6d53032801bfa` | `omo-memory-doctor.diff` |
| `plugin/extensions/omo-memory-memfs.js` | see diff | `7f832ed672cad107d7a54c3f6c90edd7275da2af1bf7305b2cefead56a6e3bdc` | `a1c8a81358b7e5f22f323040d5489d13c33d756ee710fa5f5d79187667d33b7b` | `omo-memory-memfs.diff` |

The diffs are `git diff --no-index` output with the overlay copy as `a/` and the
stock copy as `b/`, so `-` lines are the overlay and `+` lines are stock. Because the
bundles are minified, each difference is one long line; the diff still carries the
exact bytes.

Also present in the generation but not patched: `NOTICE.md` and
`UPSTREAM-LICENSE.md` (overlay license files, listed by `diff -rq` as "Only in").
`bin/`, the remaining `plugin/` tree and `package.json` are byte-identical to stock.

## Rebuild

```bash
# from the build project, on the stock 5.1.38 tarball:
node src/stage.mjs   # or the runner in staging/upgrade-5.1.38/install/install.mjs
node test/native-scenarios.mjs --mode baseline   # expect the defect
node test/native-scenarios.mjs --mode patched    # expect recovery
```

The wrapper and reentry select the immutable generation; there is no in-place edit
of the installed global package.

## Check

```bash
node custom-layer/check-patches.mjs --only memory-overlay
```

## Retire

Retire when stock omo-ai at the pinned version matches the three overlay hashes, or
when PR #10000 merges and the pinned stock contains the fix. Re-run
`test/native-scenarios.mjs` in `baseline` and `patched` modes before retiring; a
version bump alone does not retire it (rebuild the overlay instead).
