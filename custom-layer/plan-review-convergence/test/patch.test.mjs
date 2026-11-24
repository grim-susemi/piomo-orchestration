import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { patchHost } from "../patch.mjs";
import { DEFAULT_PATHS } from "./helpers/host.mjs";

const EXTENSION = fileURLToPath(new URL("../extension.mjs", import.meta.url));
const HOST = readFileSync(DEFAULT_PATHS.host, "utf8");

test("the managed delta runs after the stock decisions and before Lk returns", () => {
  const patched = patchHost(HOST, EXTENSION);
  assert.match(patched, /import\{gate as __prcGate,handoff as __prcHandoff\}from"file:\/\//u);
  assert.match(
    patched,
    /let __prc=__prcGate\(e,t,n,r\);if\(__prc\)return __prc;let __prcH=__prcHandoff\(e,t,n,r\);if\(__prcH\)return\{kind:"force",prompt:__prcH\};return"deny"===s\?\.kind\?/u,
  );
  assert.equal((patched.match(/function Lk\(e,t,n,r\)\{/gu) ?? []).length, 1);
  assert.equal((patched.match(/__prcGate/gu) ?? []).length, 2);
  assert.equal((patched.match(/__prcHandoff/gu) ?? []).length, 2);
  // The stock gate call still precedes the candidate wrapper: a stock denial never
  // leaves a candidate reservation behind.
  assert.ok(patched.indexOf("Ca(r,e.resolveSkillInvocations") < patched.indexOf("__prcGate(e,t,n,r)"));
});

test("a host without the exact post-gate anchor is refused", () => {
  assert.throws(() => patchHost("function other() {}", EXTENSION), /ANCHOR_COUNT/u);
});
