import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { logicalKey, readState, reserve } from "./state.mjs";

export const QUESTION_SCHEMA = "plan-review-convergence/resume-question/v1";
export const ANSWER_FRAME = /^\[Answer to question ([^\]\n]+)\]/u;
const PRC_ANSWER_FRAME = /^\[PRC_ANSWER\s+(\S+)\s+([0-9a-f]{64})\]\s*(.*)$/u;
const APPROVAL_INTENT = /^(?:yes|y|승인|네|예|동의)$/iu;
const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 5000;

/**
 * A chat answer authorizes one review only when it is the owner's own explicit
 * approval: the frame starts the message, names this question and this body
 * digest, and is followed by an approval token.  A quoted copy, a code fence, a
 * "no" answer or an answer without a token is not an approval.
 */
export function parsePrcAnswer(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/^\uFEFF/u, "").replace(/^\s+/u, "");
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith(">") || trimmed.startsWith("```")) return null;
  const lines = trimmed.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const first = lines[0]?.trim() ?? "";
  const match = PRC_ANSWER_FRAME.exec(first);
  if (!match) return null;
  if (!APPROVAL_INTENT.test(match[3].trim())) return null;
  if ((trimmed.match(/\[PRC_ANSWER\s/gu) ?? []).length !== 1) return null;
  return { requestId: match[1], bodySha256: match[2], intent: match[3].trim().toLowerCase(), line: first };
}

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

/**
 * Answers the host itself recorded.  A line only counts when the transcript
 * holds all three host entries for one request:
 *   custom ask-user:question -> custom ask-user:settlement(answer) ->
 *   user message with inputSource "extension" framed "[Answer to question <id>]".
 * A message an agent writes into a file, an env-provided id, or a bare "owner"
 * label cannot satisfy that chain.
 */
export function readOwnerAnswers(sessionFile) {
  if (typeof sessionFile !== "string" || sessionFile.length === 0) return [];
  let bytes;
  try {
    bytes = readFileSync(sessionFile);
  } catch {
    return [];
  }
  const sessionSha256 = sha256Bytes(bytes);
  const lines = bytes.toString("utf8").split(/\r?\n/u);
  const questions = new Map();
  const settlements = new Map();
  const answers = [];
  lines.forEach((line, index) => {
    if (line.trim().length === 0) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (entry?.type === "custom" && entry.customType === "ask-user:question") {
      const requestId = entry.data?.requestId;
      if (typeof requestId === "string") {
        questions.set(requestId, {
          requestId,
          headers: Array.isArray(entry.data?.headers) ? entry.data.headers : [],
          lineIndex: index,
          timestamp: entry.timestamp ?? null,
        });
      }
      return;
    }
    if (entry?.type === "custom" && entry.customType === "ask-user:settlement") {
      const requestId = entry.data?.requestId;
      if (typeof requestId === "string") {
        settlements.set(requestId, {
          status: String(entry.data?.status ?? ""),
          lineIndex: index,
        });
      }
      return;
    }
    if (entry?.type !== "message" || entry.message?.role !== "user") return;
    if (entry.inputSource !== "extension") return;
    const content = entry.message.content;
    const texts = typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content.flatMap((part) => (part?.type === "text" ? [part.text] : []))
        : [];
    for (const text of texts) {
      const frame = ANSWER_FRAME.exec(String(text));
      if (!frame) continue;
      const requestId = frame[1].trim();
      answers.push({
        requestId,
        text: String(text),
        eventId: sha256Bytes(Buffer.from(line, "utf8")),
        lineIndex: index,
        timestamp: entry.timestamp ?? null,
        inputSource: entry.inputSource,
        sessionSha256,
      });
    }
  });
  return answers
    .filter((answer) => {
      const question = questions.get(answer.requestId);
      const settlement = settlements.get(answer.requestId);
      return Boolean(
        question
        && settlement
        && settlement.status === "answered"
        && question.lineIndex < settlement.lineIndex
        && question.lineIndex < answer.lineIndex
        && settlement.lineIndex < answer.lineIndex,
      );
    })
    .map((answer) => ({
      ...answer,
      headers: questions.get(answer.requestId).headers,
      questionLineIndex: questions.get(answer.requestId).lineIndex,
      questionTimestamp: questions.get(answer.requestId).timestamp,
    }))
    .sort((left, right) => left.lineIndex - right.lineIndex);
}

