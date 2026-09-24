#!/usr/bin/env node
/**
 * tool-effect-lifecycle test: the single registered-tool effect lifecycle.
 *
 * Exercises the REAL shipped dispatch (extracted from the pinned artifacts) end to end:
 *   runner.emitToolCall (real blocker) -> wrapper.execute (real) ->
 *   runner.emitToolEffectBefore / emitToolEffectSettled (real) -> fixture definition.
 * Surfaces: unbundled (runner.js + wrapper.js), bundled main (chunk-RRSND33J.js),
 * bundled worker (session-worker.js).
 *
 * Contract cases (see EVENT-CONTRACT.md):
 *   - successful read          => one before + one settled(ok:true,isError:false), order before/execute/settled
 *   - resolved tool error       => settled(ok:true,isError:true)
 *   - actual failed read        => settled(ok:false,error) and the SAME error is rethrown
 *   - later blocker returns     => zero before/effects, definition never called
 *   - later blocker throws      => zero before/effects
 *   - scheduler/preflight skip  => zero before/effects
 *   - reservation failure       => synchronous non-swallowed throw, zero execute, zero settled
 *   - async before handler      => contract violation, zero execute, zero settled
 *   - synthetic abort pending   => no premature settle; settles only when the promise does
 *   - two extensions            => exactly one before/settled emission, registration order
 *
 * Run after the builder: node build-transform.mjs && node tool-effect-lifecycle.test.mjs
 * (`--red-control` asserts the pre-patch base surfaces carry no lifecycle.)
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, countOccurrences, extractMethod, functionFromSource, loadStaged, methodFunction } from "./lib.mjs";

const LANE_DIR = dirname(fileURLToPath(import.meta.url));
const STAGE_ROOT = resolve(LANE_DIR, "..", "..", "..");

const SURFACES = [
  {
    name: "unbundled",
    runnerRel: "dist/core/extensions/runner.js",
    wrapperRel: "dist/core/extensions/wrapper.js",
    emitToolCallSig: "async emitToolCall(event) {",
    beforeSig: "emitToolEffectBefore(event) {",
    settledSig: "async emitToolEffectSettled(event) {",
    wrapperSig: "export function wrapRegisteredTool(registeredTool, runner, createToolContext) {",
  },
  {
    name: "bundled-main",
    runnerRel: "dist/bundle/chunks/chunk-RRSND33J.js",
    wrapperRel: "dist/bundle/chunks/chunk-RRSND33J.js",
    emitToolCallSig: "async emitToolCall(event){",
    beforeSig: "emitToolEffectBefore(event){",
    settledSig: "async emitToolEffectSettled(event){",
    wrapperSig: "function wrapRegisteredTool(registeredTool,runner,createToolContext){",
  },
  {
    name: "bundled-worker",
    runnerRel: "dist/bundle/chunks/session-worker.js",
    wrapperRel: "dist/bundle/chunks/session-worker.js",
    emitToolCallSig: "async emitToolCall(event){",
    beforeSig: "emitToolEffectBefore(event){",
    settledSig: "async emitToolEffectSettled(event){",
    wrapperSig: "function wrapRegisteredTool(registeredTool,runner,createToolContext){",
  },
];

function makeExtension(path, handlersByType) {
  return { path, handlers: new Map(Object.entries(handlersByType)) };
}

function makeRegisteredTool(name, execute) {
  return { definition: { name, label: name, execute }, sourceInfo: { path: "fixture" } };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function makeRunner(runnerSource, surface) {
  const errors = [];
  const runner = {
    extensions: [],
    errors,
    createContext: (extensionPath) => ({ extensionPath }),
    emitError: (error) => errors.push(error),
    getActiveTools: () => [],
    beginToolHookRun: () => ({ context: {}, end: () => {} }),
  };
  runner.emitToolEffectBefore = methodFunction(extractMethod(runnerSource, surface.beforeSig, `${surface.name} emitToolEffectBefore`), surface.beforeSig);
  runner.emitToolEffectSettled = methodFunction(extractMethod(runnerSource, surface.settledSig, `${surface.name} emitToolEffectSettled`), surface.settledSig);
  runner.emitToolCall = methodFunction(extractMethod(runnerSource, surface.emitToolCallSig, `${surface.name} emitToolCall`), surface.emitToolCallSig);
  return runner;
}

function makeWrapper(wrapperSource, surface) {
  return functionFromSource(
    extractMethod(wrapperSource, surface.wrapperSig, `${surface.name} wrapRegisteredTool`),
    { wrapToolDefinition: (definition) => ({ name: definition.name, label: definition.label }) },
  );
}

function environment(surface, staged, { before = [], settled = [], toolCall = [] } = {}) {
  const runner = makeRunner(staged.get(surface.runnerRel), surface);
  runner.extensions.push(makeExtension("fixture", { tool_effect_before: before, tool_effect_settled: settled, tool_call: toolCall }));
  const wrap = makeWrapper(staged.get(surface.wrapperRel), surface);
  return { runner, wrap };
}

/** Mirrors AgentSession.beforeToolCall -> tool.execute: a block returns before execute, a thrown blocker propagates. */
async function engineInvoke({ runner, wrapped, toolCallId, toolName, params, signal, onUpdate, skip = false }) {
  const preflight = await runner.emitToolCall({ type: "tool_call", toolName, toolCallId, input: params });
  if (preflight?.block) return { outcome: "blocked", reason: preflight.reason };
  if (skip) return { outcome: "skipped" };
  return { outcome: "executed", result: await wrapped.execute(toolCallId, params, signal, onUpdate) };
}

