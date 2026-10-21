# Private memory rollback overlay — 5.1.35 rebase (memory-rollback-5.1.35-r1)

This is a private local compatibility patch, not an official upstream release. It adapts only
the memory transaction rollback and literal Git path handling from PR #10000 in
code-yeongyu/oh-my-openagent, re-derived on top of the official omo-ai 5.1.35 package.

## Activation

The stable-500 wrapper (R20) and its reentry select this immutable generation:

```
C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.35-r1
```

Ordinary new launches and memory-capable stock routes use the custom package. Package-management
helpers (`setup`, `update`, `install`, `remove`, `list`, `config`, `auth`) and sole
version/help/tips keep the actual installed entry; they do not load a memory owner. The updater
must retain its real Bun installation prefix rather than derive an npm target from the copy.

Other routes verify the gate, manifest, three changed bundles, entry files, installed versions,
preparation stamp, and dependency junction before launching. There is no silent fallback to an
unpatched memory writer. Already-running windows keep their old JavaScript modules; exit and
reopen through stable-500 to activate the new owner.

## How this base was produced (2026-10-18)

- Base: official omo-ai 5.1.35 tarball (sha256 dee524ea78dfd7ce60311551661e2bf0abdd025c63715cac5c1c3e2d128401a1,
  integrity verified against the registry).
- The 5.1.34 overlay (memory-rollback-5.1.34-r1) was NOT copied. The four literal-pathspec
  replacements were re-applied; the commit-catch change was re-anchored on freshly re-derived
  minified bindings (pB=DirtyRepoError, qW=MemorySecretError, $J=thrown wrapper; verified from
  the 5.1.35 bundle bytes). Anchors verified unique before any output.
- Isolated revalidation on the new bytes: evidence/native-baseline-5135.json (stock still
  broken) and evidence/native-patched-5135.json (overlay fixed) in this project.
- The installed upstream package is not overwritten. See UPSTREAM-LICENSE.md. No MIT license
  is asserted.

## Next official update

Do not change only the version pins. Rebuild this overlay for the new package bytes (bundle-patch
PINS + any minified binding anchors), rerun test/native-scenarios.mjs in `baseline` (expect the
defect) and `patched` (expect clean recovery) modes against the candidate plugin directory, then
switch the wrapper/reentry together. test/patch.test.mjs is the historical 5.1.34 pre-install
gate — do not reuse it as a new-version test. The normal stock package manager remains accessible.
