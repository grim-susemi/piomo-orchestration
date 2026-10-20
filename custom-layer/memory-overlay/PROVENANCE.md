# memory-overlay - provenance

Captured 2026-10-20 from the live R21 generation. This patch has no git repository of
its own: the build project `C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.38`
has `src/`, `test/` and `evidence/` but no `.git`. The files here are the captured
source of the three installed bundles that differ from stock.

## Installed generation

| Item | Path / value |
| --- | --- |
| Overlay package | `C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/package` |
| Generation manifest sha256 | `15177e17f64e9a7f8bdcc5abaf3d8aacfc6a6a39d01bf7894ac4039221d7a177` |
| Gate sha256 | `5c74e89b8b47f9108d5a974f3b41960ff7c3896d25cc46d8d8663b188a02479c` |
| Overlay omo version | 5.1.38 |
| Senpi version | 2026.10.19 |
| Stock comparison | `C:/Users/USER/.bun/install/global/node_modules/omo-ai` (5.1.38) |
| Build project | `C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.38` (`src/stage.mjs`, `src/bundle-patch.mjs`, `src/gate.mjs`; no git) |

## Upstream

- PR: https://github.com/code-yeongyu/oh-my-openagent/pull/10000 (still open on 2026-10-20)
- PR head: `4406c7776ca6582cc206819fadc1b34a060d4729`
- PR base at capture: `90ba59d80a16732f3e56892478c42f773105062c`

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
| `plugin/extensions/omo.js` | 1,533,145 B | `4a8aef923825ccd5fbb5ab6d4b3b72e0ae145b670309f1db3ead53827c029476` | `de9603b563e9bca417f431006e0ced5bab0e126dc3b530b5fd1e83c0371cff69` | `omo.js` (byte copy; over 1 MB) |
| `plugin/extensions/omo-memory-doctor.js` | 184,801 B | `1f4758613c914142864b12cc985213c0aeb4f79e933f12402b61b5ad9aa79b16` | `fb63df01193939faacb3152f802368b7b6fa36a3c4de0df5bdfd02b8f3c3c8a4` | `omo-memory-doctor.diff` |
| `plugin/extensions/omo-memory-memfs.js` | 68,667 B | `611ec44b91e98abbd1375e24c87b72a033a3de7864c1788ce07e56ad8f0be17e` | `8b40193e6882b3451ffa4b1b879fa7528e5557896191517b4352740b796d6260` | `omo-memory-memfs.diff` |

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
