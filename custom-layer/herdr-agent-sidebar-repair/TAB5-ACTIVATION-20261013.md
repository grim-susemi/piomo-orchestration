# Tab 5 live activation

## Approved change

The owner requested "고치자" after the repair and its non-activation were explained.
The upstream installation and launcher remain unchanged.

The only live configuration change is an `extensions` entry in:

`C:/Users/USER/.omo-stable-500/home/.omo/agent/settings.json`

It points directly to the already validated entry:

`C:/Users/USER/orca/projects/herdr-agent-sidebar-diagnosis/repair/herdr-senpi.mjs`

The entry is not copied or wrapped, so its self-path exclusion remains valid.
Other extension settings and the selected model are not changed.
Removing this one array entry reverses the configuration change.

## Current target

- Tab label: 5; tab ID: `w1:t48`; owner pane: `w1:pFM`.
- Session ID: `01a133df-010e-7194-a96a-82a3659fa27b`.
- Session file:
  `C:/Users/USER/.omo-stable-500/home/.omo/agent/sessions/--C--Users-USER-orca-projects-기타 작업--/2026-10-13T06-06-55-246Z_01a133df-010e-7194-a96a-82a3659fa27b.jsonl`.
- Existing host: Node PID 72780, shell PID 82848.

The target was working during preparation. No quit, process restart, input,
external registration, or Herdr daemon restart was performed. The installed
config-reload extension waits for `ctx.isIdle()` and no pending messages, and
checks extension reload vetoes before requesting the normal host reload.
Other sessions sharing this profile can load the repair at their own idle edges.

## Checks

Current installed versions match the prior actual-host verification:
OMO 5.1.32, Senpi 2026.10.12, Herdr 0.9.3.

The unchanged repair passed `node --check` and its four focused regression tests
in one run, exit code 0.

The actual-host regression suite was also rerun against the current installed
Node/CLI/plugin and actual Herdr server. Its two tests passed, exit code 0:
stock registration disappeared after native Pi exit; the repaired registration
survived native Pi exit, state changes, reload, session replacement and cold resume.
Quit and stock rollback also passed. The test's former fixed owner pane was
parameterized with `HERDR_QA_OWNER_PANE`, retaining its identity assertion and
original default. No behavioral assertion was removed or weakened.

The run owned no-focus tab `w1:t4M` and panes `w1:pJG`, `w1:pJH`, `w1:pJJ`,
`w1:pJK`, `w1:pJM`. After the tests, only the empty owned tab was closed.
An official pane-list query confirmed all five owned panes absent.

A read-only official Herdr socket event subscription was acknowledged before
the settings edit. Its first five-minute watch expired while the target remained
busy; a new one-hour event subscription is acknowledged and waiting for this
pane to register as `senpi`.
The first monitor launch failed due to command-line quoting; the replacement
uses an encoded script and confirmed `TAB5_WATCH_READY`.

## Live result

Status: configuration connected; remaining live verification paused at the
owner's request: "오케 그냥 문제 또 있으면 다시 부를게".
This is not a claim that tab 5 has recovered.

This repair conversation (`w1:pJ9`) automatically reloaded at 13:51:54 UTC and
registered as `senpi`. This establishes that the global profile entry loads,
but is not evidence that tab 5 has loaded it. Tab 5 still had no agent registration
at the post-test cleanup snapshot; its original conversation was not interrupted.

The registration monitor was stopped. The official `/goal pause` command was
issued only in this repair conversation, and `get_goal` confirmed `paused`.
The applied configuration and all verification evidence are preserved.
No further automatic verification or owner-session restart is scheduled.