const PARAMS = { file_path: "plan.md" };

async function caseSuccess(surface, staged) {
  const log = [];
  const events = [];
  const execCalls = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [(event) => {
      events.push({ phase: "before", type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, input: event.input });
      log.push("before");
    }],
    settled: [async (event) => {
      await Promise.resolve();
      events.push({ phase: "settled", type: event.type, toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, ok: event.ok, isError: event.isError, error: event.error });
      log.push("settled");
    }],
    toolCall: [() => ({ block: false })],
  });
  const tool = makeRegisteredTool("read", async (id, args) => {
    log.push("execute");
    execCalls.push({ id, args });
    return { content: [{ type: "text", text: "ok" }], isError: false };
  });
  const invocation = await engineInvoke({ runner, wrapped: wrap(tool, runner, undefined), toolCallId: "call-1", toolName: "read", params: PARAMS });
  assert(invocation.outcome === "executed", `${surface.name} success: non-blocking tool_call result must not veto (outcome ${invocation.outcome})`);
  assert(log.join(",") === "before,execute,settled", `${surface.name} success: ordering ${log.join(",")}`);
  assert(events.length === 2, `${surface.name} success: expected exactly one before and one settled, saw ${events.length}`);
  assert(events[0].type === "tool_effect_before" && events[1].type === "tool_effect_settled", `${surface.name} success: event types`);
  assert(events.every((event) => event.toolCallId === "call-1" && event.toolName === "read" && event.input === PARAMS), `${surface.name} success: settled must correlate id/toolName/input`);
  assert(events[1].ok === true && events[1].isError === false && events[1].error === undefined, `${surface.name} success: settled outcome ${JSON.stringify(events[1])}`);
  assert(execCalls.length === 1 && execCalls[0].id === "call-1" && execCalls[0].args === PARAMS, `${surface.name} success: definition must execute once with the same args`);
  assert(runner.errors.length === 0, `${surface.name} success: unexpected extension errors ${JSON.stringify(runner.errors)}`);
}

async function caseToolErrorResult(surface, staged) {
  const events = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [(event) => events.push({ phase: "before", id: event.toolCallId })],
    settled: [(event) => events.push({ phase: "settled", id: event.toolCallId, ok: event.ok, isError: event.isError, error: event.error })],
  });
  const tool = makeRegisteredTool("read", async () => ({ content: [{ type: "text", text: "missing" }], isError: true }));
  const invocation = await engineInvoke({ runner, wrapped: wrap(tool, runner, undefined), toolCallId: "call-2", toolName: "read", params: PARAMS });
  assert(invocation.outcome === "executed" && invocation.result.isError === true, `${surface.name} tool-error: result passthrough`);
  assert(events.length === 2, `${surface.name} tool-error: exactly one lifecycle pair`);
  assert(events[1].ok === true && events[1].isError === true, `${surface.name} tool-error: settled ${JSON.stringify(events[1])}`);
}

async function caseThrownFailure(surface, staged) {
  const events = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [(event) => events.push({ phase: "before", id: event.toolCallId })],
    settled: [(event) => events.push({ phase: "settled", id: event.toolCallId, ok: event.ok, isError: event.isError, error: event.error })],
  });
  const tool = makeRegisteredTool("read", async () => { throw new Error("read failed"); });
  let thrown;
  try {
    await engineInvoke({ runner, wrapped: wrap(tool, runner, undefined), toolCallId: "call-3", toolName: "read", params: PARAMS });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.message === "read failed", `${surface.name} thrown: the original error must be rethrown, saw ${thrown?.message}`);
  assert(events.length === 2, `${surface.name} thrown: exactly one lifecycle pair, saw ${events.length}`);
  assert(events[1].ok === false && events[1].error === "read failed" && events[1].isError === undefined, `${surface.name} thrown: settled ${JSON.stringify(events[1])}`);
}