export function latestOwnerAnswer(sessionFile) {
  return readOwnerAnswers(sessionFile).at(-1) ?? null;
}

export function createQuestion({
  root,
  questionId = `q_${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 24)}`,
  W,
  stoppedRevision,
  reviewedSha,
  currentSha,
  reviewedSnapshotRef = null,
  remainingReason,
  planPath,
}) {
  const hashBound = Boolean(reviewedSha && currentSha);
  const body = `[PRC_QUESTION ${questionId}] resume ${reviewedSha ?? "-"} -> ${currentSha ?? "-"}`;
  const bodySha256 = sha256Bytes(Buffer.from(body, "utf8"));
  const question = {
    schema: QUESTION_SCHEMA,
    questionId,
    header: `PRC${bodySha256.slice(0, 8)}`,
    body,
    bodySha256,
    createdAt: new Date().toISOString(),
    W,
    stoppedRevision,
    reviewedSha: reviewedSha ?? null,
    currentSha: currentSha ?? null,
    reviewedSnapshotRef,
    hashBound,
    remainingReason: remainingReason ?? null,
    planPath: planPath ?? null,
    scope: "one_review",
    status: "open",
    hostRequestId: null,
    hostQuestionEventId: null,
    hostQuestionKind: null,
    hostQuestionLineIndex: null,
    publishedAt: null,
    answerEventId: null,
    answerSource: null,
    answerSessionSha256: null,
    answeredAt: null,
    consumedAt: null,
    launchKey: null,
  };
  mkdirSync(questionDir(root), { recursive: true });
  writeFileSync(questionPath(root, questionId), `${JSON.stringify(question)}\n`, { flag: "wx" });
  return question;
}

/**
 * One open hash-bound question per stopped revision.  The id is derived from the
 * stop boundary, so two gate invocations (or a restart) cannot create a second
 * question for the same stop.
 */
export function ensureResumeQuestion({
  root,
  W,
  stoppedRevision,
  reviewedSha,
  currentSha,
  reviewedSnapshotRef = null,
  remainingReason,
  planPath,
}) {
  const questionId = `q_${createHash("sha256")
    .update([W, stoppedRevision, reviewedSha ?? "-", currentSha ?? "-", remainingReason ?? "-"].join("|"))
    .digest("hex")
    .slice(0, 24)}`;
  return withQuestionLock(root, questionId, () => {
    const existing = readQuestion(root, questionId);
    if (existing) return { question: existing, created: false };
    return {
      question: createQuestion({
        root,
        questionId,
        W,
        stoppedRevision,
        reviewedSha,
        currentSha,
        reviewedSnapshotRef,
        remainingReason,
        planPath,
      }),
      created: true,
    };
  });
}

function entryText(entry) {
  const content = entry?.message?.content;
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.flatMap((part) => (part?.type === "text" ? [part.text] : [])).join("\n")
      : "";
}

/**
 * Bind the newest host-recorded owner answer to a question.  Nothing the caller
 * passes can name the answer event; it is taken from the transcript bytes.
 */
