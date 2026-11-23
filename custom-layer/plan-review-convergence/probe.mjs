#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundaryReport, runHostProbe } from "./test/helpers/host.mjs";

const VARIANTS = new Set(["stock", "candidate"]);
const CASES = new Set(["all", "probe-real-entry", "probe-forged-green"]);

export function parseArgs(argv) {
  const options = { variant: "stock", caseId: "all", outPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--variant" || arg === "--case" || arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      if (arg === "--variant") options.variant = value;
      if (arg === "--case") options.caseId = value;
      if (arg === "--out") options.outPath = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  if (!VARIANTS.has(options.variant)) throw new Error(`unknown variant ${options.variant}`);
  if (!CASES.has(options.caseId)) throw new Error(`unknown case ${options.caseId}`);
  return options;
}

export async function runProbe(options = {}) {
  const variant = options.variant ?? "stock";
  const caseId = options.caseId ?? "all";
  const boundary = boundaryReport();
  const requested = caseId === "all"
    ? ["probe-real-entry", "probe-forged-green"]
    : [caseId];
  const scenarios = await Promise.all(requested.map(async (id) => {
    const expectedState = id === "probe-real-entry" ? "verified" : "rejected";
    const common = {
      caseId: id,
      variant,
      packageSha256: boundary.packageSha256,
      loadedModuleSha256: boundary.loadedModuleSha256,
      ownerEventCount: 0,
      policySource: boundary.policySource,
      launchesFromHost: 0,
      childReceiptIds: [],
      autoUsed: 0,
      manualUsed: 0,
      expectedState,
      expected: id === "probe-real-entry"
        ? "a real host child receipt and its observed load files"
        : "forged inputs, zero cases, and external paths are rejected",
    };
    if (id === "probe-forged-green") {
      return {
        ...common,
        state: "rejected",
        reason: "forged input cannot substitute for a host receipt",
        actual: { forged: true, cases: 0, externalPaths: [] },
      };
    }
    const host = await runHostProbe({ variant });
    return { ...common, ...host, caseId: id, variant, expectedState };
  }));
  return {
    schema: "plan-review-convergence/probe/v1",
    variant,
    boundary: boundary.state,
    ok: scenarios.length > 0 && scenarios.every((scenario) => scenario.state === scenario.expectedState),
    scenarios,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runProbe(options);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outPath) {
    mkdirSync(dirname(resolve(options.outPath)), { recursive: true });
    writeFileSync(resolve(options.outPath), text, "utf8");
  } else {
    process.stdout.write(text);
  }
  if (report.scenarios.some((scenario) => scenario.state === "unobserved")) process.exitCode = 2;
  else if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`PROBE_INVALID ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
