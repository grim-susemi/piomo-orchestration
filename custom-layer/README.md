# custom-layer

Small PiOMO extensions that run on the owner's machine but had no repository of their own. The files are copied byte-for-byte from the installed locations (2026-10-20). Runtime state files such as settings-guard/last-good.json are not included.

| Folder | Installed at | Loaded by |
|---|---|---|
| settings-guard | ~/.omo/agent/settings-guard/extension.mjs | ~/.omo/agent/extensions/omo-settings-guard.js (alert only, owner choice 2026-10-17) |
| task-record-publish-retry | ~/.omo/agent/task-record-publish-retry/extension.mjs | ~/.omo/agent/extensions/omo-task-record-publish-retry.js (owner decision 18=A) |
| task-no-fallback-pkg | ~/.omo/agent/task-no-fallback-pkg/ | settings.json "packages" |
| herdr-agent-sidebar-repair | orca/projects/herdr-agent-sidebar-diagnosis/repair/ | settings.json "extensions" (herdr-senpi.mjs) |


## Patch ledger and check

`PATCHES.md` is the one ledger for every live custom patch: source location, remote and commit,
state (`tracked` / `local-commit`), how it is applied, its check command, the upstream link
and its retire condition. `check-patches.mjs` re-checks the rows read-only and exits 0 even
when a row drifts:

```bash
cd C:/Users/USER/orca/projects/piomo-orchestration-source
node custom-layer/check-patches.mjs                # one line per patch + summary
node custom-layer/check-patches.mjs --only <name>  # one row
node --test custom-layer/test/check-patches.test.mjs
```

The `memory-overlay` row is captured here because its build project has no git repository:
`memory-overlay/omo.js` is a byte copy of the installed overlay bundle, and the two smaller
bundles are stored as `git diff --no-index` output against stock omo-ai 5.1.38. See
`memory-overlay/PROVENANCE.md` for the hashes, PR #10000 and the R21 rebase note.

Run the ledger check before and after every omo/senpi update; the plan's update-time procedure
(`.omo/plans/research-session-freeze-fix.md`) uses it to decide re-apply vs retire.
