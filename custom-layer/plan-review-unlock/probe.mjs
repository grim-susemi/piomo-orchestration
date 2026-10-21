#!/usr/bin/env node
// Exercise the actual extracted gate, independent of the patch anchors/version.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { FILES } from "./patch.mjs";

export function evaluateText(text) {
  const policies = {};
  for (const role of ["plan-consultant", "plan-reviewer"]) {
    const pattern = new RegExp(`"${role}":(\\{[^{}]*\\})`, "g");
    const matches = [...text.matchAll(pattern)].filter((m) => m[1].includes("requiresSkills"));
    if (matches.length !== 1) return { verdict: "needs-review", reason: `policy:${role}` };
    policies[role] = vm.runInNewContext(`(${matches[0][1]})`, {}, { timeout: 100 });
  }
  const marker = text.indexOf("is plan-gated and cannot be spawned:");
  if (marker < 0) return { verdict: "needs-review", reason: "gate function unavailable" };
  const start = text.lastIndexOf("function ", marker);
  const terminal = ':{kind:"allow"}}';
  const end = text.indexOf(terminal, marker);
  if (start < 0 || end < 0) return { verdict: "needs-review", reason: "gate boundary" };
  const source = text.slice(start, end + terminal.length);
  const accessor = /let\s+[\w$]+=([\w$]+)\([\w$]+\);if/.exec(source)?.[1];
  if (!accessor) return { verdict: "needs-review", reason: "gate accessor" };
  const gate = vm.runInNewContext(`(${source})`, {
    [accessor]: (role) => policies[role],
  }, { timeout: 100 });
  const results = {};
  for (const role of Object.keys(policies)) {
    const state = (invoked, requested, artifact) => ({
      hasInvoked: () => invoked,
      hasUserRequested: () => requested,
      hasPlanArtifact: () => artifact,
    });
    results[role] = {
      afterExecution: gate(role, state(true, true, true)).kind,
      freshPlan: gate(role, state(false, true, true)).kind,
      noRequest: gate(role, state(true, false, true)).kind,
      noArtifact: gate(role, state(true, true, false)).kind,
    };
  }
  const values = Object.values(results);
  if (values.some((r) => r.freshPlan !== "allow")) return { verdict: "needs-review", results };
  if (values.every((r) => r.afterExecution === "deny")) return { verdict: "defect-present", results };
  if (values.every((r) => r.afterExecution === "allow" && r.noRequest === "deny" && r.noArtifact === "deny")) {
    return { verdict: "defect-absent", results };
  }
  return { verdict: "needs-review", results };
}

export async function probeTree(root) {
  const files = {};
  for (const file of FILES) {
    files[file] = evaluateText(await readFile(join(root, file), "utf8"));
  }
  const verdicts = Object.values(files).map((f) => f.verdict);
  return {
    root,
    verdict: verdicts.every((v) => v === "defect-absent") ? "defect-absent"
      : verdicts.includes("defect-present") ? "defect-present" : "needs-review",
    files,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--omo-root");
  if (index < 0 || !process.argv[index + 1]) {
    console.error("Use --omo-root <dir>");
    process.exitCode = 2;
  } else {
    probeTree(resolve(process.argv[index + 1])).then((result) => {
      console.log(`PROBE ${JSON.stringify(result)}`);
    }).catch((error) => {
      console.error(error);
      process.exitCode = 2;
    });
  }
}
