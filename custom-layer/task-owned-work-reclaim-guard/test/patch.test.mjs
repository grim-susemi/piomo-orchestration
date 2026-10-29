import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import {
  BASELINE_SHA256, EDITS, FILE, VERSION, classifyText, transformText, sha256,
  decideUpdate, main,
} from "../patch.mjs";
import { createFixture, evaluateText, extractLifecycle } from "../probe.mjs";

const qualification = JSON.parse(await readFile(new URL("../qualification.json", import.meta.url), "utf8"));
// These are read-only inputs. All transformations and lifecycle invocations use isolated VM copies.
const originalBytes = await readFile(join(qualification.omoRoot, FILE));
const original = originalBytes.toString("utf8");
const patched = transformText(original);

test("the read-only baseline and six exact anchors are qualified", () => {
  assert.equal(sha256(originalBytes), BASELINE_SHA256);
  assert.equal(classifyText(original), "pristine");
  assert.equal(EDITS.length, 6);
  assert.equal(classifyText(patched), "patched");
  new vm.Script(extractLifecycle(patched));
  console.log(`CANDIDATE_TARGET ${JSON.stringify({
    beforeSha256: sha256(originalBytes),
    afterSha256: sha256(patched),
    beforeBytes: originalBytes.length,
    afterBytes: Buffer.byteLength(patched),
    inverseSha256: sha256(transformText(patched, "remove")),
  })}`);
});

test("the actual baseline lifecycle reproduces owned-work loss", async () => {
  const result = await evaluateText(original);
  assert.equal(result.verdict, "defect-present", JSON.stringify(result));
  assert.equal(result.checks.liveBackground, false);
  assert.equal(result.checks.monitorOnly, false);
  assert.equal(result.checks.ordinaryIdleReclaims, true);
  assert.equal(result.checks.explicitCancelPreserved, true);
});

test("the extracted patched lifecycle passes every ownership and control case", async () => {
  const result = await evaluateText(patched);
  assert.equal(result.verdict, "defect-absent", JSON.stringify(result));
  assert.equal(Object.keys(result.checks).length, 14);
  for (const [name, passed] of Object.entries(result.checks)) assert.equal(passed, true, name);
});

test("work spans multiple virtual sweep periods without losing its handle", async () => {
  const f = createFixture(patched);
  f.reset({ busyBackground: 1, busyMonitors: 2 });
  const handle = f.state.registry.get("st_fixture");
  for (let period = 0; period < 4; period += 1) {
    f.advance(900000);
    assert.equal((await f.idle()).length, 0);
    assert.equal(f.state.registry.get("st_fixture"), handle);
  }
  f.owned(0, 1);
  assert.equal((await f.idle()).length, 0);
  f.owned(0, 0);
  assert.deepEqual(Array.from(await f.idle()), ["st_fixture"]);
  assert.equal(f.state.registry.get("st_fixture"), undefined);
});

test("claim-time races do not report a freed capacity slot", async () => {
  const f = createFixture(patched);
  f.reset();
  f.claim(() => f.owned(1, 0));
  const result = await f.capacity();
  assert.equal(result.kind, "rejected");
  assert.equal(f.records.get("st_fixture").residency_state, "resident");
  assert.equal(f.trace.filter(([event]) => event === "release-claim").length, 1);
  assert.equal(f.trace.some(([event]) => event === "dispose"), false);
});

test("pending sends retain their existing protection on automatic and explicit park", async () => {
  const f = createFixture(patched);
  f.reset();
  f.state.registry.hasInFlightSends = () => true;
  f.advance(900001);
  assert.equal((await f.idle()).length, 0);
  assert.equal((await f.capacity()).kind, "rejected");
  assert.equal(await f.cancelPark(), false);
  assert.equal(f.trace.some(([event]) => event === "dispose"), false);
});

test("explicit cancel and shutdown remain able to close busy owned work", async () => {
  for (const entry of ["cancel", "cancelPark", "shutdown"]) {
    const f = createFixture(patched);
    f.reset({ busyBackground: 1, busyMonitors: 1 });
    await f[entry]();
    assert.equal(f.trace.some(([event, reason]) => event === "shutdown" && reason === "quit"), true, entry);
    assert.equal(f.trace.some(([event]) => event === "dispose"), true, entry);
  }
});

test("the exact inverse preserves every unrelated byte", () => {
  assert.equal(transformText(patched, "remove"), original);
  const wrapped = `// unrelated CRLF\r\n${original}\r\n// tail\r\n`;
  assert.equal(transformText(transformText(wrapped), "remove"), wrapped);
});

