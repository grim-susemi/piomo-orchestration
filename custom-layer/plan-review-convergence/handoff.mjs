import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { bindReceipt, REVIEW_ROLES, sha256Bytes } from "./receipt.mjs";
import { ConvergenceLedger } from "./convergence.mjs";
import { leadSubmissionPath, readLeadSubmission } from "./lead-submission.mjs";
import { completeByKey } from "./state.mjs";

export const SNAPSHOT_SCHEMA = "plan-review-convergence/reviewed-snapshot/v1";
export const RECEIPT_SCHEMA = "plan-review-convergence/reviewed-receipt/v1";

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function taskRecordPaths(agentDir) {
  const projects = join(agentDir, "projects");
  if (!existsSync(projects)) return [];
  const paths = [];
  for (const project of readdirSync(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const tasks = join(projects, project.name, "senpi-task", "tasks");
    if (!existsSync(tasks)) continue;
    for (const entry of readdirSync(tasks, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) paths.push(join(tasks, entry.name));
    }
  }
  return paths;
}

export function findTaskRecord(agentDir, taskId) {
  if (typeof taskId !== "string" || taskId.length === 0) return null;
  for (const path of taskRecordPaths(agentDir)) {
    try {
      const record = JSON.parse(readFileSync(path, "utf8"));
      if (record?.task_id === taskId) return record;
    } catch {
      // A partially written task record is not a receipt.
    }
  }
  return null;
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").toLowerCase();
}

/**
 * The host writes the child transcript under the project that owns the task.
 * The task id is the directory key; a filename/header match is the fallback for
 * a moved project tree.  This is the only source of a child read event.
 */
export function childSessionFiles(agentDir, taskId, childSessionId) {
  const paths = [];
  const projects = join(agentDir, "projects");
  if (!existsSync(projects)) return paths;
  const direct = join(projects);
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      if (taskId && !path.includes(`${taskId}`)) continue;
      if (childSessionId && !path.includes(childSessionId)) {
        let header = null;
        try { header = JSON.parse(readFileSync(path, "utf8").split(/\r?\n/u, 1)[0]); } catch { header = null; }
        if (header?.type !== "session" || header?.id !== childSessionId) continue;
      }
      paths.push(path);
    }
  };
  walk(direct, 0);
  return [...new Set(paths)];
}

/**
 * Recover the reviewer's own read from the child transcript.  The result bytes
 * must hash to the frozen snapshot; a preview, a different file, or a missing
 * event never becomes a read.  When the host leaves no such event, the caller
 * closes the approval as UNSUPPORTED_BY_HOST instead of inventing one.
 */
