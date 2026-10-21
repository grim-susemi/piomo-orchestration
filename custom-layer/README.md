# custom-layer

Small PiOMO extensions that run on the owner's machine but had no repository of their own. The files are copied byte-for-byte from the installed locations (2026-10-20). Runtime state files such as settings-guard/last-good.json are not included.

| Folder | Installed at | Loaded by |
|---|---|---|
| settings-guard | ~/.omo/agent/settings-guard/extension.mjs | ~/.omo/agent/extensions/omo-settings-guard.js (alert only, owner choice 2026-10-17) |
| task-record-publish-retry | ~/.omo/agent/task-record-publish-retry/extension.mjs | ~/.omo/agent/extensions/omo-task-record-publish-retry.js (owner decision 18=A) |
| task-no-fallback-pkg | ~/.omo/agent/task-no-fallback-pkg/ | settings.json "packages" |
| herdr-agent-sidebar-repair | orca/projects/herdr-agent-sidebar-diagnosis/repair/ | settings.json "extensions" (herdr-senpi.mjs) |


## Patch ledger and check

`PATCHES.md` is the one ledger for every live custom item: source location, remote and commit,
state (`tracked` / `local-commit` / `private` / `external`), how it is applied, its check command,
the upstream link and its retire condition. Per-row update rules are in `UPDATE-RULES.ko.md`;
isolated evaluations of new official versions are in `evaluations/`. `check-patches.mjs`
re-checks the rows read-only and exits 0 even when a row drifts; `--strict` turns it into the
update gate (exit 0 pass / 1 fail / 3 incomplete):

```bash
cd C:/Users/USER/orca/projects/piomo-orchestration-source
node custom-layer/check-patches.mjs                # one line per row + summary
node custom-layer/check-patches.mjs --only <name>  # one row
node custom-layer/check-patches.mjs --strict       # + ledger/discovery comparison and a verdict
node custom-layer/check-patches.mjs --strict --json
node --test custom-layer/test/check-patches.test.mjs
```

`stable-500-launcher/` and `memory-overlay/build/` are byte captures of the lane launcher and
of the overlay's build/test inputs, which had no repository. They are for preservation and
review, not for running from here.

The `memory-overlay` row is captured here because its build project has no git repository:
`memory-overlay/omo.js` is a byte copy of the installed overlay bundle, and the two smaller
bundles are stored as `git diff --no-index` output against stock omo-ai 5.1.38. See
`memory-overlay/PROVENANCE.md` for the hashes, PR #10000 and the R21 rebase note.

Run the ledger check before and after every omo/senpi update; the plan's update-time procedure
(`.omo/plans/research-session-freeze-fix.md`) uses it to decide re-apply vs retire.

`plan-review-unlock/` is a managed omo-task anchor delta rather than a separately
loaded extension. It permits explicitly requested plan reviews after execution
while preserving the user-request and plan-file prerequisites. Check it with
`node custom-layer/check-patches.mjs --only plan-review-unlock`; see its README for
the official-update defect probe and retirement rules. Already running
conversations may retain the old task closure until reload/restart.
