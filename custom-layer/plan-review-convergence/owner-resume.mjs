import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { logicalKey, readState, reserve } from "./state.mjs";

export const QUESTION_SCHEMA = "plan-review-convergence/resume-question/v1";
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function freezeRevision(planPath) {
  const bytes = readFileSync(planPath);
  return { reviewedSha: sha256Bytes(bytes), bytes: bytes.length };
}

function questionDir(root) {
  return join(root, "resume-questions");
}

function questionPath(root, questionId) {
  return join(questionDir(root), `${questionId}.json`);
}

export function readQuestion(root, questionId) {
  try {
    return JSON.parse(readFileSync(questionPath(root, questionId), "utf8"));
  } catch {
    return null;
  }
}

function writeQuestion(root, question) {
  mkdirSync(questionDir(root), { recursive: true });
  writeFileSync(questionPath(root, question.questionId), `${JSON.stringify(question)}\n`, "utf8");
  return question;
}

function withQuestionLock(root, questionId, fn) {
  mkdirSync(questionDir(root), { recursive: true });
  const lockPath = join(questionDir(root), `${questionId}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd;
  for (;;) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() > deadline) throw new Error("LOCK_TIMEOUT");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

export function createQuestion({
  root,
  questionId = randomUUID(),
  W,
  stoppedRevision,
  reviewedSha,
  currentSha,
  remainingReason,
  planPath,
}) {
  const hashBound = Boolean(reviewedSha && currentSha);
  const question = {
    schema: QUESTION_SCHEMA,
    questionId,
    W,
    stoppedRevision,
    reviewedSha: reviewedSha ?? null,
    currentSha: currentSha ?? null,
    hashBound,
    remainingReason: remainingReason ?? null,
    planPath: planPath ?? null,
    scope: "one_review",
    status: "open",
    answerEventId: null,
    answerSource: null,
    answeredAt: null,
    consumedAt: null,
    launchKey: null,
  };
  mkdirSync(questionDir(root), { recursive: true });
  writeFileSync(questionPath(root, questionId), `${JSON.stringify(question)}\n`, { flag: "wx" });
  return question;
}

export function bindAnswer({ root, questionId, eventId, source = "owner" }) {
  if (typeof eventId !== "string" || eventId.length === 0) {
    return { ok: false, reason: "OWNER_EVENT_REQUIRED" };
  }
  if (source !== "owner") {
    return { ok: false, reason: "NOT_OWNER_EVENT" };
  }
  return withQuestionLock(root, questionId, () => {
    const question = readQuestion(root, questionId);
    if (!question) return { ok: false, reason: "QUESTION_NOT_FOUND" };
    if (question.status === "consumed") return { ok: false, reason: "ALREADY_CONSUMED" };
    if (question.answerEventId && question.answerEventId !== eventId) {
      return { ok: false, reason: "BOUND_TO_OTHER_EVENT" };
    }
    question.answerEventId = eventId;
    question.answerSource = source;
    question.status = "answered";
    question.answeredAt = new Date().toISOString();
    writeQuestion(root, question);
    return { ok: true, question };
  });
}

export function reserveManual({
  root,
  questionId,
  eventId,
  workspaceId,
  workspaceRoot,
  planPath,
  cwd,
  planSha256,
  roundNo,
  launchKey,
}) {
  const { key } = logicalKey({ workspaceId, workspaceRoot, planPath, cwd });
  return withQuestionLock(root, questionId, () => {
    const question = readQuestion(root, questionId);
    if (!question) return { ok: false, reason: "QUESTION_NOT_FOUND" };
    if (question.status === "consumed") return { ok: false, reason: "ALREADY_CONSUMED" };
    if (!question.hashBound || !question.reviewedSha || !question.currentSha) {
      return { ok: false, reason: "RESUME_HASH_NOT_BOUND" };
    }
    if (question.W !== key) return { ok: false, reason: "WORKSPACE_MISMATCH" };
    if (question.answerEventId !== eventId) return { ok: false, reason: "NOT_BOUND" };
    if (question.scope !== "one_review") return { ok: false, reason: "SCOPE_INVALID" };
    if (question.reviewedSha === question.currentSha) {
      return { ok: false, reason: "NO_NEW_REVISION" };
    }
    if (question.currentSha !== planSha256) {
      return { ok: false, reason: "HASH_DRIFT" };
    }
    const state = readState(root, key);
    if (!state) return { ok: false, reason: "NO_STATE" };
    if (state.status === "stop-unknown") return { ok: false, reason: "STATE_STOPPED" };
    if (state.revision !== question.stoppedRevision) {
      return { ok: false, reason: "STOP_REVISION_MISMATCH" };
    }
    if (state.status === "reserved" && !state.childReceiptId) {
      return { ok: false, reason: "UNRESOLVED_LAUNCH" };
    }
    const result = reserve({
      root,
      workspaceId,
      workspaceRoot,
      planPath,
      cwd,
      planSha256,
      roundNo,
      launchKey,
      kind: "manual",
      ownerEventId: eventId,
      allowStopped: true,
    });
    if (!result.ok) return result;
    question.status = "consumed";
    question.consumedAt = new Date().toISOString();
    question.launchKey = launchKey;
    writeQuestion(root, question);
    return { ok: true, question, state: result.state };
  });
}
