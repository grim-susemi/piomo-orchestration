# senpi-freeze-fix

A managed anchor patch for senpi `2026.10.19` and `2026.10.19-2` that removes
the two causes of the 12-22 s session freeze described in
`.omo/plans/research-session-freeze-fix.md` (IS-1, D1, D2).

The patch is applied to the installed package, never to a fork:

```
C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi
```

## What it changes

Two defects, four files (the two standalone sources and the two bundles that
inline them):

| File | Edit |
| --- | --- |
| `dist/core/extensions/builtin/moved-path-guard/command-paths.js` | `embeddedPaths` skips a `//...` match whose preceding text ends in `scheme:`; the `commandPaths` words loop skips `scheme://...` words |
| `dist/core/tools/filesystem-policy.js` | inserts `omoFreezeFixUncTimeout`; after the bounded resolver times out, an ordinary UNC path throws `ETIMEDOUT` (with `omoFreezeFix: true`) instead of entering the synchronous fallback walker |
| `dist/bundle/chunks/chunk-35M5MVUZ.js` (2026.10.19) | both edits, minified identifiers |
| `dist/bundle/chunks/chunk-F4ZU4RBE.js` (2026.10.19-2) | both edits, minified identifiers |
| `dist/bundle/chunks/session-worker.js` | both edits, minified identifiers |

Each supported version names its own bundle chunk and minified locals in
`BUNDLE_SHAPES` (`patch.mjs`); `filesFor(version)` returns that version's four
paths. The `2026.10.19` entry is the original byte-exact anchor set and emits
the same patched bytes as before.

`utils/paths.js` and `chunk-G3ZEPNGM.js` hold `realpathWithoutOpenStrict` and are
deliberately unchanged: the fix sits at the caller. ReFS device paths (`\\?\`),
device names (`\\.\`), `\\wsl.localhost\` and `\\wsl$\` keep the original
fallback; only other UNC paths change.

The inserted predicate text is the body of `unc-timeout-predicate.mjs` with
`export ` removed. `test/predicate.test.mjs` imports that file and also asserts
that `patch.mjs` embeds the same text, so the tested predicate is the shipped
predicate.

## Commands

```bash
# read-only on any version; always exit 0
node patch.mjs --senpi-root <dir> --check

# apply the supported version's edits
node patch.mjs --senpi-root <dir> --apply [--receipt <file>]

# restore the pristine files from their .freeze-fix.bak backups
node patch.mjs --senpi-root <dir> --remove [--receipt <file>]

# defect probe on a temp copy of <dir>/dist
node probe.mjs --senpi-root <dir> [--from-backups]

# tests (the 19-2 cases need an extracted pristine tree)
SENPI_19_2_ROOT=<extracted 2026.10.19-2> node --test test/*.test.mjs
```

Exit codes: `0` success/no-op; `2` unsupported version, unknown file, or unknown
content (nothing written); `3` a write or rename failed and every already
replaced file was rolled back, or the files were replaced but the optional
receipt could not be written (the printed object carries `receiptError`).

Write protocol: compute every edit in memory, write `<file>.freeze-fix.bak` for
each pristine target, write each result to `<file>.freeze-fix.new`, then rename
each into place. `--remove` uses the same `.new` + rename path and deletes the
backups after all four files are restored. Running `--apply` on a patched tree is
a no-op; running it again after `--remove` writes fresh backups.

`probe.mjs` reports `urlExtraction` (`present`/`absent`), `syncWalkerFallback`
(`present`/`absent`/`unrecognized`) and a verdict: `defect-absent` only when both
are absent, `defect-present` when either is present, otherwise `needs-review`.
`--from-backups` overlays the `.freeze-fix.bak` files in the temp copy, which
answers "what does the pre-patch tree look like" without touching the install.

## baselines.json

For every supported version and targeted file it stores two sha256 values:

- `pristine`: the installed or extracted upstream bytes;
- `patched`: the output of `--apply` on a scratch copy of those same bytes.

The `patched` hash is what makes a second `--apply` a no-op and what makes
`--check` distinguish `patched` from `unknown`. `2026.10.19-2` was derived from
`senpi-2026.10.19-2.tgz` (sha256 `c9debe5f...0405f8`); its two unbundled files are
byte-identical to 2026.10.19 and only the bundles changed.

## Re-deriving the anchors at an update

The update routine runs `--check` first. If the version is not listed, the tool
prints `version: "unsupported"` and, per file, `anchorsFound` and `patchesFound`
for each named function copy. Then:

1. Run `probe.mjs --senpi-root <dir>` on the fresh install.
   - `defect-absent` -> upstream fixed it. Retire the patch and mark the ledger
     row `retired (upstream <version>)`.
   - `defect-present` -> re-derive:
     a. Open each targeted file and locate the function copy printed by the
        probe/`--check` (`embeddedPaths`, `commandPaths`,
        `canonicalizeFilesystemPath`). Bundled copies use renamed locals
        (`path13`, `segment2`, `canonicalPath2`, ...), so derive each anchor
        from the file's own text rather than copying another file's anchor.
     b. Add a `versions.<version>.files` entry in `baselines.json` with the four
        pristine sha256 values (`sha256sum <file>`). Leave `patched` empty.
     c. Add/adjust the anchors and replacements in `patch.mjs`
        (`buildTargets`). Each anchor must occur exactly once in its function
        copy. Keep the predicate insertion identical to
        `unc-timeout-predicate.mjs` minus `export `.
     d. Apply to a scratch copy: `cp -r <dir>/dist /tmp/rehearse/dist`, copy
        `package.json`, run `--apply`, then record the four resulting sha256
        values as `patched`.
     e. Run `node --test test/*.test.mjs`; every test asserts the anchors occur
        once in the installed copies.
     f. Run `--apply` on the real install and write a receipt.
   - `needs-review` -> read the changed function by hand before choosing.
2. Version supported and every file `pristine` -> `--apply`.
3. Commit `baselines.json` and the updated `patch.mjs` with the ledger row.

## Notes

- `--check` never writes. It is safe to run before an update.
- The test-only environment variable
  `SENPI_FREEZE_FIX_TEST_FAIL_RENAME=<n>` injects a rename failure at the n-th
  file so the rollback path is covered by `test/patch.test.mjs`.
- Backups live next to the patched files inside `dist`, so an update that
  replaces `dist` removes them together with the patch. Re-apply after an
  update; never assume a leftover `.bak` is current.