export function readChildSessionRead({ agentDir, taskRecord, planPath, expectedSha }) {
  if (!taskRecord || typeof taskRecord.task_id !== "string") {
    return { ok: false, reason: "CHILD_SESSION_FILE_MISSING" };
  }
  const files = childSessionFiles(agentDir, taskRecord.task_id, taskRecord.child_session_id ?? null);
  if (files.length === 0) return { ok: false, reason: "CHILD_SESSION_FILE_MISSING" };
  const wanted = normalizePath(planPath);
  const observed = [];
  for (const file of files) {
    let lines;
    try { lines = readFileSync(file, "utf8").split(/\r?\n/u); } catch { continue; }
    const calls = new Map();
    const results = new Map();
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.type !== "message") continue;
      const message = entry.message ?? {};
      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type !== "toolCall" || part?.name !== "read") continue;
          const skillPath = part.arguments?.path;
          if (typeof skillPath !== "string" || normalizePath(skillPath) !== wanted) continue;
          calls.set(part.id, { lineIndex: index, eventId: sha256Bytes(Buffer.from(line, "utf8")), path: skillPath });
        }
      }
      if (message.role === "toolResult" && calls.has(message.toolCallId)) {
        const parts = Array.isArray(message.content) ? message.content : [];
        const text = parts.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("\n");
        results.set(message.toolCallId, {
          lineIndex: index,
          eventId: sha256Bytes(Buffer.from(line, "utf8")),
          isError: message.isError === true,
          text,
        });
      }
    }
    for (const [callId, call] of calls) {
      const result = results.get(callId);
      if (!result) continue;
      observed.push({ file, callId, call, result });
    }
  }
  if (observed.length === 0) return { ok: false, reason: "CHILD_READ_EVENT_MISSING" };
  const usable = observed.filter((entry) => !entry.result.isError);
  if (usable.length === 0) return { ok: false, reason: "CHILD_READ_EVENT_MISSING" };
  const matched = expectedSha
    ? usable.filter((entry) => sha256Bytes(Buffer.from(entry.result.text, "utf8")) === expectedSha)
    : usable;
  if (matched.length === 0) {
    return {
      ok: false,
      reason: "CHILD_READ_SHA_MISMATCH",
      observedSha256: usable.map((entry) => sha256Bytes(Buffer.from(entry.result.text, "utf8"))),
      childSessionId: taskRecord.child_session_id ?? null,
      readEventIds: usable.map((entry) => entry.call.eventId),
    };
  }
  const [entry] = matched;
  return {
    ok: true,
    childSessionId: taskRecord.child_session_id ?? null,
    sha256: sha256Bytes(Buffer.from(entry.result.text, "utf8")),
    terminalEvent: taskRecord.terminal_at ?? null,
    readEventId: entry.call.eventId,
    resultEventId: entry.result.eventId,
    childSessionFile: entry.file,
    readLineIndex: entry.call.lineIndex,
    resultLineIndex: entry.result.lineIndex,
  };
}

function convergenceDir(stateRoot) {
  return join(stateRoot, "convergence");
}

export function convergenceLedgerPath(stateRoot, W) {
  return join(convergenceDir(stateRoot), `${sha256Bytes(Buffer.from(String(W), "utf8")).slice(0, 32)}.json`);
}

export function loadConvergenceLedger({ stateRoot, W }) {
  try {
    const json = JSON.parse(readFileSync(convergenceLedgerPath(stateRoot, W), "utf8"));
    const ledger = ConvergenceLedger.fromJSON(json);
    return ledger && ledger.W === W ? ledger : null;
  } catch {
    return null;
  }
}

