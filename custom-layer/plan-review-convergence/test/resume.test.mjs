import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { complete, initialize, logicalKey, markStop, readState, reserve } from "../state.mjs";
import {
  bindOwnerAnswer,
  createQuestion,
  ensureResumeQuestion,
  freezeRevision,
  publishQuestion,
  readOwnerAnswers,
  readQuestion,
  reserveManual,
  sha256Bytes,
} from "../owner-resume.mjs";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "helpers", "resume-worker.mjs");
const OWNER_TRANSCRIPT = "C:/Users/USER/.omo-stable-500/home/.omo/agent/sessions/--C--Users-USER-orca-projects-기타 작업--/2026-11-22T05-32-10-795Z_01a201bd-92ab-701c-a7d8-3524549cf8f0.jsonl";
const OWNER_TRANSCRIPT_SHA256 = "2607995b00b0236849062f8723d27c5d7163f5bb438a063cbe379dd9b8f5a051";

function base(t) {
  const root = mkdtempSync(join(tmpdir(), "prc-resume-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const planPath = join(workspace, ".omo", "plans", "plan.md");
  mkdirSync(dirname(planPath), { recursive: true });
  const shaA = sha256Bytes(Buffer.from("plan A\n"));
  const shaB = sha256Bytes(Buffer.from("plan B\n"));
  writeFileSync(planPath, "plan B\n");
  return {
    root,
    workspace,
    planPath,
    shaA,
    shaB,
    workspaceId: "ws-1",
    workspaceRoot: workspace,
    cwd: workspace,
  };
}

function firstRequest() {
  return { eventId: "spawn:resume-test", promptSha256: "f".repeat(64) };
}

function seedStop(options) {
  initialize({
    ...options,
    planSha256: options.shaA,
    explicitLimit: 1,
    firstRequest: firstRequest(),
  });
  reserve({ ...options, planSha256: options.shaA, launchKey: "r83", reviewedBodySha256: options.shaA });
  complete({ ...options, launchKey: "r83", childReceiptId: "st_r83" });
  markStop({ ...options, reason: "REJECT" });
  return readState(options.root, logicalKey(options).key);
}

function makeQuestion(options, state, overrides = {}) {
  return createQuestion({
    root: options.root,
    W: logicalKey(options).key,
    stoppedRevision: state.revision,
    reviewedSha: options.shaA,
    currentSha: options.shaB,
    remainingReason: "REJECT",
    planPath: options.planPath,
    ...overrides,
  });
}

function publishQuestionOnly(options, question) {
  const scratch = mkdtempSync(join(tmpdir(), "prc-question-only-"));
  const requestId = `call_test_${question.questionId}`;
  const timestamp = new Date(Date.now() + 1000).toISOString();
  const lines = [
    JSON.stringify({
      type: "custom",
      customType: "ask-user:question",
      data: { requestId, headers: [question.header] },
      timestamp,
    }),
    JSON.stringify({
      type: "custom",
      customType: "ask-user:settlement",
      data: { requestId, status: "answered" },
      timestamp,
    }),
  ];
  const file = join(scratch, "question.jsonl");
  writeFileSync(file, lines.join("\n"), "utf8");
  const published = publishQuestion({ root: options.root, questionId: question.questionId, sessionFile: file });
  assert.equal(published.ok, true, published.reason);
  return { scratch, file };
}

function bindReal(options, question) {
  const scratch = mkdtempSync(join(tmpdir(), "prc-question-publish-"));
  try {
    const requestId = `call_test_${question.questionId}`;
    const timestamp = new Date(Date.now() + 1000).toISOString();
    const lines = [
      JSON.stringify({
        type: "custom",
        customType: "ask-user:question",
        data: { requestId, headers: [question.header] },
        timestamp,
      }),
      JSON.stringify({
        type: "custom",
        customType: "ask-user:settlement",
        data: { requestId, status: "answered" },
        timestamp,
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: `[Answer to question ${requestId}]\n${question.header}: yes` }],
        },
        inputSource: "extension",
        timestamp,
      }),
    ];
    const file = join(scratch, "owner.jsonl");
    writeFileSync(file, lines.join("\n"), "utf8");
    const published = publishQuestion({
      root: options.root,
      questionId: question.questionId,
      sessionFile: file,
    });
    assert.equal(published.ok, true, published.reason);
    const bound = bindOwnerAnswer({
      root: options.root,
      questionId: question.questionId,
      sessionFile: file,
    });
    assert.equal(bound.ok, true, bound.reason);
    return readQuestion(options.root, question.questionId);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function transcriptBeforeLatestAnswer() {
  const scratch = mkdtempSync(join(tmpdir(), "prc-owner-prefix-"));
  const lines = readFileSync(OWNER_TRANSCRIPT, "utf8").split(/\r?\n/u);
  const firstAnswer = lines.findIndex((line) => line.includes("[Answer to question"));
  const file = join(scratch, "first-answer.jsonl");
  writeFileSync(file, lines.slice(0, firstAnswer + 1).join("\n"), "utf8");
  return { scratch, file };
}

function resumeArgs(options, question, launchKey, planSha = options.shaB, eventId = question.answerEventId) {
  return {
    root: options.root,
    questionId: question.questionId,
    eventId,
    workspaceId: options.workspaceId,
    workspaceRoot: options.workspaceRoot,
    planPath: options.planPath,
    cwd: options.cwd,
    planSha256: planSha,
    roundNo: 4,
    launchKey,
  };
}

function runWorker(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(args)], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("close", (code) => {
      let result = null;
      try { result = JSON.parse(stdout); } catch {}
      resolve({ code, result, stderr });
    });
  });
}