async function caseBlockerReturns(surface, staged) {
  const events = [];
  const execCalls = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [() => events.push("before")],
    settled: [() => events.push("settled")],
    toolCall: [() => ({ block: true, reason: "gate" })],
  });
  const tool = makeRegisteredTool("read", async () => { execCalls.push(1); return { content: [] }; });
  const invocation = await engineInvoke({ runner, wrapped: wrap(tool, runner, undefined), toolCallId: "call-4", toolName: "read", params: PARAMS });
  assert(invocation.outcome === "blocked" && invocation.reason === "gate", `${surface.name} blocker: outcome ${JSON.stringify(invocation)}`);
  assert(events.length === 0 && execCalls.length === 0, `${surface.name} blocker: a blocked call must emit zero before/effects`);
}

async function caseBlockerThrows(surface, staged) {
  const events = [];
  const execCalls = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [() => events.push("before")],
    settled: [() => events.push("settled")],
    toolCall: [() => { throw new Error("preflight boom"); }],
  });
  const tool = makeRegisteredTool("read", async () => { execCalls.push(1); return { content: [] }; });
  let thrown;
  try {
    await engineInvoke({ runner, wrapped: wrap(tool, runner, undefined), toolCallId: "call-5", toolName: "read", params: PARAMS });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.message === "preflight boom", `${surface.name} blocker-throw: error must propagate, saw ${thrown?.message}`);
  assert(events.length === 0 && execCalls.length === 0, `${surface.name} blocker-throw: zero before/effects`);
}

async function caseSkip(surface, staged) {
  const events = [];
  const execCalls = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [() => events.push("before")],
    settled: [() => events.push("settled")],
  });
  const tool = makeRegisteredTool("read", async () => { execCalls.push(1); return { content: [] }; });
  const invocation = await engineInvoke({ runner, wrapped: wrap(tool, runner, undefined), toolCallId: "call-6", toolName: "read", params: PARAMS, skip: true });
  assert(invocation.outcome === "skipped", `${surface.name} skip: outcome ${JSON.stringify(invocation)}`);
  assert(events.length === 0 && execCalls.length === 0, `${surface.name} skip: a scheduler-skipped call must emit zero before/effects`);
}

async function caseReservationFailure(surface, staged) {
  const log = [];
  const execCalls = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [() => { log.push("before-attempt"); throw new Error("reserve failed"); }],
    settled: [() => log.push("settled")],
  });
  const tool = makeRegisteredTool("read", async () => { execCalls.push(1); return { content: [] }; });
  let thrown;
  try {
    await wrap(tool, runner, undefined).execute("call-7", PARAMS, undefined, undefined);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.message === "reserve failed", `${surface.name} reserve: the synchronous error must be non-swallowed, saw ${thrown?.message}`);
  assert(execCalls.length === 0, `${surface.name} reserve: definition must not execute`);
  assert(log.join(",") === "before-attempt", `${surface.name} reserve: zero effect after failure, log ${log.join(",")}`);
  assert(runner.errors.length === 0, `${surface.name} reserve: before errors must not be swallowed into the extension error channel`);
}

async function caseAsyncBeforeViolation(surface, staged) {
  const execCalls = [];
  const settled = [];
  const { runner, wrap } = environment(surface, staged, {
    before: [async () => {}],
    settled: [() => settled.push("settled")],
  });
  const tool = makeRegisteredTool("read", async () => { execCalls.push(1); return { content: [] }; });
  let thrown;
  try {
    await wrap(tool, runner, undefined).execute("call-8", PARAMS, undefined, undefined);
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && /must be synchronous/.test(thrown.message), `${surface.name} async-before: expected sync contract violation, saw ${thrown?.message}`);
  assert(execCalls.length === 0 && settled.length === 0, `${surface.name} async-before: zero execute, zero settled`);
}

async function caseAbortPending(surface, staged) {
  const settled = [];
  const before = [];
  const gate = deferred();
  const { runner, wrap } = environment(surface, staged, {
    before: [(event) => before.push(event.toolCallId)],
    settled: [(event) => settled.push({ ok: event.ok, error: event.error })],
  });
  const tool = makeRegisteredTool("read", () => gate.promise);
  const wrapped = wrap(tool, runner, undefined);
  const controller = new AbortController();
  const pending = wrapped.execute("call-9", PARAMS, controller.signal, undefined);
  assert(before.length === 1 && settled.length === 0, `${surface.name} abort-pending: before must fire before the definition promise`);
  controller.abort();
  assert(settled.length === 0, `${surface.name} abort-pending: a synthetic abort must not settle early`);
  gate.resolve({ content: [{ type: "text", text: "late ok" }], isError: false });
  const result = await pending;
  assert(result.content[0].text === "late ok", `${surface.name} abort-pending: result passthrough`);
  assert(settled.length === 1 && settled[0].ok === true && settled[0].error === undefined, `${surface.name} abort-pending: exactly one settled from the real promise, saw ${JSON.stringify(settled)}`);
}