export function saveConvergenceLedger({ stateRoot, ledger }) {
  mkdirSync(convergenceDir(stateRoot), { recursive: true });
  const file = convergenceLedgerPath(stateRoot, ledger.W);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(ledger.toJSON())}\n`, "utf8");
  renameSync(temp, file);
}

function snapshotDir(stateRoot) {
  return join(stateRoot, "snapshots");
}

function receiptDir(stateRoot) {
  return join(stateRoot, "receipts");
}

export function receiptPath(stateRoot, launchKey) {
  return join(receiptDir(stateRoot), `${sha256Bytes(Buffer.from(String(launchKey), "utf8"))}.json`);
}

/**
 * Freeze the exact plan bytes admitted at the spawn boundary.  `reviewedBodySha256`
 * is later recomputed from this file, never copied from the live plan digest.
 */
export function captureReviewedSnapshot({ stateRoot, planPath, planBytes }) {
  const bytes = planBytes ?? readFileSync(planPath);
  const sha256 = sha256Bytes(bytes);
  mkdirSync(snapshotDir(stateRoot), { recursive: true });
  const ref = `snapshots/${sha256}.md`;
  const file = join(snapshotDir(stateRoot), `${sha256}.md`);
  if (existsSync(file)) {
    if (sha256Bytes(readFileSync(file)) !== sha256) throw new Error("SNAPSHOT_DRIFT");
  } else {
    writeFileSync(file, bytes, { flag: "wx" });
  }
  const sidecar = join(snapshotDir(stateRoot), `${sha256}.json`);
  if (existsSync(sidecar)) {
    const stored = JSON.parse(readFileSync(sidecar, "utf8"));
    if (stored?.sha256 !== sha256) throw new Error("SNAPSHOT_SIDECAR_DRIFT");
  } else {
    writeFileSync(sidecar, `${JSON.stringify({
      schema: SNAPSHOT_SCHEMA,
      sha256,
      bytes: bytes.length,
      planPath,
      capturedAt: new Date().toISOString(),
    })}\n`, { flag: "wx" });
  }
  return { reviewedBodySha256: sha256, reviewedSnapshotRef: ref, bytes: bytes.length };
}

export function loadReviewedSnapshot({ stateRoot, ref }) {
  if (typeof ref !== "string" || !ref.startsWith("snapshots/") || ref.includes("..")) {
    return { ok: false, reason: "EVIDENCE_UNAVAILABLE" };
  }
  const file = resolve(stateRoot, ref);
  const root = resolve(snapshotDir(stateRoot));
  const pathToFile = relative(root, file);
  if (pathToFile.startsWith("..") || resolve(root, pathToFile) !== file) {
    return { ok: false, reason: "EVIDENCE_UNAVAILABLE" };
  }
  let bytes;
  let sidecar;
  try {
    bytes = readFileSync(file);
    sidecar = JSON.parse(readFileSync(file.replace(/\.md$/u, ".json"), "utf8"));
  } catch {
    return { ok: false, reason: "EVIDENCE_UNAVAILABLE" };
  }
  const sha256 = sha256Bytes(bytes);
  if (sidecar?.schema !== SNAPSHOT_SCHEMA || sidecar?.sha256 !== sha256 || sidecar?.bytes !== bytes.length) {
    return { ok: false, reason: "SNAPSHOT_SIDECAR_MISMATCH" };
  }
  return { ok: true, bytes, sha256, sidecar, ref, text: bytes.toString("utf8") };
}

function reviewCandidates({ agentDir, parentSessionId, planPath, since }) {
  const normalize = (value) => String(value).replaceAll("\\", "/").toLowerCase();
  const normalizedPlan = planPath ? normalize(planPath) : null;
  const candidates = [];
  for (const path of taskRecordPaths(agentDir)) {
    let record;
    try {
      record = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!REVIEW_ROLES.has(String(record?.agent_type))) continue;
    if (record?.status !== "completed") continue;
    if (parentSessionId && record?.parent_session_id !== parentSessionId) continue;
    if (!record?.child_session_id || !record?.terminal_at) continue;
    if (normalizedPlan && record?.spawn_spec?.prompt && !normalize(record.spawn_spec.prompt).includes(normalizedPlan)) continue;
    if (since && record?.created_at && Date.parse(record.created_at) < Date.parse(since)) continue;
    candidates.push(record);
  }
  return candidates.sort((left, right) => Date.parse(left.created_at ?? 0) - Date.parse(right.created_at ?? 0));
}

/**
 * Turn the reserved round into a receipt bound to the host task record, the
 * child session and the frozen snapshot.  This is the only producer of a
 * review receipt; a verdict string alone never becomes one.
 */
export function resolveReviewRound({
  agentDir,
  stateRoot,
  state,
  planPath,
  currentSha,
  parentSessionId = null,
  workspaceRoot = null,
}) {
  if (!state || !state.launchKey || !state.reviewedSnapshotRef) {
    return { ok: false, reason: "NO_RESERVATION" };
  }
  let record = null;
  if (state.childReceiptId) {
    record = findTaskRecord(agentDir, state.childReceiptId);
    if (!record) return { ok: false, reason: "NO_RECEIPT" };
  } else {
    const candidates = reviewCandidates({
      agentDir,
      parentSessionId,
      planPath,
      since: state.reservedAt,
    });
    if (candidates.length === 0) return { ok: false, reason: "NO_RECEIPT" };
    if (candidates.length > 1) {
      return {
        ok: false,
        reason: "AMBIGUOUS_RECEIPT",
        taskIds: candidates.map((candidate) => candidate.task_id),
      };
    }
    [record] = candidates;
  }
  const snapshot = loadReviewedSnapshot({ stateRoot, ref: state.reviewedSnapshotRef });
  if (!snapshot.ok) return { ok: false, reason: snapshot.reason, taskId: record.task_id };
  const expectedReviewedSha = state.reviewedBodySha256 ?? snapshot.sha256;
  const childRead = readChildSessionRead({
    agentDir,
    taskRecord: record,
    planPath,
    expectedSha: expectedReviewedSha,
  });
  const receipt = bindReceipt({
    taskRecord: record,
    expected: {
      W: state.W,
      roundId: state.roundNo,
      launchKey: state.launchKey,
      taskId: record.task_id,
      childSessionId: record.child_session_id,
      parentSessionId: parentSessionId ?? record.parent_session_id,
      reviewerRole: record.agent_type,
      planPath,
      reviewedSha: expectedReviewedSha,
      currentSha,
    },
    reviewedSnapshotRef: state.reviewedSnapshotRef,
    reviewedSnapshotBytes: snapshot.bytes,
    safeRead: true,
    hostTrusted: true,
    childRead: childRead.ok ? childRead : null,
    childReadFailure: childRead.ok
      ? null
      : (childRead.reason === "CHILD_READ_EVENT_MISSING" || childRead.reason === "CHILD_SESSION_FILE_MISSING"
        ? "UNSUPPORTED_BY_HOST"
        : childRead.reason),
  });
  let ledger = loadConvergenceLedger({ stateRoot, W: state.W });
  if (!ledger) ledger = new ConvergenceLedger({ W: state.W, planSha256: snapshot.sha256 });
  const submission = receipt.status === "CHANGES_REQUESTED" && workspaceRoot
    ? readLeadSubmission({ workspaceRoot, receipt })
    : { ok: false, reason: "LEAD_SUBMISSION_MISSING", path: workspaceRoot ? leadSubmissionPath(workspaceRoot) : null };
  // The reviewer's structured response is the blocker-key source even before a
  // lead submission exists; the submission only controls the owner display.
  const responseFindings = Array.isArray(receipt.findings) ? receipt.findings : [];
  let round = ledger.roundForReceipt(receipt.taskId, receipt.responseSha256);
  if (!round) {
    round = ledger.recordRound({
      receipt,
      snapshot: { text: snapshot.text, sha256: snapshot.sha256 },
      findings: submission.ok ? submission.findings : responseFindings,
    });
    if (receipt.verdict === "REJECT" || receipt.status === "CHANGES_REQUESTED") {
      saveConvergenceLedger({ stateRoot, ledger });
    }
  }
  receipt.responseFindings = responseFindings;
  receipt.findings = submission.ok
    ? round.findings.filter((finding) => finding.receiptRef === receipt.taskId)
    : [];
  receipt.findingsVerified = submission.ok;
  receipt.leadSubmission = submission.ok
    ? { ok: true, path: submission.path }
    : { ok: false, reason: submission.reason, path: submission.path ?? null };
  const findingsDir = join(stateRoot, "findings");
  mkdirSync(findingsDir, { recursive: true });
  writeFileSync(join(findingsDir, `${sha256Bytes(Buffer.from(String(state.launchKey), "utf8"))}.json`), `${JSON.stringify({
    schema: "plan-review-convergence/findings/v1",
    launchKey: state.launchKey,
    taskId: receipt.taskId,
    snapshotRef: state.reviewedSnapshotRef,
    snapshotSha256: snapshot.sha256,
    findings: round.findings,
    openKeys: round.openKeys,
  })}\n`, "utf8");
  let persisted = null;
  if (typeof record.task_id === "string" && receipt.taskId === record.task_id) {
    mkdirSync(receiptDir(stateRoot), { recursive: true });
    const file = receiptPath(stateRoot, state.launchKey);
    const payload = {
      schema: RECEIPT_SCHEMA,
      launchKey: state.launchKey,
      snapshotRef: state.reviewedSnapshotRef,
      snapshotSha256: snapshot.sha256,
      persistedAt: new Date().toISOString(),
      receipt,
    };
    if (existsSync(file)) {
      try {
        persisted = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        persisted = null;
      }
      if (persisted?.receipt?.taskId && receipt.taskId && persisted.receipt.taskId !== receipt.taskId) {
        return { ok: false, reason: "RECEIPT_CONFLICT", taskId: record.task_id };
      }
    }
    if (!persisted) {
      writeFileSync(file, `${JSON.stringify(payload)}\n`, { flag: "wx" });
      persisted = payload;
    } else {
      // A later verified lead submission completes the same receipt.  Keep the
      // original persistence time but refresh the findings that the owner sees.
      const refreshed = { ...persisted, receipt };
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(refreshed)}\n`, "utf8");
      renameSync(temp, file);
      persisted = refreshed;
    }
  }
  const completed = state.childReceiptId
    ? { ok: true, duplicate: true }
    : completeByKey({
      root: stateRoot,
      key: state.W,
      launchKey: state.launchKey,
      childReceiptId: record.task_id,
      expectedRevision: state.revision,
    });
  return { ok: true, receipt: persisted?.receipt ?? receipt, record, stateCompleted: completed?.ok === true, ledger, childRead, submission };
}

