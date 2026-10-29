#!/usr/bin/env node
// Isolated candidate only. This module never writes an installation.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = "5.1.40";
export const FILE = "plugin/extensions/omo-task.js";
export const BASELINE_SHA256 = "0dd146b930bd525cca12b6b39387a4d07db5cff0f5b6e29f3bf3ef04d2bdf45d";
export const EDITS = Object.freeze([
  {
    name: "native-session-busy",
    anchor: "waitForIdle:()=>s,lastAssistantText:()=>t.getLastAssistantText()",
    replacement: "waitForIdle:()=>s,isSessionBusy:()=>t.isSessionBusy,lastAssistantText:()=>t.getLastAssistantText()",
  },
  {
    name: "resident-adapter-busy",
    anchor: "waitForOutcome:()=>e.waitForIdle(),lastAssistantText:()=>e.lastAssistantText()",
    replacement: "waitForOutcome:()=>e.waitForIdle(),isSessionBusy:()=>e.isSessionBusy(),lastAssistantText:()=>e.lastAssistantText()",
  },
  {
    name: "automatic-eligibility",
    anchor: "function yZ(e,t){return e.registry.hasInFlightSends?.(t)??e.registry.hasPendingSends(t)}",
    replacement: "function yZ(e,t,n=!0){return(e.registry.hasInFlightSends?.(t)??e.registry.hasPendingSends(t))||n&&e.registry.get(t)?.isSessionBusy?.()===!0}",
  },
  {
    name: "capacity-claim-recheck",
    anchor: 'if("evict"!==n||i)try{if("evict"===n||"revive_failure"===n)',
    replacement: 'if("evict"===n&&!i)return!1;if("evict"!==n||i)try{if("evict"===n&&yZ(e,t))return!1;if("evict"===n||"revive_failure"===n)',
  },
  {
    name: "capacity-refusal-not-success",
    anchor: ':(await LJ(e,i.task_id,"evict"),{kind:"evicted",evicted_task_id:i.task_id})',
    replacement: ':!1===await LJ(e,i.task_id,"evict")?{kind:"rejected",error:new gZ({max_children:r,session_id:t,residents:n.map(e=>({task_id:e.task_id,name:e.name??e.task_id,status:e.status}))})}:{kind:"evicted",evicted_task_id:i.task_id}',
  },
  {
    name: "explicit-cancel-park-bypass",
    anchor: '||!0===r.killed||yZ(e,t))return!1;let i=e.registry.get(t);return void 0!==i?(await CJ(e,i,n),!0):vZ(e,r,n)',
    replacement: '||!0===r.killed||yZ(e,t,!1))return!1;let i=e.registry.get(t);return void 0!==i?(await CJ(e,i,n),!0):vZ(e,r,n)',
  },
]);

export class PatchError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "PatchError";
    this.kind = kind;
  }
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function count(text, value) {
  return text.split(value).length - 1;
}

export function classifyText(text) {
  if (EDITS.every((edit) => count(text, edit.anchor) === 1 && count(text, edit.replacement) === 0)) return "pristine";
  if (EDITS.every((edit) => count(text, edit.anchor) === 0 && count(text, edit.replacement) === 1)) return "patched";
  return "unknown";
}

export function transformText(text, direction = "apply") {
  if (direction !== "apply" && direction !== "remove") throw new PatchError("argument", "Expected apply or remove");
  const expected = direction === "apply" ? "pristine" : "patched";
  if (classifyText(text) !== expected) throw new PatchError("anchor", `Expected all six ${expected} anchors exactly once`);
  let output = text;
  for (const edit of EDITS) {
    const from = direction === "apply" ? edit.anchor : edit.replacement;
    const to = direction === "apply" ? edit.replacement : edit.anchor;
    output = output.replace(from, () => to);
  }
  return output;
}

export function decideUpdate({ text, version, probe }) {
  const state = classifyText(text);
  const baseHash = sha256(state === "patched" ? transformText(text, "remove") : text);
  const qualified = version === VERSION && baseHash === BASELINE_SHA256;
  const hasCandidateFragments = EDITS.some((edit) => text.includes(edit.replacement));
  let action = "needs-review";
  if (state === "unknown" && hasCandidateFragments) action = "needs-review";
  else if (probe.verdict === "defect-absent" && !hasCandidateFragments) action = "retire";
  else if (probe.verdict === "defect-present" && state === "pristine" && qualified) action = "reapply";
  else if (probe.verdict === "defect-present") action = "rederive";
  else if (probe.verdict === "defect-absent" && state === "patched" && qualified) action = "keep";
  return { action, state, version, qualified, hasCandidateFragments, sha256: sha256(text), baselineSha256: baseHash, probe };
}

export async function checkTree(root) {
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const text = await readFile(join(root, FILE), "utf8");
  const { evaluateText } = await import("./probe.mjs");
  return { root, ...decideUpdate({ text, version, probe: await evaluateText(text) }) };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3 || argv[0] !== "--omo-root" || !argv[1] || argv[2] !== "--check") {
    throw new PatchError("argument", "Use --omo-root <package-root> --check (read-only; no --apply)");
  }
  const result = await checkTree(resolve(argv[1]));
  console.log(`CHECK ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((result) => {
    if (result.action === "needs-review" || result.action === "rederive") process.exitCode = 3;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
