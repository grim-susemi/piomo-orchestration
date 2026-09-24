#!/usr/bin/env node
/**
 * engine-bridge identity test: recreated-host same-session inputId uniqueness.
 *
 * Deterministic restart simulation: two freshly constructed AgentSession hosts of the
 * SAME session (counter reset, same sessionId) run _runInputHandlers. The contract:
 *   - a recreated host must never regenerate an inputId that an earlier host lifetime
 *     already used (the slot-4 journal keys consumed inputs by inputId and never prunes),
 *   - the identity stays the exact same string across the input event and the later
 *     input_disposition (handled path emits it from the same variable),
 *   - the per-host token is initialized once and reused for every input of that host,
 *     so ids are not lost between input and disposition via a process-global map.
 * Token generation is injected per surface (randomUUID / the bundle's node:crypto alias),
 * so the whole test is deterministic - no wall clock, no real randomness.
 * The base copies are run through the same fixture and must reproduce the collision.
 *
 * Run after the builder: node build-transform.mjs && node inputid-identity.test.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, countOccurrences, extractMethod, loadStaged, methodFunction } from "./lib.mjs";

const LANE_DIR = dirname(fileURLToPath(import.meta.url));
const STAGE_ROOT = resolve(LANE_DIR, "..", "..", "..");

const SESSION_ID = "session-x";
const HANDLED = "handled";

const SURFACES = [
  {
    name: "unbundled dist/core/agent-session.js",
    relpath: "dist/core/agent-session.js",
    tokenFn: "randomUUID",
    marker: "this._inputHostToken ??= randomUUID()",
  },
  {
    name: "bundled-main dist/bundle/chunks/chunk-RRSND33J.js",
    relpath: "dist/bundle/chunks/chunk-RRSND33J.js",
    tokenFn: "randomUUID11",
    marker: "this._inputHostToken ??= randomUUID11()",
  },
  {
    name: "bundled-worker dist/bundle/chunks/session-worker.js",
    relpath: "dist/bundle/chunks/session-worker.js",
    tokenFn: "randomUUID16",
    marker: "this._inputHostToken ??= randomUUID16()",
  },
];

function makeTokenSequence(...values) {
  let index = 0;
  return () => {
    assert(index < values.length, "token generator stub exhausted - the code under test called it more often than expected");
    const value = values[index];
    index += 1;
    return value;
  };
}

function makeHost({ sessionId = SESSION_ID, token, emitResult } = {}) {
  const calls = { emitted: [], disposed: [] };
  const host = {
    sessionManager: { getSessionId: () => sessionId },
    _nextInputId: 0,
    _extensionRunner: {
      hasHandlers: (name) => name === "input",
      emitInput: async (text, images, source, streamingBehavior, inputId) => {
        calls.emitted.push({ text, images, source, streamingBehavior, inputId });
        return emitResult ?? { action: "continue" };
      },
    },
    _emitInputDisposition: async (inputId, disposition) => {
      calls.disposed.push({ inputId, disposition });
    },
    calls,
  };
  if (token !== undefined) host._inputHostToken = token;
  return host;
}

async function runInput(runInputHandlers, host, { source = "interactive", text = "hello" } = {}) {
  return runInputHandlers.call(host, text, undefined, source, undefined);
}

function assertStagedPair(pair, label) {
  assert(
    pair.a.inputId !== pair.b.inputId,
    `${label}: recreated host regenerated inputId ${JSON.stringify(pair.b.inputId)} already used by the earlier host lifetime`,
  );
}

async function checkBaseCollision(surface, baseText) {
  const label = `${surface.name} base`;
  assert(countOccurrences(baseText, "this._inputHostToken") === 0, `${label}: base unexpectedly contains the identity token`);
  const baseFn = methodFunction(extractMethod(baseText, "async _runInputHandlers(", label), "async _runInputHandlers(");
  const hostE = makeHost();
  const hostF = makeHost();
  const e = await runInput(baseFn, hostE);
  const f = await runInput(baseFn, hostF);
  assert(e.inputId === `${SESSION_ID}:1` && f.inputId === `${SESSION_ID}:1`, `${label}: ids ${JSON.stringify([e.inputId, f.inputId])} expected the raw session:counter form`);
  assert(e.inputId === f.inputId, `${label}: base must reproduce the restart collision`);
  assert(new Set([e.inputId, f.inputId]).size === 1, `${label}: base journal key collides by construction`);
  let failed = false;
  try {
    assertStagedPair({ a: e, b: f }, label);
  } catch (error) {
    failed = true;
    assert(String(error.message).includes("regenerated inputId"), `${label}: base negative control failed unexpectedly: ${error.message}`);
  }
  assert(failed, `${label}: base passed the uniqueness check, so the test would not prove the fix`);
}

async function main() {
  const { staged, base } = loadStaged(STAGE_ROOT, LANE_DIR);
  let stagedChecks = 0;
  let baseCollisionControls = 0;

  if (process.argv.includes("--red-control")) {
    let baseSurfacesCollided = 0;
    for (const surface of SURFACES) {
      await checkBaseCollision(surface, base.get(surface.relpath));
      baseSurfacesCollided += 1;
    }
    console.log(JSON.stringify({ test: "inputid-identity", mode: "red-control", baseSurfacesCollided, status: "expected-red" }));
    return;
  }

  for (const surface of SURFACES) {
    const stagedText = staged.get(surface.relpath);
    const label = surface.name;

    // structural: both identity generation sites (queued handler path + prompt path) converted
    assert(
      countOccurrences(stagedText, surface.marker) === 2,
      `${label}: expected 2 identity sites carrying ${surface.marker}`,
    );
    stagedChecks += 1;

    // deterministic restart pair: two hosts, same session, fresh counters, injected tokens
    const restartFn = methodFunction(
      extractMethod(stagedText, "async _runInputHandlers(", `${label} staged`),
      "async _runInputHandlers(",
      { [surface.tokenFn]: makeTokenSequence("host-token-1", "host-token-2") },
    );
    const hostA = makeHost();
    const hostB = makeHost();
    const a = await runInput(restartFn, hostA);
    const b = await runInput(restartFn, hostB);
    assert(a.inputId === `${SESSION_ID}:1:host-token-1`, `${label}: host A first inputId ${JSON.stringify(a.inputId)}`);
    assert(b.inputId === `${SESSION_ID}:1:host-token-2`, `${label}: host B first inputId ${JSON.stringify(b.inputId)}`);
    assertStagedPair({ a, b }, label);
    assert(hostA.calls.emitted[0].inputId === a.inputId, `${label}: host A input event id drift`);
    assert(hostB.calls.emitted[0].inputId === b.inputId, `${label}: host B input event id drift`);
    assert(hostA._inputHostToken === "host-token-1", `${label}: host A token must initialize once from the generator`);
    assert(hostB._inputHostToken === "host-token-2", `${label}: host B token must initialize once from the generator`);
    const journal = new Set([a.inputId, b.inputId]);
    assert(journal.size === 2, `${label}: never-pruned journal would collide across host recreation`);
    stagedChecks += 6;

    // same host, later input: counter still isolates inputs and the token is reused, not regenerated
    const a2 = await runInput(restartFn, hostA);
    assert(a2.inputId === `${SESSION_ID}:2:host-token-1`, `${label}: host A second inputId ${JSON.stringify(a2.inputId)}`);
    assert(a2.inputId !== a.inputId, `${label}: host A counter must isolate later inputs`);
    assert(hostA._inputHostToken === "host-token-1", `${label}: host A token must not be regenerated per input`);
    stagedChecks += 3;

    // handled path: the engine-emitted disposition carries the exact same identity string
    const handledFn = methodFunction(
      extractMethod(stagedText, "async _runInputHandlers(", `${label} staged handled`),
      "async _runInputHandlers(",
      { [surface.tokenFn]: makeTokenSequence("host-token-3") },
    );
    const hostC = makeHost({ emitResult: { action: HANDLED } });
    const handledResult = await runInput(handledFn, hostC, { source: "rpc" });
    assert(handledResult === undefined, `${label}: handled input must return undefined`);
    assert(hostC.calls.emitted.length === 1 && hostC.calls.disposed.length === 1, `${label}: handled path event counts`);
    assert(
      hostC.calls.disposed[0].inputId === hostC.calls.emitted[0].inputId,
      `${label}: input_disposition identity ${JSON.stringify(hostC.calls.disposed[0].inputId)} != input identity ${JSON.stringify(hostC.calls.emitted[0].inputId)}`,
    );
    assert(hostC.calls.disposed[0].inputId === `${SESSION_ID}:1:host-token-3`, `${label}: handled disposition id ${JSON.stringify(hostC.calls.disposed[0].inputId)}`);
    assert(hostC.calls.disposed[0].disposition === HANDLED, `${label}: disposition ${JSON.stringify(hostC.calls.disposed[0].disposition)}`);
    assert(hostC.calls.emitted[0].source === "rpc", `${label}: source passthrough drift`);
    stagedChecks += 5;

    // seeded token: an already-initialized host never calls the generator (token is instance state)
    const seededFn = methodFunction(
      extractMethod(stagedText, "async _runInputHandlers(", `${label} staged seeded`),
      "async _runInputHandlers(",
      { [surface.tokenFn]: makeTokenSequence() },
    );
    const hostD = makeHost({ token: "seed-token" });
    const d = await runInput(seededFn, hostD);
    assert(d.inputId === `${SESSION_ID}:1:seed-token`, `${label}: seeded token id ${JSON.stringify(d.inputId)}`);
    stagedChecks += 1;

    // base negative control: the audited collision must reproduce deterministically
    await checkBaseCollision(surface, base.get(surface.relpath));
    baseCollisionControls += 1;
    stagedChecks += 2;
  }

  console.log(
    JSON.stringify({
      test: "inputid-identity",
      sessionId: SESSION_ID,
      stagedChecks,
      baseCollisionControls,
      surfaces: SURFACES.map((surface) => surface.name),
      status: "ok",
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(`FAIL inputid-identity: ${error?.stack ?? error}`);
  process.exit(1);
}
