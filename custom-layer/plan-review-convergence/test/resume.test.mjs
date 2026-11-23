import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { complete, initialize, logicalKey, markStop, readState, reserve } from "../state.mjs";
import {
  bindAnswer,
  createQuestion,
  freezeRevision,
  readQuestion,
  reserveManual,
  sha256Bytes,
} from "../owner-resume.mjs";

const WORKER = join(dirname(fileURLToPath(import.meta.url)), "helpers", "resume-worker.mjs");

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

function seedStop(options) {
  initialize({ ...options, planSha256: options.shaA, explicitLimit: 1 });
  reserve({ ...options, planSha256: options.shaA, launchKey: "r83" });
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

function resumeArgs(options, question, launchKey, planSha = options.shaB, eventId = "owner-event-1") {
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

test("freezeRevision returns the full current plan digest", (t) => {
  const options = base(t);
  const frozen = freezeRevision(options.planPath);
  assert.equal(frozen.reviewedSha, options.shaB);
  assert.equal(frozen.bytes > 0, true);
});

test("resume-one: one manual reservation, automatic and same-SHA additions stay zero", (t) => {
  const options = base(t);
  const state = seedStop(options);
  const question = makeQuestion(options, state);
  assert.equal(bindAnswer({
    root: options.root,
    questionId: question.questionId,
    eventId: "owner-event-1",
    source: "owner",
  }).ok, true);

  const manual = reserveManual(resumeArgs(options, question, "manual-1"));
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
  bindAnswer({
    root: options.root,
    questionId: sameSha.questionId,
    eventId: "owner-event-2",
    source: "owner",
  });
  assert.equal(
    reserveManual(resumeArgs(options, sameSha, "manual-same", options.shaB, "owner-event-2")).reason,
    "NO_NEW_REVISION",
  );
  assert.equal(
    reserve({ ...options, planSha256: options.shaB, launchKey: "auto-after-stop" }).ok,
    false,
  );

  const second = makeQuestion(options, afterStop);
  bindAnswer({
    root: options.root,
    questionId: second.questionId,
    eventId: "owner-event-3",
    source: "owner",
  });
  assert.equal(
    reserveManual(resumeArgs(options, second, "manual-2", options.shaB, "owner-event-3")).reason,
    "MANUAL_EXHAUSTED",
  );
});

test("resume-one: two processes consume one owner answer once", async (t) => {
  const options = base(t);
  const state = seedStop(options);
  const question = makeQuestion(options, state);
  bindAnswer({
    root: options.root,
    questionId: question.questionId,
    eventId: "owner-event-1",
    source: "owner",
  });
  const args = resumeArgs(options, question, "manual-a");
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
  bindAnswer({
    root: options.root,
    questionId: question.questionId,
    eventId: "J:5970",
    source: "owner",
  });
  const result = reserveManual(resumeArgs(options, question, "manual-r84", options.shaB, "J:5970"));
  assert.equal(result.reason, "RESUME_HASH_NOT_BOUND");
  assert.equal(readQuestion(options.root, question.questionId).status, "answered");
  assert.equal(readState(options.root, logicalKey(options).key).U, 1);
  assert.equal(readState(options.root, logicalKey(options).key).manualUsed, 0);
});

test("resume-denied: compaction, goal, agent citation, hash drift, unresolved launch", (t) => {
  for (const source of ["compaction", "goal", "agent"]) {
    const options = base(t);
    const state = seedStop(options);
    const question = makeQuestion(options, state);
    assert.equal(
      bindAnswer({
        root: options.root,
        questionId: question.questionId,
        eventId: `event-${source}`,
        source,
      }).reason,
      "NOT_OWNER_EVENT",
    );
    assert.equal(
      reserveManual(resumeArgs(options, question, `manual-${source}`, options.shaB, `event-${source}`)).reason,
      "NOT_BOUND",
    );
    assert.equal(readState(options.root, logicalKey(options).key).U, 1);
  }

  const drift = base(t);
  const driftState = seedStop(drift);
  const driftQuestion = makeQuestion(drift, driftState);
  bindAnswer({
    root: drift.root,
    questionId: driftQuestion.questionId,
    eventId: "owner-event-1",
    source: "owner",
  });
  const shaC = sha256Bytes(Buffer.from("plan C\n"));
  assert.equal(
    reserveManual(resumeArgs(drift, driftQuestion, "manual-drift", shaC)).reason,
    "HASH_DRIFT",
  );

  const unresolved = base(t);
  initialize({ ...unresolved, planSha256: unresolved.shaA, explicitLimit: 1 });
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
  bindAnswer({
    root: unresolved.root,
    questionId: pendingQuestion.questionId,
    eventId: "owner-event-1",
    source: "owner",
  });
  assert.equal(
    reserveManual(resumeArgs(unresolved, pendingQuestion, "manual-pending")).reason,
    "UNRESOLVED_LAUNCH",
  );
});

test("stop-unknown blocks the owner one-shot and a missing ledger fails closed", (t) => {
  const unknown = base(t);
  initialize({ ...unknown, planSha256: unknown.shaA, explicitLimit: 1 });
  reserve({ ...unknown, planSha256: unknown.shaA, launchKey: "r83" });
  complete({ ...unknown, launchKey: "r83", childReceiptId: "st_r83" });
  markStop({ ...unknown, reason: "STOP_UNKNOWN" });
  const state = readState(unknown.root, logicalKey(unknown).key);
  const question = makeQuestion(unknown, state);
  bindAnswer({
    root: unknown.root,
    questionId: question.questionId,
    eventId: "owner-event-1",
    source: "owner",
  });
  assert.equal(
    reserveManual(resumeArgs(unknown, question, "manual-unknown")).reason,
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
  bindAnswer({
    root: missing.root,
    questionId: missingQuestion.questionId,
    eventId: "owner-event-1",
    source: "owner",
  });
  assert.equal(
    reserveManual(resumeArgs(missing, missingQuestion, "manual-missing")).reason,
    "NO_STATE",
  );
});
