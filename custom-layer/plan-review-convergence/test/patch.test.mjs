import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { patchHost } from "../patch.mjs";
import { DEFAULT_PATHS } from "./helpers/host.mjs";

const EXTENSION = fileURLToPath(new URL("../extension.mjs", import.meta.url));
const HOST = readFileSync(DEFAULT_PATHS.host, "utf8");

test("the managed delta targets exactly one Lk anchor and injects the gate import", () => {
  const patched = patchHost(HOST, EXTENSION);
  assert.match(patched, /import\{gate as __prcGate\}from"file:\/\//u);
  assert.match(patched, /function Lk\(e,t,n,r\)\{let __prc=__prcGate\(e,t,n,r\);if\(__prc\)return __prc;/u);
  assert.equal((patched.match(/function Lk\(e,t,n,r\)\{/gu) ?? []).length, 1);
  assert.equal((patched.match(/__prcGate/gu) ?? []).length, 2);
});

test("a host without the exact Lk anchor is refused", () => {
  assert.throws(() => patchHost("function other() {}", EXTENSION), /ANCHOR_COUNT/u);
});
