// engine-bridge lane shared helpers. Node builtins only; no dependencies.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function countOccurrences(hay, needle) {
  let count = 0;
  let index = hay.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = hay.indexOf(needle, index + 1);
  }
  return count;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Extract one method source (`async name(args){...}`) from a pinned engine surface.
 * String-aware brace scanner: handles double/single/backtick literals and escapes,
 * so minified template literals (`${...}`) inside the body cannot unbalance it.
 */
export function extractMethod(source, signature, label) {
  const found = countOccurrences(source, signature);
  assert(found === 1, `${label}: expected exactly 1 "${signature}" occurrence, found ${found}`);
  const start = source.indexOf(signature);
  const braceStart = source.indexOf("{", start);
  assert(braceStart >= 0, `${label}: no body brace after "${signature}"`);
  let depth = 0;
  let quote = null;
  let i = braceStart;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  assert(depth === 0, `${label}: unbalanced braces while extracting "${signature}"`);
  return source.slice(start, i + 1);
}

/**
 * Convert an extracted function/method source into a callable function.
 * Handles `[export ][async ]name(args){...}` and `[export ]function name(args){...}`.
 */
export function functionFromSource(body, injected = {}) {
  let source = body.startsWith("export ") ? body.slice("export ".length) : body;
  if (source.startsWith("async ")) source = `async function ${source.slice("async ".length)}`;
  else if (!source.startsWith("function ")) source = `function ${source}`;
  const names = Object.keys(injected);
  const factory = new Function(...names, `return (${source});`);
  return factory(...names.map((name) => injected[name]));
}

/** Extract a `[export ][async ]name(args){...}` method/function and make it callable. */
export function methodFunction(body, _signature, injected = {}) {
  return functionFromSource(body, injected);
}

/**
 * Load the staged output tree and verify, before any behavioral check:
 * - manifest schema and that staged bytes match the generated manifest pins,
 * - that the immutable base still matches the authored pins (base-untouched proof).
 * Returns { pins, manifest, outRoot, staged: Map<relpath,text>, base: Map<relpath,text> }.
 */
export function loadStaged(stageRoot, laneDir) {
  const pins = readJson(join(laneDir, "pins.json"));
  const outRoot = join(stageRoot, pins.outputRoot);
  const manifest = readJson(join(outRoot, pins.manifestRel));
  assert(manifest.schema === "omo-beta88-engine-bridge/manifest/v1", `manifest schema ${manifest.schema}`);
  const outputs = new Map((manifest.outputs ?? []).map((entry) => [entry.relpath, entry]));
  const inputs = new Map((manifest.inputs ?? []).map((entry) => [entry.relpath, entry]));
  assert(outputs.size === pins.files.length, `manifest outputs ${outputs.size} != pins files ${pins.files.length}`);
  const staged = new Map();
  const base = new Map();
  for (const file of pins.files) {
    const inputPin = inputs.get(file.relpath);
    assert(inputPin && inputPin.sha256 === file.sha256 && inputPin.bytes === file.bytes, `manifest input pin mismatch for ${file.relpath}`);
    const outputPin = outputs.get(file.relpath);
    assert(outputPin, `manifest missing output ${file.relpath}`);
    const outBuf = readFileSync(join(outRoot, file.relpath));
    assert(sha256(outBuf) === outputPin.sha256, `staged ${file.relpath} sha ${sha256(outBuf)} != manifest ${outputPin.sha256}`);
    assert(outBuf.length === outputPin.bytes, `staged ${file.relpath} bytes drift`);
    staged.set(file.relpath, outBuf.toString("utf8"));
    const baseBuf = readFileSync(join(stageRoot, pins.baseRoot, file.relpath));
    assert(sha256(baseBuf) === file.sha256, `base ${file.relpath} sha drift: ${sha256(baseBuf)} != pinned ${file.sha256}`);
    base.set(file.relpath, baseBuf.toString("utf8"));
  }
  return { pins, manifest, outRoot, staged, base };
}
