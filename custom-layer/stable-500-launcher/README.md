# stable-500 launcher (captured)

**Current (R24, 2026-10-28):** omo-ai 5.1.48 / senpi 2026.10.25-2. `omo.cmd` sha256 `0ee28b70c27696affb8656a9b1f4bee7e799b1f9b4b9e934a498b70ca63fd8ea`, `omo-memory-selector-entry-r24.mjs` `9632e8cb043b740fbaaffa89a873f09b5864c0c3af97b59c7e198e4c9e681f74`, overlay `manifest.json` `f84bdb69ea293b89c5d76bcece05db0e267532208619b05f67fb2d8a29c5e002` (generation `memory-rollback-5.1.48-r1`). The table below is the older R22 record; the r22/r23 entry copies are kept as history.

Reference copies of the files that select the live omo/senpi pair and the memory
overlay generation. Captured 2026-10-21 (R21), re-captured 2026-10-22 after the R22 cutover. Before the first capture the launcher existed only
in the lane (`docs/current-state.md` listed it as metadata-only).

| Captured here | Live path | sha256 |
| --- | --- | --- |
| `omo.cmd` | `C:/Users/USER/.omo-stable-500/omo.cmd` (wrapper R22) | `cb11f16fb763c6e5b66b774dec00451dca0cac4454b2649a1b5339db5fc65fca` |
| `omo-memory-selector-entry-r22.mjs` | `C:/Users/USER/.omo-stable-500/staging/omo-memory-selector-entry-r22.mjs` (reentry) | `7a474fe99574caa78d53c025d59c55b4f1814940f4a4e045153580656a745849` |
| `manifest.json` | `C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.40-r1/manifest.json` | `7a67e6b96c257ea4aad2487a9ddcd25e53b908ba147ab9f6164d5975d346f096` |

The generation's `gate.mjs` is captured as `../memory-overlay/build/src/gate.mjs`.

Pins in these files: omo-ai `5.1.40`, senpi `2026.10.19-2` (`OMO_STABLE_PINNED_*` in
`omo.cmd`, `PINNED_*` in the reentry, `omo`/`senpi` in the manifest).
`check-patches.mjs --only stable-500-launcher` compares the live files with these hashes
and checks that all three pins equal the installed global omo-ai, senpi and overlay
package versions. A global package update that leaves these pins behind shows up as
`pin-consistency` drift.

These are copies for preservation and review. Do not run them from this folder and do not
copy them back over the lane: a launcher change is an installation step that needs its
own approval, a new generation and a launch probe in a new process.
