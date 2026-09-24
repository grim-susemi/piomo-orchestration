#!/usr/bin/env node
/**
 * engine-bridge behavior test: event.originalText across every input handler.
 *
 * Fixture: a chain of input handlers where earlier handlers transform event.text.
 * Contract proven on each shipped surface (unbundled runner + both bundled mirrors):
 *   - every handler sees event.originalText === the original pre-transform input,
 *   - subsequent handlers see event.text transformed by the earlier handlers,
 *   - source / inputId / streamingBehavior / images pass through unchanged,
 *   - the final result carries the last transformed text.
 * Also runs the SAME fixture against the immutable pre-patch base copies and asserts they
 * do NOT expose originalText, so this test fails before the patch and passes after it.
 *
 * Run after the builder: node build-transform.mjs && node originaltext.test.mjs
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, countOccurrences, extractMethod, loadStaged, methodFunction } from "./lib.mjs";

const LANE_DIR = dirname(fileURLToPath(import.meta.url));
const STAGE_ROOT = resolve(LANE_DIR, "..", "..", "..");

const ORIGINAL = "hello world";
const INPUT_ID = "sess-1:7";
const STREAMING = "steer";
const SOURCES = ["interactive", "rpc", "extension"];

const SURFACES = [
  { name: "unbundled dist/core/extensions/runner.js", relpath: "dist/core/extensions/runner.js", tokenFn: null },
  { name: "bundled-main dist/bundle/chunks/chunk-RRSND33J.js", relpath: "dist/bundle/chunks/chunk-RRSND33J.js", tokenFn: "randomUUID11" },
  { name: "bundled-worker dist/bundle/chunks/session-worker.js", relpath: "dist/bundle/chunks/session-worker.js", tokenFn: "randomUUID16" },
];

const SCENARIOS = {
  single: {
    chain: [ORIGINAL, `${ORIGINAL}:a`, `${ORIGINAL}:a`],
    final: `${ORIGINAL}:a`,
  },
  double: {
    chain: [ORIGINAL, `${ORIGINAL}:a`, `${ORIGINAL}:a:b`],
    final: `${ORIGINAL}:a:b`,
  },
};

function makeExtension(path, handler) {
  return { path, handlers: new Map([["input", [handler]]]) };
}

function snapshot(name, event) {
  return {
    handler: name,
    text: event.text,
    originalText: event.originalText,
    source: event.source,
    inputId: event.inputId,
    streamingBehavior: event.streamingBehavior,
    images: event.images,
  };
}

async function runFixture(emitInput, { scenario, source, images }) {
  const events = [];
  const errors = [];
  const observe = (name) => (event) => {
    events.push(snapshot(name, event));
    return undefined;
  };
  const transform = (name, suffix) => (event) => {
    events.push(snapshot(name, event));
    return { action: "transform", text: `${event.text}${suffix}` };
  };
  const extensions = [
    makeExtension("ext-a", transform("ext-a", ":a")),
    makeExtension("ext-b", scenario === "single" ? observe("ext-b") : transform("ext-b", ":b")),
    makeExtension("ext-c", observe("ext-c")),
  ];
  const thisArg = { extensions, createContext: () => ({}), emitError: (error) => errors.push(error) };
  const result = await emitInput.call(thisArg, ORIGINAL, images, source, STREAMING, INPUT_ID);
  return { events, errors, result, images };
}

function checkStaged(fixture, label, { source, scenario }) {
  const spec = SCENARIOS[scenario];
  assert(fixture.errors.length === 0, `${label}: handler errors ${JSON.stringify(fixture.errors)}`);
  assert(fixture.events.length === 3, `${label}: expected 3 handler observations, saw ${fixture.events.length}`);
  fixture.events.forEach((event, index) => {
    assert(
      event.originalText === ORIGINAL,
      `${label}: handler #${index + 1} (${event.handler}) saw originalText ${JSON.stringify(event.originalText)}, expected ${JSON.stringify(ORIGINAL)} unchanged`,
    );
    assert(
      event.text === spec.chain[index],
      `${label}: handler #${index + 1} (${event.handler}) saw text ${JSON.stringify(event.text)}, expected ${JSON.stringify(spec.chain[index])}`,
    );
    assert(event.source === source, `${label}: source ${JSON.stringify(event.source)} expected ${JSON.stringify(source)}`);
    assert(event.inputId === INPUT_ID, `${label}: inputId ${JSON.stringify(event.inputId)} expected ${JSON.stringify(INPUT_ID)}`);
    assert(event.streamingBehavior === STREAMING, `${label}: streamingBehavior ${JSON.stringify(event.streamingBehavior)} expected ${JSON.stringify(STREAMING)}`);
    if (fixture.images) assert(event.images === fixture.images, `${label}: images passthrough drift at handler #${index + 1}`);
  });
  assert(fixture.result?.action === "transform", `${label}: final action ${JSON.stringify(fixture.result?.action)}`);
  assert(fixture.result?.text === spec.final, `${label}: final text ${JSON.stringify(fixture.result?.text)} expected ${JSON.stringify(spec.final)}`);
}

function checkBaseNegativeControl(fixture, label) {
  assert(fixture.events.length === 3, `${label}: expected 3 handler observations, saw ${fixture.events.length}`);
  for (const event of fixture.events) {
    assert(event.originalText === undefined, `${label}: pre-patch base already exposes originalText=${JSON.stringify(event.originalText)}`);
  }
  let failed = false;
  try {
    checkStaged(fixture, label, { source: "interactive", scenario: "single" });
  } catch (error) {
    failed = true;
    assert(String(error.message).includes("originalText"), `${label}: base negative control failed for an unexpected reason: ${error.message}`);
  }
  assert(failed, `${label}: pre-patch base passed the staged checker, so the test would not prove the bridge`);
}

function interfaceBlock(text, name) {
  const match = text.match(new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}`));
  assert(match, `${name} interface block not found`);
  return match[0];
}

async function main() {
  const { staged, base } = loadStaged(STAGE_ROOT, LANE_DIR);
  let stagedRuns = 0;
  let negativeControls = 0;
  let typeChecks = 0;

  if (process.argv.includes("--red-control")) {
    let baseSurfacesFailed = 0;
    for (const surface of SURFACES) {
      const baseFn = methodFunction(extractMethod(base.get(surface.relpath), "async emitInput(", `${surface.name} base`), "async emitInput(");
      checkBaseNegativeControl(await runFixture(baseFn, { scenario: "single", source: "interactive" }), `${surface.name} base red control`);
      baseSurfacesFailed += 1;
    }
    console.log(JSON.stringify({ test: "originaltext-bridge", mode: "red-control", baseSurfacesFailed, status: "expected-red" }));
    return;
  }

  for (const surface of SURFACES) {
    const stagedText = staged.get(surface.relpath);
    const stagedFn = methodFunction(
      extractMethod(stagedText, "async emitInput(", `${surface.name} staged`),
      "async emitInput(",
      surface.tokenFn ? { [surface.tokenFn]: () => "unused-by-emitInput" } : {},
    );
    const baseFn = methodFunction(extractMethod(base.get(surface.relpath), "async emitInput(", `${surface.name} base`), "async emitInput(");

    for (const source of SOURCES) {
      for (const scenario of ["single", "double"]) {
        const label = `${surface.name} source=${source} scenario=${scenario}`;
        checkStaged(await runFixture(stagedFn, { scenario, source }), label, { source, scenario });
        stagedRuns += 1;
      }
      const images = [{ data: "aW1n", mimeType: "image/png" }];
      const label = `${surface.name} source=${source} scenario=double+images`;
      checkStaged(await runFixture(stagedFn, { scenario: "double", source, images }), label, { source, scenario: "double" });
      stagedRuns += 1;
    }

    checkBaseNegativeControl(
      await runFixture(baseFn, { scenario: "single", source: "interactive" }),
      `${surface.name} base negative control`,
    );
    negativeControls += 1;
  }

  // Type declaration surface: one event contract for both runtime and types.
  const stagedTypes = staged.get("dist/core/extensions/types.d.ts");
  const baseTypes = base.get("dist/core/extensions/types.d.ts");
  const stagedInput = interfaceBlock(stagedTypes, "InputEvent");
  const baseInput = interfaceBlock(baseTypes, "InputEvent");
  assert(stagedInput.includes("text: string;"), "staged InputEvent must keep text: string;");
  assert(stagedInput.includes("originalText: string;"), "staged InputEvent must declare originalText: string;");
  assert(!stagedInput.includes("originalText?: string;"), "originalText must be required (the engine always provides it)");
  assert(stagedInput.indexOf("text: string;") < stagedInput.indexOf("originalText: string;"), "originalText must be declared after text");
  assert(!baseInput.includes("originalText"), "base InputEvent must not already contain originalText");
  assert(stagedTypes.includes('export type InputSource = "interactive" | "rpc" | "extension";'), "InputSource union must stay interactive|rpc|extension");
  assert(countOccurrences(stagedTypes, "originalText: string;") === 1, "exactly one originalText: string; declaration expected");
  assert(interfaceBlock(stagedTypes, "InputDispositionEvent").includes("same lifetime-unique identity"), "disposition inputId doc must state the shared lifetime-unique identity");
  typeChecks += 8;

  console.log(
    JSON.stringify({
      test: "originaltext-bridge",
      stagedRuns,
      negativeControls,
      typeChecks,
      surfaces: SURFACES.map((surface) => surface.name),
      sources: SOURCES,
      status: "ok",
    }),
  );
}

try {
  await main();
} catch (error) {
  console.error(`FAIL originaltext-bridge: ${error?.stack ?? error}`);
  process.exit(1);
}
