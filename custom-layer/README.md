# custom-layer

Small PiOMO extensions that run on the owner's machine but had no repository of their own. The files are copied byte-for-byte from the installed locations (2026-10-20). Runtime state files such as settings-guard/last-good.json are not included.

| Folder | Installed at | Loaded by |
|---|---|---|
| settings-guard | ~/.omo/agent/settings-guard/extension.mjs | ~/.omo/agent/extensions/omo-settings-guard.js (alert only, owner choice 2026-10-17) |
| task-record-publish-retry | ~/.omo/agent/task-record-publish-retry/extension.mjs | ~/.omo/agent/extensions/omo-task-record-publish-retry.js (owner decision 18=A) |
| task-no-fallback-pkg | ~/.omo/agent/task-no-fallback-pkg/ | settings.json "packages" |
| herdr-agent-sidebar-repair | orca/projects/herdr-agent-sidebar-diagnosis/repair/ | settings.json "extensions" (herdr-senpi.mjs) |