export function publishQuestion({ root, questionId, sessionFile }) {
  return withQuestionLock(root, questionId, () => {
    const question = readQuestion(root, questionId);
    if (!question) return { ok: false, reason: "QUESTION_NOT_FOUND" };
    if (question.hostRequestId) return { ok: true, question, created: false };
    if (typeof sessionFile !== "string" || sessionFile.length === 0) {
      return { ok: false, reason: "QUESTION_NOT_PUBLISHED" };
    }
    let lines;
    try { lines = readFileSync(sessionFile, "utf8").split(/\r?\n/u); } catch {
      return { ok: false, reason: "QUESTION_NOT_PUBLISHED" };
    }
    const matches = [];
    for (const [index, line] of lines.entries()) {
      if (!line.includes("ask-user:question")) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.type !== "custom" || entry.customType !== "ask-user:question") continue;
      const headers = Array.isArray(entry.data?.headers) ? entry.data.headers : [];
      if (!headers.includes(question.header)) continue;
      if (Date.parse(entry.timestamp ?? "") < Date.parse(question.createdAt)) continue;
      matches.push({
        kind: "ask-user",
        requestId: entry.data?.requestId ?? null,
        eventId: sha256Bytes(Buffer.from(line, "utf8")),
        lineIndex: index,
      });
    }
    if (matches.length === 0) {
      for (const [index, line] of lines.entries()) {
        if (!line.includes("[PRC_QUESTION")) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
        const text = entryText(entry);
        if (!text.includes(`[PRC_QUESTION ${question.questionId}]`)) continue;
        if (!text.includes(`sha256=${question.bodySha256}`)) continue;
        if (Date.parse(entry.timestamp ?? "") < Date.parse(question.createdAt)) continue;
        matches.push({
          kind: "chat",
          requestId: typeof entry.id === "string" ? entry.id : sha256Bytes(Buffer.from(line, "utf8")),
          eventId: sha256Bytes(Buffer.from(line, "utf8")),
          lineIndex: index,
        });
      }
    }
    if (matches.length === 0) {
      // The gate's own deny message is written by the host as a tool result.
      // That is a host row, not an agent's copied text, and it is the first
      // place the question becomes visible to the owner.
      for (const [index, line] of lines.entries()) {
        if (!line.includes("[PRC_QUESTION")) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry?.type !== "message" || entry.message?.role !== "toolResult") continue;
        const text = entryText(entry);
        if (!text.includes(`[PRC_QUESTION ${question.questionId}]`)) continue;
        if (!text.includes(`sha256=${question.bodySha256}`)) continue;
        if (Date.parse(entry.timestamp ?? "") < Date.parse(question.createdAt)) continue;
        matches.push({
          kind: "chat",
          requestId: typeof entry.message?.toolCallId === "string"
            ? entry.message.toolCallId
            : sha256Bytes(Buffer.from(line, "utf8")),
          eventId: sha256Bytes(Buffer.from(line, "utf8")),
          lineIndex: index,
        });
      }
    }
    if (matches.length !== 1) return { ok: false, reason: "QUESTION_NOT_PUBLISHED", matches: matches.length };
    const [match] = matches;
    question.hostRequestId = match.requestId;
    question.hostQuestionEventId = match.eventId;
    question.hostQuestionKind = match.kind;
    question.hostQuestionLineIndex = match.lineIndex;
    question.publishedAt = new Date().toISOString();
    writeQuestion(root, question);
    return { ok: true, question, created: true };
  });
}

/**
 * Bind the newest host-recorded owner answer to a question.  Nothing the caller
 * passes can name the answer event; it is taken from the transcript bytes.
 */
export function bindOwnerAnswer({ root, questionId, sessionFile, expectedHeader = null }) {
  return withQuestionLock(root, questionId, () => {
    const question = readQuestion(root, questionId);
    if (!question) return { ok: false, reason: "QUESTION_NOT_FOUND" };
    if (question.status === "consumed") return { ok: false, reason: "ALREADY_CONSUMED" };
    if (!question.hostRequestId) return { ok: false, reason: "QUESTION_NOT_PUBLISHED" };
    const answers = readOwnerAnswers(sessionFile)
      .filter((answer) => answer.requestId === question.hostRequestId)
      .filter((answer) => answer.headers.includes(question.header));
    const answer = answers.at(-1);
    if (!answer) {
      if (question.hostQuestionKind === "chat") {
        let lines;
        try { lines = readFileSync(sessionFile, "utf8").split(/\r?\n/u); } catch {
          return { ok: false, reason: "OWNER_ANSWER_MISSING" };
        }
        const frame = `[PRC_ANSWER ${question.questionId} ${question.bodySha256}]`;
        for (let index = lines.length - 1; index > (question.hostQuestionLineIndex ?? -1); index -= 1) {
          let entry;
          try { entry = JSON.parse(lines[index]); } catch { continue; }
          if (entry?.type !== "message" || entry.message?.role !== "user") continue;
          const text = entryText(entry);
          const parsed = parsePrcAnswer(text);
          if (!parsed) continue;
          if (parsed.requestId !== question.questionId || parsed.bodySha256 !== question.bodySha256) continue;
          const timestamp = Date.parse(entry.timestamp ?? "");
          const questionCreated = Date.parse(question.createdAt ?? "");
          if (!Number.isFinite(timestamp) || !Number.isFinite(questionCreated) || timestamp < questionCreated) {
            return { ok: false, reason: "RESUME_HASH_NOT_BOUND" };
          }
          const eventId = sha256Bytes(Buffer.from(lines[index], "utf8"));
          if (question.answerEventId && question.answerEventId !== eventId) {
            return { ok: false, reason: "BOUND_TO_OTHER_EVENT" };
          }
          question.answerEventId = eventId;
          question.answerSource = "owner-chat";
          question.answerSessionSha256 = sha256Bytes(Buffer.from(lines.join("\n"), "utf8"));
          question.status = "answered";
          question.answeredAt = new Date().toISOString();
          writeQuestion(root, question);
          return { ok: true, question, answer: { eventId, requestId: question.hostRequestId, text: frame, inputSource: "owner-chat" } };
        }
      }
      return { ok: false, reason: "OWNER_ANSWER_MISSING" };
    }
    if (expectedHeader && !answer.headers.includes(expectedHeader)) {
      return { ok: false, reason: "OWNER_ANSWER_HEADER_MISMATCH" };
    }
    const answeredAtMs = Date.parse(answer.timestamp ?? "");
    const createdAtMs = Date.parse(question.createdAt ?? "");
    if (!Number.isFinite(answeredAtMs) || !Number.isFinite(createdAtMs) || answeredAtMs < createdAtMs) {
      return { ok: false, reason: "RESUME_HASH_NOT_BOUND" };
    }
    if (question.answerEventId && question.answerEventId !== answer.eventId) {
      return { ok: false, reason: "BOUND_TO_OTHER_EVENT" };
    }
    question.hostRequestId = answer.requestId;
    question.answerEventId = answer.eventId;
    question.answerSource = "host-transcript";
    question.answerSessionSha256 = answer.sessionSha256;
    question.status = "answered";
    question.answeredAt = new Date().toISOString();
    writeQuestion(root, question);
    return { ok: true, question, answer };
  });
}