test("partial, duplicated and missing anchors refuse transformation", () => {
  for (const text of [
    original.replace(EDITS[0].anchor, EDITS[0].replacement),
    `${original}\n${EDITS[1].anchor}`,
    original.replace(EDITS[2].anchor, "function unknown(){}"),
  ]) {
    assert.equal(classifyText(text), "unknown");
    assert.throws(() => transformText(text), { kind: "anchor" });
  }
  assert.throws(() => transformText(patched), { kind: "anchor" });
  assert.throws(() => transformText(original, "bad"), { kind: "argument" });
});

test("update check distinguishes reapply, keep, rederive and unresolved drift", async () => {
  const baselineProbe = await evaluateText(original);
  const patchedProbe = await evaluateText(patched);
  const decide = (text, version, probe) => decideUpdate({ text, version, probe }).action;
  assert.equal(decide(original, VERSION, baselineProbe), "reapply");
  assert.equal(decide(patched, VERSION, patchedProbe), "keep");
  assert.equal(decide(original, "5.1.41", baselineProbe), "rederive");
  assert.equal(decide(`${original}\n// other change`, VERSION, baselineProbe), "rederive");
  assert.equal(decide(`${patched}\n// other change`, VERSION, patchedProbe), "needs-review");
  assert.equal(decide("unknown source", "5.1.41", await evaluateText("unknown source")), "needs-review");
});

test("retirement requires independent fixed behavior without our exact fragments", async () => {
  // Equivalent upstream implementation, not our exact delta or a version-label assertion.
  const upstream = patched
    .replace("isSessionBusy:()=>t.isSessionBusy", "isSessionBusy:()=>!!t.isSessionBusy")
    .replace("isSessionBusy:()=>e.isSessionBusy()", "isSessionBusy:()=>!!e.isSessionBusy()")
    .replace("function yZ(e,t,n=!0)", "function yZ(e,t,n=true)")
    .replace('if("evict"===n&&!i)return!1;', 'if("evict"===n&&!i)return false;')
    .replace(':!1===await LJ(e,i.task_id,"evict")', ':false===await LJ(e,i.task_id,"evict")')
    .replace("yZ(e,t,!1))return!1;let i=", "yZ(e,t,false))return!1;let i=");
  assert.equal(EDITS.some((edit) => upstream.includes(edit.replacement)), false);
  const result = await evaluateText(upstream);
  assert.equal(result.verdict, "defect-absent", JSON.stringify(result));
  assert.equal(decideUpdate({ text: upstream, version: "5.1.41", probe: result }).action, "retire");
});

test("a passing partial candidate is not mistaken for an official fix", async () => {
  const partial = patched.replace("function yZ(e,t,n=!0)", "function yZ(e,t,n=true)");
  const result = await evaluateText(partial);
  assert.equal(result.verdict, "defect-absent");
  assert.equal(decideUpdate({ text: partial, version: VERSION, probe: result }).action, "needs-review");
});

test("a defect-present partial candidate requires review rather than rederivation", async () => {
  const partial = original.replace(EDITS[0].anchor, EDITS[0].replacement);
  const result = await evaluateText(partial);
  assert.equal(result.verdict, "defect-present");
  assert.equal(decideUpdate({ text: partial, version: VERSION, probe: result }).action, "needs-review");
});

test("a swallowed busy-path exception is not accepted as ownership protection", async () => {
  const broken = patched.replace(
    "||n&&e.registry.get(t)?.isSessionBusy?.()===!0",
    '||n&&(()=>{if(e.registry.get(t)?.isSessionBusy?.())throw Error("broken busy path");return!1})()',
  );
  const result = await evaluateText(broken);
  assert.match(result.checks.liveBackground.error, /broken busy path/);
  assert.equal(result.verdict, "needs-review");
});

test("an unrelated scenario error takes priority over reproduced original defects", async () => {
  const mixed = original.replace(
    'if("evict"!==n||i)try{',
    'if("evict"===n&&!i)throw Error("unrelated claim failure");if("evict"!==n||i)try{',
  );
  const result = await evaluateText(mixed);
  for (const name of ["ordinaryIdleReclaims", "capacityIdleEvicts", "explicitCancelPreserved",
    "explicitCancelParkPreserved", "shutdownPreserved"]) assert.equal(result.checks[name], true, name);
  for (const name of ["liveBackground", "monitorOnly", "automaticParkGuard"]) {
    assert.equal(result.checks[name], false, name);
  }
  assert.match(result.checks.capacityClaimRefused.error, /unrelated claim failure/);
  assert.equal(result.verdict, "needs-review");
});

test("checkTree is read-only and the CLI has no apply operation", async () => {
  const result = await main(["--omo-root", qualification.omoRoot, "--check"]);
  assert.equal(result.action, "reapply");
  await assert.rejects(main(["--omo-root", qualification.omoRoot, "--apply"]), { kind: "argument" });
  const after = await readFile(join(qualification.omoRoot, FILE));
  assert.equal(sha256(after), BASELINE_SHA256);
  assert.equal(after.equals(originalBytes), true);
});
