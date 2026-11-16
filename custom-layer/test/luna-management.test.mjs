import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRows, checkInstalled } from "../check-patches.mjs";
import { baselineHash, hash, transform } from "../luna-native-fallback-20261116/patch.mjs";

const original = fs.readFileSync(fileURLToPath(new URL("../luna-native-fallback-20261116/original.js", import.meta.url)));

test("registered Luna and guard pins accept the installed delta and reject the old blanket block", () => {
  assert.equal(hash(original), baselineHash);
  const candidate = transform(original);
  const rows = makeRows();
  const guard = rows.find(row => row.name === "task-no-fallback-pkg");
  const luna = rows.find(row => row.name === "luna-native-fallback-20261116");
  assert.ok(guard);
  assert.ok(luna);
  const source = guard.sourceBlobs.find(blob => blob.path.endsWith("/omo-task-no-fallback.js"));
  assert.equal(source.expected, hash(candidate));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luna-management-"));
  try {
    const file = path.join(directory, "guard.js");
    for (const row of [guard, luna]) {
      const installed = row.installed.find(entry => entry.path.endsWith("/omo-task-no-fallback.js"));
      fs.writeFileSync(file, original);
      assert.equal(checkInstalled(file, installed.expected).status, "drift");
      fs.writeFileSync(file, candidate);
      assert.equal(checkInstalled(file, installed.expected).status, "ok");
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
