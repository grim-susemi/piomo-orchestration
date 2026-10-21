# stable-500 launcher (captured)

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
