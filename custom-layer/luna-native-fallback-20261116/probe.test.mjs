import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const target = process.env.LUNA_GUARD_TARGET;
assert.ok(target, "LUNA_GUARD_TARGET must name the actual guard module");
const guard = await import(`data:text/javascript;base64,${fs.readFileSync(target).toString("base64")}`);
const luna = {
  provider: "chatgpt-subscription",
  model_id: "gpt-6-luna",
  reasoning_effort: "low",
};
const record = {
  task_id: "st_a123",
  model: "anthropic-subscription/claude-sonnet-5-5",
  fallback_models: [luna],
};

test("publication retains the configured Luna low backup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luna-guard-"));
  const original = fs.writeFileSync;
  try {
    fs.mkdirSync(path.join(dir, "tasks"));
    guard.installRecordGuard();
    const file = path.join(dir, "tasks", "st_a123.json");
    fs.writeFileSync(file, JSON.stringify(record));
    assert.deepEqual(JSON.parse(fs.readFileSync(file)).fallback_models, [luna]);
  } finally {
    fs.writeFileSync = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("publication still blocks every backup except exact Luna low", () => {
  const input = { ...record, fallback_models: [
    { ...luna, reasoning_effort: "high" },
    { ...luna, model_id: "gpt-6-luna-fast" },
    { provider: "anthropic-subscription", model_id: "claude-opus-5-5" },
    luna,
  ] };
  assert.deepEqual(JSON.parse(guard.stripRecordFallback(JSON.stringify(input))).fallback_models, [luna]);
});

test("unconfigured records and malformed unrelated data are unchanged", () => {
  for (const text of ['{"task_id":"st_a123","model":"primary"}', "not json", "[]"]) {
    assert.equal(guard.stripRecordFallback(text), text);
  }
});

test("wrong reasoning alone leaves no designated backup", () => {
  const text = JSON.stringify({ ...record, fallback_models: [{ ...luna, reasoning_effort: "high" }] });
  assert.equal(Object.hasOwn(JSON.parse(guard.stripRecordFallback(text)), "fallback_models"), false);
});

// SettingsManager is represented at its public policy boundary. The production
// guard supplies the policy under test, not the fixture.
for (const [name, settings, expected] of [
  ["explicit Luna low", { modelFallback: true, chains: { primary: ["chatgpt-subscription/gpt-6-luna:low"], "*": ["unconfigured/model"] } }, true],
  ["global disabled", { modelFallback: false, chains: { primary: ["chatgpt-subscription/gpt-6-luna:low"] } }, false],
  ["wrong reasoning", { modelFallback: true, chains: { primary: ["chatgpt-subscription/gpt-6-luna:high"] } }, false],
  ["other provider", { modelFallback: true, chains: { primary: ["unconfigured/model"] } }, false],
]) {
  test(`runtime policy preserves designation for ${name}`, () => {
    class Settings {
      getRetryFallbackSettings() { return settings; }
    }
    guard.installSettingsGuard(Settings);
    const actual = new Settings().getRetryFallbackSettings();
    assert.equal(actual.modelFallback, expected);
    if (expected) {
      assert.deepEqual(actual.chains.primary, ["chatgpt-subscription/gpt-6-luna:low"]);
      assert.deepEqual(actual.chains["*"], []);
    }
    assert.equal(guard.installSettingsGuard(Settings), false);
  });
}
