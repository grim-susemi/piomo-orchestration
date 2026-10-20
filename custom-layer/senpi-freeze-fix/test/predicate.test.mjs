import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { omoFreezeFixUncTimeout } from "../unc-timeout-predicate.mjs";
import { buildTargets } from "../patch.mjs";

const PREDICATE_PATH = fileURLToPath(
  new URL("../unc-timeout-predicate.mjs", import.meta.url)
);
const PREDICATE_TEXT = readFileSync(PREDICATE_PATH, "utf8");

function predicateFor(platform) {
  const context = vm.createContext({ process: { platform } });
  const script = new vm.Script(
    `${PREDICATE_TEXT.replace(/^export /m, "")}\nglobalThis.predicate = omoFreezeFixUncTimeout;`
  );
  script.runInContext(context);
  return context.predicate;
}

const CASES = [
  ["\\\\github.com\\foo", true],
  ["\\\\NAS\\share", true],
  ["\\\\wsl.localhost\\Ubuntu\\home", false],
  ["\\\\WSL$\\Ubuntu", false],
  ["\\\\?\\C:\\x", false],
  ["\\\\.\\pipe\\x", false],
  ["C:\\x", false],
];

for (const [path, expected] of CASES) {
  test(`win32 predicate for ${JSON.stringify(path)} is ${expected}`, () => {
    assert.equal(predicateFor("win32")(path), expected);
  });
}

test("non-win32 predicate rejects every path", () => {
  for (const platform of ["linux", "darwin", "freebsd"]) {
    const predicate = predicateFor(platform);
    assert.equal(predicate("\\\\NAS\\share"), false);
    assert.equal(predicate("\\\\github.com\\foo"), false);
  }
});

test("the imported predicate is the text the patcher embeds", async () => {
  const predicate = predicateFor(process.platform);
  for (const [path, expected] of CASES) {
    assert.equal(
      omoFreezeFixUncTimeout(path),
      predicate(path),
      `imported predicate disagrees with its text for ${JSON.stringify(path)}`
    );
    // On this workstation the imported predicate must also equal the expected value.
    if (process.platform === "win32") {
      assert.equal(omoFreezeFixUncTimeout(path), expected);
    }
  }

  const expectedSource = PREDICATE_TEXT.replace(/^export /m, "").trim();
  const targets = await buildTargets();
  const policy = targets.find((target) =>
    target.file.endsWith("dist/core/tools/filesystem-policy.js")
  );
  assert.ok(policy, "filesystem-policy target is missing");
  assert.ok(
    policy.edits.some((edit) => edit.replacement.includes(expectedSource)),
    "the inserted predicate text differs from unc-timeout-predicate.mjs"
  );
});