export function usedAnswerEventIds(root, { except = null } = {}) {
  const ids = new Set();
  const dir = questionDir(root);
  if (!existsSync(dir)) return ids;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    if (except && name === `${except}.json`) continue;
    try {
      const question = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (question.answerEventId) ids.add(question.answerEventId);
    } catch {
      // A partial question file cannot authorize a launch.
    }
  }
  return ids;
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
  expectedRevision,
  reviewedBodySha256 = null,
  reviewedSnapshotRef = null,
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
    if (!question.answerEventId) return { ok: false, reason: "NOT_BOUND" };
    if (question.answerEventId !== eventId) return { ok: false, reason: "NOT_BOUND" };
    if (question.answerSource !== "host-transcript" && question.answerSource !== "owner-chat") return { ok: false, reason: "NOT_OWNER_EVENT" };
    if (!question.answeredAt) return { ok: false, reason: "RESUME_HASH_NOT_BOUND" };
    if (Date.parse(question.answeredAt) < Date.parse(question.createdAt)) {
      return { ok: false, reason: "RESUME_HASH_NOT_BOUND" };
    }
    if (question.scope !== "one_review") return { ok: false, reason: "SCOPE_INVALID" };
    if (question.reviewedSha === question.currentSha) {
      return { ok: false, reason: "NO_NEW_REVISION" };
    }
    if (question.currentSha !== planSha256) {
      return { ok: false, reason: "HASH_DRIFT" };
    }
    if (reviewedBodySha256 && reviewedBodySha256 !== planSha256) {
      return { ok: false, reason: "REVIEW_SNAPSHOT_DRIFT" };
    }
    if (usedAnswerEventIds(root, { except: questionId }).has(eventId)) {
      // A host answer authorizes one review; a later stop needs a new answer.
      return { ok: false, reason: "OWNER_EVENT_REUSED" };
    }
    const state = readState(root, key);
    if (!state) return { ok: false, reason: "NO_STATE" };
    if (state.status === "stop-unknown") return { ok: false, reason: "STATE_STOPPED" };
    if (state.revision !== question.stoppedRevision) {
      return { ok: false, reason: "STOP_REVISION_MISMATCH" };
    }
    if (Number.isInteger(expectedRevision) && state.revision !== expectedRevision) {
      return { ok: false, reason: "REVISION_MISMATCH" };
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
      expectedRevision: state.revision,
      reviewedBodySha256: reviewedBodySha256 ?? question.currentSha,
      reviewedSnapshotRef: reviewedSnapshotRef ?? question.reviewedSnapshotRef,
    });
    if (!result.ok) return result;
    question.status = "consumed";
    question.consumedAt = new Date().toISOString();
    question.launchKey = launchKey;
    writeQuestion(root, question);
    return { ok: true, question, state: result.state };
  });
}