async function caseAbortThenReject(surface, staged) {
  const settled = [];
  const gate = deferred();
  const { runner, wrap } = environment(surface, staged, {
    before: [() => {}],
    settled: [(event) => settled.push({ ok: event.ok, error: event.error })],
  });
  const tool = makeRegisteredTool("read", () => gate.promise);
  const wrapped = wrap(tool, runner, undefined);
  const controller = new AbortController();
  const pending = wrapped.execute("call-10", PARAMS, controller.signal, undefined);
  controller.abort();
  assert(settled.length === 0, `${surface.name} abort-reject: no premature settle`);
  gate.reject(new Error("aborted by signal"));
  let thrown;
  try {
    await pending;
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.message === "aborted by signal", `${surface.name} abort-reject: original rejection must propagate`);
  assert(settled.length === 1 && settled[0].ok === false && settled[0].error === "aborted by signal", `${surface.name} abort-reject: settled ${JSON.stringify(settled)}`);
}

async function caseExactlyOneOwner(surface, staged) {
  const order = [];
  const beforeCounts = [];
  const settledCounts = [];
  const runner = makeRunner(staged.get(surface.runnerRel), surface);
  const firstExtension = makeExtension("ext-a", {
    tool_effect_before: [() => { order.push("before:a"); beforeCounts.push("a"); }],
    tool_effect_settled: [() => { order.push("settled:a"); settledCounts.push("a"); }],
  });
  const secondExtension = makeExtension("ext-b", {
    tool_effect_before: [() => { order.push("before:b"); beforeCounts.push("b"); }],
    tool_effect_settled: [() => { order.push("settled:b"); settledCounts.push("b"); }],
  });
  runner.extensions.push(firstExtension, secondExtension);
  const wrap = makeWrapper(staged.get(surface.wrapperRel), surface);
  const tool = makeRegisteredTool("read", async () => ({ content: [] }));
  await wrap(tool, runner, undefined).execute("call-11", PARAMS, undefined, undefined);
  assert(order.join(",") === "before:a,before:b,settled:a,settled:b", `${surface.name} owner: order ${order.join(",")}`);
  assert(beforeCounts.length === 2 && settledCounts.length === 2, `${surface.name} owner: exactly one emission per handler per invocation`);
}

const CASES = [
  ["successful-read-before+settled", caseSuccess],
  ["resolved-tool-error", caseToolErrorResult],
  ["actual-failed-read-settled-error", caseThrownFailure],
  ["later-blocker-returns-zero-effects", caseBlockerReturns],
  ["later-blocker-throws-zero-effects", caseBlockerThrows],
  ["scheduler-skip-zero-effects", caseSkip],
  ["reservation-failure-zero-effect", caseReservationFailure],
  ["async-before-contract-violation", caseAsyncBeforeViolation],
  ["synthetic-abort-no-premature-settle", caseAbortPending],
  ["synthetic-abort-then-reject", caseAbortThenReject],
  ["exactly-one-lifecycle-owner", caseExactlyOneOwner],
];

async function main() {
  const { staged, base } = loadStaged(STAGE_ROOT, LANE_DIR);

  if (process.argv.includes("--red-control")) {
    let baseSurfacesWithoutLifecycle = 0;
    for (const surface of SURFACES) {
      const runnerText = base.get(surface.runnerRel);
      const wrapperText = base.get(surface.wrapperRel);
      assert(countOccurrences(runnerText, "emitToolEffectBefore") === 0, `${surface.name}: base runner unexpectedly carries the lifecycle`);
      assert(countOccurrences(runnerText, "emitToolEffectSettled") === 0, `${surface.name}: base runner unexpectedly carries the lifecycle`);
      assert(countOccurrences(wrapperText, "emitToolEffectBefore") === 0, `${surface.name}: base wrapper unexpectedly carries the lifecycle`);
      baseSurfacesWithoutLifecycle += 1;
    }
    console.log(JSON.stringify({ test: "tool-effect-lifecycle", mode: "red-control", baseSurfacesWithoutLifecycle, status: "expected-red" }));
    return;
  }

  let executed = 0;
  for (const surface of SURFACES) {
    assert(countOccurrences(staged.get(surface.runnerRel), surface.settledSig) === 1, `${surface.name}: exactly one settled method expected`);
    assert(countOccurrences(staged.get(surface.wrapperRel), "runner.emitToolEffectBefore({") === 1, `${surface.name}: exactly one wrapper emission expected`);
    for (const [name, run] of CASES) {
      await run(surface, staged);
      executed += 1;
    }
  }

  console.log(
    JSON.stringify({
      test: "tool-effect-lifecycle",
      surfaces: SURFACES.map((surface) => surface.name),
      casesPerSurface: CASES.length,
      executed,
      status: "ok",
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(`FAIL tool-effect-lifecycle: ${error?.stack ?? error}`);
  process.exit(1);
}
