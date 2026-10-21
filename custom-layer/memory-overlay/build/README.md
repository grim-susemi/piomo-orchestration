# memory-overlay build inputs (captured)

Byte copies of the build and test inputs of the R21 memory overlay
(`memory-rollback-5.1.38-r1`), captured 2026-10-21 from
`C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.38`. That project has no `.git`,
so before this capture only the built bundles (`../omo.js` and the two diffs) were in a
repository.

| Captured here | Original path in the build project | sha256 |
| --- | --- | --- |
| `package.json` | `package.json` | `3d19ff44a4d47b617c7b488a4fc243983a153a7438948c3947b4f51f41a09bbc` |
| `MAINTENANCE.md` | `MAINTENANCE.md` | `fd905410537cb9d7c4c3b427de61eac790f04b944ce89bcd969c8c1f0abadef3` |
| `src/bundle-patch.mjs` | `src/bundle-patch.mjs` | `42d676e967c84fcadc751b4fcd161cda8a0ce9f8a054268f65dad1738775cf70` |
| `src/gate.mjs` | `src/gate.mjs` | `5c74e89b8b47f9108d5a974f3b41960ff7c3896d25cc46d8d8663b188a02479c` |
| `src/stage.mjs` | `src/stage.mjs` | `ca0b561ba7b03e1356d17ff0f81407b26c6ad5e21022689606c1ff9892181d5e` |
| `test-captured/launch-probe.mjs` | `test/launch-probe.mjs` | `39d8554ab69e20066342f30fdfdc97ef2aaa46da9fdd81c6d32d92659e402575` |
| `test-captured/live-validate-r21.mjs` | `test/live-validate-r21.mjs` | `f4abaf3c54a79cf77a79fca21f81d58ddfdecba978341e1e0709a86b2bc38e35` |
| `test-captured/memory-fixture.mjs` | `test/memory-fixture.mjs` | `43b3b88f9321ce5fd370465d85d642e490f62051f6d979aa3eafd5df23b75912` |
| `test-captured/native-scenarios.mjs` | `test/native-scenarios.mjs` | `3d862c9017ddaa66a2b9f672c6eb6d2be2d2ad1d6e7419518174c08c8a6c32d0` |
| `test-captured/sdk-probe.mjs` | `test/sdk-probe.mjs` | `53a841ace8e2d688b466499943e304ff28cf677f255d530a50698c2d007440f2` |

`src/gate.mjs` is byte-identical to the live gate
`C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/gate.mjs`.
`NOTICE.md` and `UPSTREAM-LICENSE.md` of the build project are identical to the copies
one directory up and are not duplicated.

## Do not run these from here

The scripts carry absolute paths of the original build project and the live lane.
`test-captured/live-validate-r21.mjs` launches the live `omo.cmd` wrapper at module
top level. The folder is named `test-captured`, not `test`, so a bare `node --test`
(whose default glob includes `**/test/**`) cannot import it by accident.
To rebuild, restore the files into a build project with the original layout
(`test-captured/` back to `test/`), point `SOURCE` in `src/stage.mjs` at the stock
tarball being re-derived, and follow `../PROVENANCE.md` and `MAINTENANCE.md`.
`MAINTENANCE.md` still describes the 5.1.35 rebase; the 5.1.38 (R21) differences are in
`../PROVENANCE.md`.

Not captured: run receipts (`evidence/`, `.work/`, logs) and the install runner in
`C:/Users/USER/.omo-stable-500/staging/upgrade-5.1.38/`. They are evidence, not inputs.
