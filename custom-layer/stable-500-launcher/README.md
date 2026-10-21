# stable-500 launcher (captured)

Reference copies of the files that select the live omo/senpi pair and the memory
overlay generation. Captured 2026-10-21. Before this capture the launcher existed only
in the lane (`docs/current-state.md` listed it as metadata-only).

| Captured here | Live path | sha256 |
| --- | --- | --- |
| `omo.cmd` | `C:/Users/USER/.omo-stable-500/omo.cmd` (wrapper R21) | `3dfa490f26846fa4672478f1401722cd1015098c78bd6edb55c96116efbb6caa` |
| `omo-memory-selector-entry-r21.mjs` | `C:/Users/USER/.omo-stable-500/staging/omo-memory-selector-entry-r21.mjs` (reentry) | `fccd1841b044aa908121c784a536f66fc74ee9535aa162f2731e50b35c6aeff7` |
| `manifest.json` | `C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/manifest.json` | `15177e17f64e9a7f8bdcc5abaf3d8aacfc6a6a39d01bf7894ac4039221d7a177` |

The generation's `gate.mjs` is captured as `../memory-overlay/build/src/gate.mjs`.

Pins in these files: omo-ai `5.1.38`, senpi `2026.10.19` (`OMO_STABLE_PINNED_*` in
`omo.cmd`, `PINNED_*` in the reentry, `omo`/`senpi` in the manifest).
`check-patches.mjs --only stable-500-launcher` compares the live files with these hashes
and checks that all three pins equal the installed global omo-ai, senpi and overlay
package versions. A global package update that leaves these pins behind shows up as
`pin-consistency` drift.

These are copies for preservation and review. Do not run them from this folder and do not
copy them back over the lane: a launcher change is an installation step that needs its
own approval, a new generation and a launch probe in a new process.