test("owner answers are only the host's ask -> settlement -> framed answer chain", () => {
  const bytes = readFileSync(OWNER_TRANSCRIPT);
  assert.equal(sha256Bytes(bytes), OWNER_TRANSCRIPT_SHA256);
  const answers = readOwnerAnswers(OWNER_TRANSCRIPT);
  assert.ok(answers.length >= 2, JSON.stringify(answers));
  for (const answer of answers) {
    assert.equal(answer.inputSource, "extension");
    assert.match(answer.requestId, /^call_/u);
    assert.match(answer.eventId, /^[0-9a-f]{64}$/u);
    assert.match(answer.sessionSha256, /^[0-9a-f]{64}$/u);
    assert.ok(answer.headers.length > 0);
  }
  const scratch = mkdtempSync(join(tmpdir(), "prc-owner-forged-"));
  try {
    const lines = bytes.toString("utf8").split(/\r?\n/u);
    const answerIndex = lines.findIndex((line) => line.includes("[Answer to question"));
    const settlementIndex = lines.findIndex((line) => line.includes("ask-user:settlement"));
    assert.ok(answerIndex > 0 && settlementIndex > 0);
    const noSource = lines.map((line) => line.includes("[Answer to question")
      ? line.replace(',"inputSource":"extension"', "")
      : line);
    const noSourceFile = join(scratch, "no-source.jsonl");
    writeFileSync(noSourceFile, noSource.join("\n"), "utf8");
    assert.equal(readOwnerAnswers(noSourceFile).length, 0);

    const noSettlementFile = join(scratch, "no-settlement.jsonl");
    writeFileSync(noSettlementFile, lines.filter((line) => !line.includes("ask-user:settlement")).join("\n"), "utf8");
    assert.equal(readOwnerAnswers(noSettlementFile).length, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("freezeRevision returns the full current plan digest", (t) => {
  const options = base(t);
  const frozen = freezeRevision(options.planPath);
  assert.equal(frozen.reviewedSha, options.shaB);
  assert.equal(frozen.bytes > 0, true);
});

test("ensureResumeQuestion is one hash-bound question per stop boundary", (t) => {
  const options = base(t);
  const state = seedStop(options);
  const first = ensureResumeQuestion({
    root: options.root,
    W: logicalKey(options).key,
    stoppedRevision: state.revision,
    reviewedSha: options.shaA,
    currentSha: options.shaB,
    remainingReason: "REJECT",
    planPath: options.planPath,
  });
  const second = ensureResumeQuestion({
    root: options.root,
    W: logicalKey(options).key,
    stoppedRevision: state.revision,
    reviewedSha: options.shaA,
    currentSha: options.shaB,
    remainingReason: "REJECT",
    planPath: options.planPath,
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.question.questionId, second.question.questionId);
  assert.equal(first.question.hashBound, true);
});

test("resume-one: one manual reservation, automatic and same-SHA additions stay zero", (t) => {
  const options = base(t);
  const state = seedStop(options);
  const question = makeQuestion(options, state);
  const bound = bindReal(options, question);
  assert.equal(bound.answerSource, "host-transcript");
  assert.ok(bound.answerEventId);

  const manual = reserveManual(resumeArgs(options, bound, "manual-1"));
  assert.equal(manual.ok, true);
  assert.equal(manual.state.B, 1);
  assert.equal(manual.state.U, 2);
  assert.equal(manual.state.autoUsed, 1);
  assert.equal(manual.state.manualUsed, 1);
  assert.equal(readQuestion(options.root, question.questionId).status, "consumed");
  assert.equal(
    reserve({ ...options, planSha256: options.shaB, launchKey: "auto-after" }).ok,
    false,
  );

  complete({ ...options, launchKey: "manual-1", childReceiptId: "st_manual" });
  markStop({ ...options, reason: "REJECT" });
  const afterStop = readState(options.root, logicalKey(options).key);
  const sameSha = createQuestion({
    root: options.root,
    W: logicalKey(options).key,
    stoppedRevision: afterStop.revision,
    reviewedSha: options.shaB,
    currentSha: options.shaB,
    remainingReason: "REJECT",
    planPath: options.planPath,
  });
  const sameBound = bindReal(options, sameSha);
  assert.equal(
    reserveManual(resumeArgs(options, sameBound, "manual-same", options.shaB)).reason,
    "NO_NEW_REVISION",
  );
  assert.equal(
    reserve({ ...options, planSha256: options.shaB, launchKey: "auto-after-stop" }).ok,
    false,
  );

  const second = makeQuestion(options, afterStop);
  const historical = bindOwnerAnswer({
    root: options.root,
    questionId: second.questionId,
    sessionFile: OWNER_TRANSCRIPT,
  });
  assert.equal(historical.ok, false);
  assert.equal(historical.reason, "QUESTION_NOT_PUBLISHED");
  const secondBound = bindReal(options, second);
  assert.equal(
    reserveManual(resumeArgs(options, secondBound, "manual-2", options.shaB)).reason,
    "MANUAL_EXHAUSTED",
  );
});

test("resume-one: two processes consume one owner answer once", async (t) => {
  const options = base(t);
  const state = seedStop(options);
  const question = makeQuestion(options, state);
  const bound = bindReal(options, question);
  const args = resumeArgs(options, bound, "manual-a");
  const [first, second] = await Promise.all([
    runWorker({ ...args, launchKey: "manual-a" }),
    runWorker({ ...args, launchKey: "manual-b" }),
  ]);
  const results = [first, second].map((entry) => entry.result);
  const winners = results.filter((result) => result?.ok === true);
  assert.equal(winners.length, 1, JSON.stringify(results));
  assert.equal(
    results.filter((result) => result?.reason === "ALREADY_CONSUMED").length,
    1,
  );
  const current = readState(options.root, logicalKey(options).key);
  assert.equal(current.U, 2);
  assert.equal(current.autoUsed, 1);
  assert.equal(current.manualUsed, 1);
  assert.equal(current.B, 1);
});

test("resume-r84-prehash-denied: an answer before the freeze cannot authorize", (t) => {
  const options = base(t);
  const state = seedStop(options);
  const question = createQuestion({
    root: options.root,
    W: logicalKey(options).key,
    stoppedRevision: state.revision,
    reviewedSha: null,
    currentSha: null,
    remainingReason: "REJECT",
    planPath: options.planPath,
  });
  const bound = bindReal(options, question);
  const result = reserveManual(resumeArgs(options, bound, "manual-r84"));
  assert.equal(result.reason, "RESUME_HASH_NOT_BOUND");
  assert.equal(readQuestion(options.root, question.questionId).status, "answered");
  assert.equal(readState(options.root, logicalKey(options).key).U, 1);
  assert.equal(readState(options.root, logicalKey(options).key).manualUsed, 0);
});

test("resume-denied: forged owner input, hash drift, unresolved launch", (t) => {
  const options = base(t);
  const state = seedStop(options);
  const question = makeQuestion(options, state);
  assert.equal(
    reserveManual(resumeArgs(options, question, "manual-unbound", options.shaB, "event-forged")).reason,
    "NOT_BOUND",
  );
  assert.equal(readState(options.root, logicalKey(options).key).U, 1);

  const scratch = mkdtempSync(join(tmpdir(), "prc-owner-forged-bind-"));
  try {
    const lines = readFileSync(OWNER_TRANSCRIPT, "utf8").split(/\r?\n/u);
    const answerIndex = lines.findIndex((line) => line.includes("[Answer to question"));
    const forged = lines.map((line) => line.includes("[Answer to question")
      ? line.replace(',"inputSource":"extension"', "")
      : line);
    const forgedFile = join(scratch, "forged.jsonl");
    writeFileSync(forgedFile, forged.join("\n"), "utf8");
    const published = publishQuestionOnly(options, question);
    try {
      const bound = bindOwnerAnswer({
        root: options.root,
        questionId: question.questionId,
        sessionFile: forgedFile,
      });
      assert.equal(bound.reason, "OWNER_ANSWER_MISSING");
    } finally {
      rmSync(published.scratch, { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const drift = base(t);
  const driftState = seedStop(drift);
  const driftQuestion = makeQuestion(drift, driftState);
  const driftBound = bindReal(drift, driftQuestion);
  const shaC = sha256Bytes(Buffer.from("plan C\n"));
  assert.equal(
    reserveManual(resumeArgs(drift, driftBound, "manual-drift", shaC)).reason,
    "HASH_DRIFT",
  );

  const unresolved = base(t);
  initialize({
    ...unresolved,
    planSha256: unresolved.shaA,
    explicitLimit: 1,
    firstRequest: firstRequest(),
  });
  reserve({ ...unresolved, planSha256: unresolved.shaA, launchKey: "pending" });
  const pending = readState(unresolved.root, logicalKey(unresolved).key);
  const pendingQuestion = createQuestion({
    root: unresolved.root,
    W: logicalKey(unresolved).key,
    stoppedRevision: pending.revision,
    reviewedSha: unresolved.shaA,
    currentSha: unresolved.shaB,
    remainingReason: "REJECT",
    planPath: unresolved.planPath,
  });
  const pendingBound = bindReal(unresolved, pendingQuestion);
  assert.equal(
    reserveManual(resumeArgs(unresolved, pendingBound, "manual-pending")).reason,
    "UNRESOLVED_LAUNCH",
  );
});

test("stop-unknown blocks the owner one-shot and a missing ledger fails closed", (t) => {
  const unknown = base(t);
  initialize({
    ...unknown,
    planSha256: unknown.shaA,
    explicitLimit: 1,
    firstRequest: firstRequest(),
  });
  reserve({ ...unknown, planSha256: unknown.shaA, launchKey: "r83" });
  complete({ ...unknown, launchKey: "r83", childReceiptId: "st_r83" });
  markStop({ ...unknown, reason: "STOP_UNKNOWN" });
  const state = readState(unknown.root, logicalKey(unknown).key);
  const question = makeQuestion(unknown, state);
  const bound = bindReal(unknown, question);
  assert.equal(
    reserveManual(resumeArgs(unknown, bound, "manual-unknown")).reason,
    "STATE_STOPPED",
  );

  const missing = base(t);
  const missingQuestion = createQuestion({
    root: missing.root,
    W: logicalKey(missing).key,
    stoppedRevision: 0,
    reviewedSha: missing.shaA,
    currentSha: missing.shaB,
    remainingReason: "REJECT",
    planPath: missing.planPath,
  });
  const missingBound = bindReal(missing, missingQuestion);
  assert.equal(
    reserveManual(resumeArgs(missing, missingBound, "manual-missing")).reason,
    "NO_STATE",
  );
});
