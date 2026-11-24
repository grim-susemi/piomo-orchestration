import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { initialize, logicalKey, readState, reserve, resolveBudget } from "./state.mjs";
import {
  bindOwnerAnswer,
  ensureResumeQuestion,
  publishQuestion,
  readOwnerAnswers,
  readQuestion,
  reserveManual,
} from "./owner-resume.mjs";
import {
  captureReviewedSnapshot,
  handoffNotice,
  loadConvergenceLedger,
  persistedReceipt,
  resolveHandoff,
  resolveReviewRound,
  sha256File,
} from "./handoff.mjs";
import { nextRoundProgress } from "./convergence.mjs";
import { renderReviewNotice } from "./display.mjs";
import { leadSubmissionPath } from "./lead-submission.mjs";
import { REVIEW_ROLES } from "./receipt.mjs";

const EXECUTOR_PROMPT = /(?:ulw-execute|execute\s+plan|start\s+work)/iu;

function agentDir() {
  return process.env.OMO_CODING_AGENT_DIR
    ?? process.env.PI_CODING_AGENT_DIR
    ?? process.env.SENPI_CODING_AGENT_DIR
    ?? "";
}

function parentSessionId(event) {
  const fromEvent = event && typeof event === "object" ? event.sessionId ?? event.session_id : null;
  return process.env.PI_SESSION_ID
    ?? (typeof fromEvent === "string" && fromEvent.length > 0 ? fromEvent : null)
    ?? process.env.PRC_SESSION_ID
    ?? null;
}

function ownerTranscript() {
  // A read-only locator for the host-written transcript.  The identity of the
  // answer still comes from the ask/settlement/answer chain inside the file.
  return process.env.PRC_OWNER_TRANSCRIPT
    ?? process.env.PI_SESSION_FILE
    ?? "";
}

function planPathFromPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  const matches = [...prompt.matchAll(/(?:[A-Za-z]:[\\/])?[^\s"'`]*\.omo[\\/]plans[\\/][^\s"'`]+\.md/gu)]
    .map((match) => match[0]);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

/**
 * The budget may only be lowered by the owner's own request text.  A draft, a
 * parent-session field or a process environment value is not an owner request;
 * when the same body names two different limits the gate refuses instead of
 * guessing.  No token means the documented default of five.
 */
export function parseOwnerLimit(text) {
  if (typeof text !== "string") return { explicit: undefined, source: "default", values: [] };
  // The host wraps the owner's message in <skill-instruction> ... </skill-instruction>
  // <user-request> ... </user-request>.  The skill text contains an example
  // limit; only the user-request section is the owner's own instruction.
  const requestMatch = /<user-request>([\s\S]*?)(?:<\/user-request>|$)/u.exec(text);
  const scope = requestMatch ? requestMatch[1] : text;
  const values = [];
  const patterns = [
    /\breview_round_limit\s*[:=]\s*([1-5])\b/giu,
    /\breview[-_ ]limit\s*[:=]\s*([1-5])\b/giu,
    /\b검토\s*한도\s*[:=]?\s*([1-5])\s*(?:회|번)?/gu,
  ];
  for (const pattern of patterns) {
    for (const match of scope.matchAll(pattern)) values.push({ value: Number(match[1]), token: match[0] });
  }
  const unique = [...new Set(values.map((entry) => entry.value))];
  if (unique.length > 1) {
    return { explicit: undefined, source: "ambiguous", values, ambiguous: true };
  }
  if (unique.length === 1) {
    return { explicit: unique[0], source: "owner-request", values };
  }
  return { explicit: undefined, source: "default", values };
}

function findSessionFile(agentDir, sessionId) {
  if (!agentDir || !sessionId) return null;
  const root = resolve(agentDir, "sessions");
  let found = null;
  const walk = (dir, depth) => {
    if (found || depth > 5) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      if (entry.name.includes(sessionId)) { found = path; return; }
      try {
        const first = readFileSync(path, "utf8").split(/\r?\n/u, 1)[0];
        const parsed = JSON.parse(first);
        if (parsed?.type === "session" && parsed?.id === sessionId) { found = path; return; }
      } catch {
        // A session being written is not the owner request yet.
      }
    }
  };
  walk(root, 0);
  return found;
}

function ownerRequestEvidence({ agentDir, sessionId, planPath, sessionFile = null }) {
  const file = sessionFile ?? findSessionFile(agentDir, sessionId);
  if (!file) return null;
  let lines;
  try { lines = readFileSync(file, "utf8").split(/\r?\n/u); } catch { return null; }
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.flatMap((part) => (part?.type === "text" ? [part.text] : [])).join("\n")
        : "";
    if (!text.includes("/skill:ulw-plan review") && !text.includes(planPath)) continue;
    const limit = parseOwnerLimit(text);
    return {
      source: "owner-session",
      sessionFile: file,
      eventId: createHash("sha256").update(Buffer.from(line, "utf8")).digest("hex"),
      promptSha256: createHash("sha256").update(text, "utf8").digest("hex"),
      lineIndex: index,
      limit,
    };
  }
  return null;
}

function deny(message) {
  logGate({ event: "deny", reason: message });
  return { kind: "deny", message };
}

function denyWithNotice(message, notice) {
  const text = notice ? `${message}\n${notice}` : message;
  logGate({ event: "deny", reason: message, notice: notice ?? null });
  return { kind: "deny", message: text };
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

function noticeFor({ receipt, state, stopReason = null, reviewStatus = null, workspaceRoot = null }) {
  if (!receipt) return null;
  return renderReviewNotice({
    receipt,
    findings: receipt.findings ?? [],
    usage: state ? { U: state.U, B: state.B } : { U: 0, B: 5 },
    childId: receipt.taskId ?? null,
    stopReason: stopReason ?? state?.stopReason ?? null,
    reviewStatus,
    submissionPath: workspaceRoot ? leadSubmissionPath(workspaceRoot) : null,
  });
}

function questionNotice(question) {
  return [
    `[PRC_QUESTION ${question.questionId}] sha256=${question.bodySha256}`,
    question.body,
    `답변: [PRC_ANSWER ${question.questionId} ${question.bodySha256}] yes`,
  ].join("\n");
}

/**
 * A stopped review gets one owner-authorized launch.  The question is created
 * here from the rejected snapshot digest and the live digest; the answer is read
 * only from the host transcript, never from a caller-provided event id.
 */
function tryOwnerResume({ e, state, stateRoot, workspaceId, workspaceRoot, absolute, planSha256, receipt }) {
  const reviewedSha = receipt?.reviewedBodySha256 ?? state.reviewedBodySha256 ?? null;
  const explicitTranscript = ownerTranscript();
  const sessionFile = explicitTranscript || findSessionFile(agentDir(), parentSessionId(e));
  const historicalAnswer = (question) => {
    if (!sessionFile) return null;
    const createdAt = Date.parse(question.createdAt ?? "");
    if (!Number.isFinite(createdAt)) return null;
    const answers = readOwnerAnswers(sessionFile);
    const historical = answers.find((answer) =>
      answer.requestId !== question.questionId
      && answer.requestId !== question.hostRequestId
      && Date.parse(answer.timestamp ?? "") < createdAt) ?? null;
    logGate({
      event: "owner-answer-prehash-check",
      questionId: question.questionId,
      sessionFile,
      answers: answers.length,
      answerTimestamps: answers.map((answer) => answer.timestamp),
      answerRequestIds: answers.map((answer) => answer.requestId),
      createdAt: question.createdAt ?? null,
      historical: historical?.eventId ?? null,
    });
    return historical;
  };
  if (!reviewedSha) {
    return { ok: false, reason: "NO_HASH_BOUND_REVIEW", notice: noticeFor({ receipt, state, workspaceRoot }) };
  }
  const ensured = ensureResumeQuestion({
    root: stateRoot,
    W: state.W,
    stoppedRevision: state.revision,
    reviewedSha,
    currentSha: planSha256,
    reviewedSnapshotRef: state.reviewedSnapshotRef,
    remainingReason: receipt?.status === "CHANGES_REQUESTED" ? "REJECT" : (state.stopReason ?? "STOP"),
    planPath: absolute,
  });
  let question = ensured.question;
  const reviewNotice = noticeFor({ receipt, state, workspaceRoot });
  const withQuestion = (value) => `${value}\n${questionNotice(question)}`;
  if (!question.hostRequestId) {
    const published = publishQuestion({
      root: stateRoot,
      questionId: question.questionId,
      sessionFile,
    });
    if (!published.ok) {
      const historical = historicalAnswer(question);
      if (historical) {
        logGate({ event: "owner-answer-prehash", questionId: question.questionId, answerEventId: historical.eventId, answerTimestamp: historical.timestamp, reason: "RESUME_HASH_NOT_BOUND" });
        return {
          ok: false,
          reason: "RESUME_HASH_NOT_BOUND",
          questionId: question.questionId,
          notice: withQuestion(reviewNotice ?? ""),
        };
      }
      logGate({ event: "owner-question-missing", questionId: question.questionId, reason: published.reason });
      return {
        ok: false,
        reason: `OWNER_QUESTION_${published.reason}`,
        questionId: question.questionId,
        notice: withQuestion(reviewNotice ?? ""),
      };
    }
    question = readQuestion(stateRoot, question.questionId);
  }
  if (!question.answerEventId) {
    const bound = bindOwnerAnswer({
      root: stateRoot,
      questionId: question.questionId,
      sessionFile,
    });
    if (!bound.ok) {
      const historical = historicalAnswer(question);
      if (historical) {
        logGate({ event: "owner-answer-prehash", questionId: question.questionId, answerEventId: historical.eventId, answerTimestamp: historical.timestamp, reason: "RESUME_HASH_NOT_BOUND" });
        return {
          ok: false,
          reason: "RESUME_HASH_NOT_BOUND",
          questionId: question.questionId,
          notice: withQuestion(reviewNotice ?? ""),
        };
      }
      logGate({ event: "owner-answer-missing", questionId: question.questionId, reason: bound.reason });
      return {
        ok: false,
        reason: `OWNER_ANSWER_${bound.reason}`,
        questionId: question.questionId,
        notice: withQuestion(reviewNotice ?? ""),
      };
    }
    question = readQuestion(stateRoot, question.questionId);
  }
  const launchKey = `${parentSessionId(e) ?? "host"}:${state.revision}:manual:${planSha256}`;
  let manualSnapshot;
  try {
    manualSnapshot = captureReviewedSnapshot({
      stateRoot,
      planPath: absolute,
      planBytes: readFileSync(absolute),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "OWNER_SNAPSHOT_FAILED",
      questionId: question.questionId,
      notice: withQuestion(reviewNotice ?? ""),
    };
  }
  if (manualSnapshot.reviewedBodySha256 !== planSha256) {
    return {
      ok: false,
      reason: "OWNER_SNAPSHOT_DRIFT",
      questionId: question.questionId,
      notice: withQuestion(reviewNotice ?? ""),
    };
  }
  const manual = reserveManual({
    root: stateRoot,
    questionId: question.questionId,
    eventId: question.answerEventId,
    workspaceId,
    workspaceRoot,
    planPath: absolute,
    planSha256,
    roundNo: (state.roundNo ?? 0) + 1,
    launchKey,
    expectedRevision: state.revision,
    reviewedBodySha256: manualSnapshot.reviewedBodySha256,
    reviewedSnapshotRef: manualSnapshot.reviewedSnapshotRef,
  });
  if (!manual.ok) {
    logGate({ event: "manual-denied", reason: manual.reason, questionId: question.questionId });
    return {
      ok: false,
      reason: manual.reason,
      questionId: question.questionId,
      notice: withQuestion(reviewNotice ?? ""),
    };
  }
  logGate({
    event: "allow-manual",
    questionId: question.questionId,
    answerEventId: question.answerEventId,
    launchKey,
    reviewedSha,
    currentSha: planSha256,
  });
  return { ok: true, question, launchKey };
}

export function gate(e, t, n, r) {
  logGate({ event: "entry", agent: String(t).slice(0, 100), input: String(n).slice(0, 300) });
  logGate({
    event: "context",
    keys: e && typeof e === "object" ? Object.keys(e).slice(0, 40) : [],
    uiNotify: typeof e?.ui?.notify,
    uiQuestion: typeof e?.ui?.question,
    sessionManager: typeof e?.sessionManager,
    sessionFile: process.env.PI_SESSION_FILE ?? null,
    ownerTranscript: process.env.PRC_OWNER_TRANSCRIPT ?? null,
    managerKeys: e?.manager && typeof e.manager === "object" ? Object.keys(e.manager).slice(0, 60) : [],
  });
  if (!REVIEW_ROLES.has(String(t))) return undefined;
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

  let planBytes;
  let planSha256;
  try {
    planBytes = readFileSync(absolute);
    planSha256 = createHash("sha256").update(planBytes).digest("hex");
  } catch {
    return deny("PRC_PLAN_UNREADABLE");
  }

  const sessionId = parentSessionId(e);
  let request = ownerRequestEvidence({
    agentDir: agentDir(),
    sessionId,
    planPath: absolute,
  });
  if (!request) {
    // A fresh host turn may not carry the original planning request in its own
    // transcript.  The explicit owner transcript is a host-written file; its
    // request row is still the owner's own instruction, never an agent claim.
    const transcript = ownerTranscript();
    if (transcript) {
      request = ownerRequestEvidence({ planPath: absolute, sessionFile: transcript });
    }
  }
  if (!request) return deny("PRC_OWNER_REQUEST_MISSING");

  let budget;
  try {
    budget = resolveBudget(request.limit?.explicit);
  } catch (error) {
    logGate({ event: "budget-invalid", limit: request.limit ?? null, error: String(error?.message ?? error) });
    return deny("PRC_BUDGET_INVALID");
  }
  if (request.limit?.ambiguous) return deny("PRC_BUDGET_AMBIGUOUS");

  let key;
  try {
    key = logicalKey({ workspaceId, workspaceRoot, planPath: absolute }).key;
  } catch {
    return deny("PRC_KEY_INVALID");
  }

  const initialized = initialize({
    root: stateRoot,
    workspaceId,
    workspaceRoot,
    planPath: absolute,
    planSha256,
    explicitLimit: budget,
    firstRequest: request,
    anchorRoot: resolve(workspaceRoot, ".omo", "plan-review-convergence"),
  });
  if (!initialized.ok) return deny(`PRC_${initialized.reason}`);

  let state = readState(stateRoot, key);
  if (!state) return deny("PRC_STATE_MISSING");

  // Bind the previous reservation to its host task record before judging a new
  // launch.  This is the real caller of bindReceipt: no harness completes a
  // round on the host's behalf.
  let round = null;
  if (state.launchKey && state.reviewedSnapshotRef) {
    round = resolveReviewRound({
      agentDir: agentDir(),
      stateRoot,
      state,
      planPath: absolute,
      currentSha: planSha256,
      parentSessionId: sessionId,
      workspaceRoot,
    });
    logGate({
      event: round.ok ? "receipt" : "receipt-missing",
      reason: round.ok ? null : round.reason,
      taskId: round.ok ? round.record.task_id : null,
      receiptStatus: round.ok ? round.receipt.status : null,
      receiptReason: round.ok ? round.receipt.reason : null,
      reviewedBodySha256: round.ok ? round.receipt.reviewedBodySha256 : null,
    });
    const refreshed = readState(stateRoot, key);
    if (refreshed) state = refreshed;
  }
  const receipt = round?.ok
    ? round.receipt
    : persistedReceipt({ stateRoot, launchKey: state.launchKey });
  const notice = noticeFor({ receipt, state, workspaceRoot });

  if (state.status === "stop-unknown") {
    return denyWithNotice("PRC_STOPPED", notice);
  }
  if (receipt && receipt.status === "INCONCLUSIVE") {
    return denyWithNotice(`PRC_NO_APPROVAL_${receipt.reason ?? "INCONCLUSIVE"}`, notice);
  }
  if (receipt && receipt.status === "APPROVED" && receipt.reviewedBodySha256 === planSha256) {
    // The same bytes are already approved; a second reviewer would only consume
    // budget without new evidence.  A changed plan falls through to the normal
    // reservation path.
    return denyWithNotice("PRC_ALREADY_APPROVED", notice);
  }

  const stoppedExplicitly = state.status === "stopped";
  const rejected = receipt?.status === "CHANGES_REQUESTED" && receipt.verdict === "REJECT";
  const ledger = round?.ok ? round.ledger : loadConvergenceLedger({ stateRoot, W: state.W });
  const rounds = Array.isArray(ledger?.rounds) ? ledger.rounds : [];
  const reservedRound = rounds.length >= 2 ? rounds.at(-2) : null;
  const newerReservation = Boolean(
    receipt
    && state.reviewedBodySha256
    && receipt.reviewedBodySha256 !== state.reviewedBodySha256,
  );
  let progress = null;
  if (receipt) {
    const boundTo = {
      W: state.W,
      reservedTaskId: reservedRound?.taskId ?? null,
      nextTaskId: receipt.taskId ?? null,
      reservedSha: reservedRound?.snapshotSha256 ?? null,
      nextSha: receipt.reviewedBodySha256 ?? null,
      rounds: rounds.length,
    };
    if (newerReservation) {
      progress = { allow: false, reason: "NO_REVIEW_RESULT", boundTo };
    } else if (rounds.length >= 2) {
      const reserved = reservedRound
        ? {
          status: "CHANGES_REQUESTED",
          verdict: "REJECT",
          W: state.W,
          findings: Array.isArray(reservedRound.findings) ? reservedRound.findings : [],
        }
        : null;
      const outcome = nextRoundProgress({ reserved, next: receipt, W: state.W });
      progress = { ...outcome, boundTo: { ...boundTo, reservedKeys: outcome.reservedKeys ?? null, nextKeys: outcome.nextKeys ?? null, sameKeys: outcome.sameKeys ?? null } };
    } else {
      // No next-round review result is bound yet.  A new review must not be
      // launched and the automatic budget must not be charged until that
      // result exists; the owner can authorize the next review manually.
      progress = { allow: false, reason: "NO_REVIEW_RESULT", boundTo: { ...boundTo, reservedKeys: null, nextKeys: null, sameKeys: null } };
    }
  }

  // Explicit stops and a rejection without a verified fix need the owner.
  // A rejected (or inconclusive) manual round is terminal for the automatic
  // budget: the one owner-authorized review was the last attempt.
  const manualRoundRejected = state.lastKind === "manual"
    && receipt
    && receipt.status !== "APPROVED"
    && state.status !== "stopped"
    && !progress?.allow;
  if (manualRoundRejected) {
    logGate({ event: "manual-rejected", status: receipt.status, reason: receipt.reason ?? null });
    return denyWithNotice(
      `PRC_MANUAL_${receipt.status === "CHANGES_REQUESTED" ? "REJECTED" : "INCONCLUSIVE"}_AUTO_BLOCKED`,
      notice,
    );
  }
  if (stoppedExplicitly) {
    const resumed = tryOwnerResume({
      e, state, stateRoot, workspaceId, workspaceRoot, absolute, planSha256, receipt,
    });
    if (resumed.ok) return undefined;
    return denyWithNotice(`PRC_STOPPED_${resumed.reason}`, resumed.notice ?? notice);
  }
  if (rejected && !progress.allow) {
    const resumed = tryOwnerResume({
      e, state, stateRoot, workspaceId, workspaceRoot, absolute, planSha256, receipt,
    });
    if (resumed.ok) return undefined;
    logGate({ event: "no-progress", reason: progress.reason, boundTo: progress.boundTo });
    const code = progress.reason === "NO_REVIEW_RESULT"
      ? "PRC_NO_REVIEW_RESULT"
      : progress.reason === "SAME_BLOCKER"
        ? "PRC_NO_PROGRESS_SAME_BLOCKER"
        : resumed.reason === "RESUME_HASH_NOT_BOUND"
          ? "PRC_NO_PROGRESS_RESUME_HASH_NOT_BOUND"
          : `PRC_NO_PROGRESS_${progress.reason}`;
    return denyWithNotice(code, resumed.notice ?? notice);
  }
  if (rejected && progress.allow) {
    logGate({ event: "progress", reason: progress.reason, boundTo: progress.boundTo });
  }

  if (state.autoUsed >= state.B) {
    const resumed = tryOwnerResume({
      e, state, stateRoot, workspaceId, workspaceRoot, absolute, planSha256, receipt,
    });
    if (resumed.ok) return undefined;
    return denyWithNotice(`PRC_BUDGET_EXHAUSTED_${resumed.reason}`, resumed.notice ?? notice);
  }

  if (state.autoUsed >= 1 && !progress?.allow) {
    const resumed = tryOwnerResume({
      e, state, stateRoot, workspaceId, workspaceRoot, absolute, planSha256, receipt,
    });
    if (resumed.ok) return undefined;
    const reason = progress?.reason === "NO_REVIEW_RESULT"
      ? "PRC_NO_REVIEW_RESULT"
      : resumed.reason === "RESUME_HASH_NOT_BOUND"
        ? "PRC_NO_PROGRESS_RESUME_HASH_NOT_BOUND"
        : `PRC_NO_PROGRESS_${progress?.reason ?? "NO_BOUND_RECEIPT"}`;
    return denyWithNotice(reason, resumed.notice ?? notice);
  }

  let snapshot;
  try {
    snapshot = captureReviewedSnapshot({ stateRoot, planPath: absolute, planBytes });
  } catch (error) {
    return deny(`PRC_SNAPSHOT_${error instanceof Error ? error.message : "FAILED"}`);
  }
  const launchKey = `${sessionId ?? "host"}:${state.revision}:${planSha256}`;
  const result = reserve({
    root: stateRoot,
    workspaceId,
    workspaceRoot,
    planPath: absolute,
    planSha256,
    roundNo: (state.roundNo ?? 0) + 1,
    launchKey,
    expectedRevision: state.revision,
    reviewedBodySha256: snapshot.reviewedBodySha256,
    reviewedSnapshotRef: snapshot.reviewedSnapshotRef,
  });
  if (!result.ok) {
    logGate({ event: "reserve-denied", reason: result.reason, launchKey });
    return denyWithNotice(`PRC_${result.reason}`, notice);
  }
  logGate({
    event: "allow",
    key,
    launchKey,
    roundNo: result.state.roundNo,
    reviewedBodySha256: snapshot.reviewedBodySha256,
  });
  return undefined;
}

export function handoff(e, t, n, r) {
  if (REVIEW_ROLES.has(String(t))) return undefined;
  const prompt = typeof n === "string"
    ? n
    : n && typeof n === "object" && typeof n.prompt === "string"
      ? n.prompt
      : "";
  if (!prompt || !EXECUTOR_PROMPT.test(prompt)) return undefined;
  const planPath = planPathFromPrompt(prompt);
  if (!planPath) return undefined;
  const stateRoot = process.env.PRC_STATE_ROOT;
  if (!stateRoot) return undefined;
  const workspaceRoot = resolve(process.env.PRC_WORKSPACE_ROOT ?? process.cwd());
  const workspaceId = process.env.PRC_WORKSPACE_ID ?? workspaceRoot;
  const absolute = resolve(workspaceRoot, planPath);
  let currentSha;
  try {
    currentSha = sha256File(absolute);
  } catch {
    return undefined;
  }
  let state;
  try {
    const key = logicalKey({ workspaceId, workspaceRoot, planPath: absolute }).key;
    state = readState(stateRoot, key);
  } catch {
    state = null;
  }
  const status = resolveHandoff({
    agentDir: agentDir(),
    stateRoot,
    state,
    planPath: absolute,
    currentSha,
    parentSessionId: parentSessionId(e),
    workspaceRoot,
  });
  logGate({
    event: "handoff",
    status: status.reviewStatus,
    reason: status.reason ?? null,
    receipt: status.receiptId ?? null,
    taskId: status.receipt?.taskId ?? null,
    reviewedBodySha256: status.receipt?.reviewedBodySha256 ?? null,
    currentSha,
  });
  const ownerNotice = status.receipt
    ? noticeFor({ receipt: status.receipt, state, reviewStatus: status.reviewStatus, workspaceRoot })
    : null;
  const notice = handoffNotice(status, absolute);
  const body = ownerNotice ? `${ownerNotice}\n${notice}` : notice;
  return typeof n === "string" ? `${body}\n${n}` : { ...n, prompt: `${body}\n${n.prompt}` };
}