export function persistedReceipt({ stateRoot, launchKey }) {
  if (!launchKey) return null;
  try {
    return JSON.parse(readFileSync(receiptPath(stateRoot, launchKey), "utf8"))?.receipt ?? null;
  } catch {
    return null;
  }
}

export function resolveHandoff({
  agentDir,
  stateRoot,
  state,
  planPath,
  currentSha,
  parentSessionId = null,
  workspaceRoot = null,
}) {
  if (!state) return { reviewStatus: "UNVERIFIED", reason: "NO_STATE", findings: [] };
  const round = resolveReviewRound({
    agentDir,
    stateRoot,
    state,
    planPath,
    currentSha,
    parentSessionId,
    workspaceRoot,
  });
  if (!round.ok) {
    return {
      reviewStatus: "UNVERIFIED",
      reason: round.reason,
      receiptId: round.taskId ?? null,
      findings: [],
    };
  }
  const receipt = round.receipt;
  const findings = receipt.findings ?? [];
  if (receipt.status !== "APPROVED") {
    const reason = receipt.reason === "PLAN_CHANGED"
      ? "PLAN_SHA_MISMATCH"
      : receipt.reason ?? (receipt.status === "CHANGES_REQUESTED" ? "NOT_APPROVED" : "NO_APPROVAL");
    return {
      reviewStatus: "UNVERIFIED",
      reason,
      receiptId: receipt.taskId,
      receipt,
      findings,
    };
  }
  if (receipt.reviewedBodySha256 !== currentSha) {
    return {
      reviewStatus: "UNVERIFIED",
      reason: "PLAN_SHA_MISMATCH",
      receiptId: receipt.taskId,
      receipt,
      findings,
    };
  }
  if (!receipt.reviewedSnapshotRef) {
    return {
      reviewStatus: "UNVERIFIED",
      reason: "EVIDENCE_UNAVAILABLE",
      receiptId: receipt.taskId,
      receipt,
      findings,
    };
  }
  return {
    reviewStatus: "APPROVED",
    planPath,
    planSha256: receipt.reviewedBodySha256,
    roundId: receipt.roundId,
    receiptId: receipt.taskId,
    receipt,
    findings,
  };
}

export function handoffNotice(status, planPath) {
  const fields = [
    `[PRC_HANDOFF ${status.reviewStatus}`,
    `reason=${status.reason ?? "-"}`,
    `receipt=${status.receiptId ?? "-"}`,
    `plan=${planPath}`,
  ];
  if (status.planSha256) fields.push(`planSha=${status.planSha256}`);
  if (status.roundId) fields.push(`round=${status.roundId}`);
  return `${fields.join(" ")}]`;
}
