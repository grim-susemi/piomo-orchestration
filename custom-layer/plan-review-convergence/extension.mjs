import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { initialize, logicalKey, readState, reserve, resolveBudget } from "./state.mjs";

function planPathFromPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  const matches = [...prompt.matchAll(/(?:[A-Za-z]:[\\/])?[^\s"'`]*\.omo[\\/]plans[\\/][^\s"'`]+\.md/gu)]
    .map((match) => match[0]);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function deny(message) {
  logGate({ event: "deny", reason: message });
  return { kind: "deny", message };
}

function logGate(value) {
  const path = process.env.PRC_GATE_LOG;
  if (!path) return;
  try {
    appendFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
  } catch {
    // A gate log is diagnostic only.
  }
}

export function gate(e, t, n, r) {
  logGate({ event: "entry", agent: String(t).slice(0, 100), input: String(n).slice(0, 300) });
  const planSource = typeof n === "string"
    ? n
    : n && typeof n === "object"
      ? (typeof n.prompt === "string" ? n.prompt : typeof n.path === "string" ? n.path : "")
      : "";
  const planPath = planPathFromPrompt(planSource);
  if (!planPath) return undefined;
  logGate({ event: "plan", planPath, stateRoot: process.env.PRC_STATE_ROOT ?? null });

  const stateRoot = process.env.PRC_STATE_ROOT;
  if (!stateRoot) return deny("PRC_STATE_UNCONFIGURED");
  const workspaceRoot = resolve(process.env.PRC_WORKSPACE_ROOT ?? process.cwd());
  const workspaceId = process.env.PRC_WORKSPACE_ID ?? workspaceRoot;
  const absolute = resolve(workspaceRoot, planPath);

  let planSha256;
  try {
    planSha256 = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  } catch {
    return deny("PRC_PLAN_UNREADABLE");
  }

  let budget;
  try {
    budget = resolveBudget(process.env.PRC_EXPLICIT_LIMIT === undefined
      ? undefined
      : Number(process.env.PRC_EXPLICIT_LIMIT));
  } catch {
    return deny("PRC_BUDGET_INVALID");
  }

  let key;
  try {
    key = logicalKey({ workspaceId, workspaceRoot, planPath: absolute }).key;
  } catch {
    return deny("PRC_KEY_INVALID");
  }

  try {
    initialize({
      root: stateRoot,
      workspaceId,
      workspaceRoot,
      planPath: absolute,
      planSha256,
      explicitLimit: budget,
    });
  } catch {
    return deny("PRC_STATE_INVALID");
  }

  const state = readState(stateRoot, key);
  if (!state) return deny("PRC_STATE_MISSING");
  if (state.status === "stop-unknown" || state.status === "stopped") {
    return deny("PRC_STOPPED");
  }
  if (process.env.PRC_PROGRESS_ALLOW !== "1" && state.autoUsed >= 1) {
    return deny("PRC_NO_PROGRESS");
  }

  const launchKey = `${process.env.PRC_SESSION_ID ?? "host"}:${state.revision}:${Date.now()}`;
  const result = reserve({
    root: stateRoot,
    workspaceId,
    workspaceRoot,
    planPath: absolute,
    planSha256,
    roundNo: (state.roundNo ?? 0) + 1,
    launchKey,
  });
  if (!result.ok) return deny(`PRC_${result.reason}`);
  logGate({ event: "allow", key, launchKey });
  return undefined;
}
