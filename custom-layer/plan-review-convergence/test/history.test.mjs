import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(readFileSync(join(HERE, "fixtures", "cases.json"), "utf8"));
const REQUIRED_FIELDS = [
  "source",
  "lineOrKey",
  "event",
  "planKey",
  "round",
  "taskId",
  "sha",
  "origin",
  "observed",
];

// The fixture models the history classifier's contract, not the product code.
// It keeps provenance, verdict, and authorization separate so a shared parent
// session or a later goal signal cannot become a counted blocker.
function classify(row, currentPlan, seen) {
  if (!row.planKey) {
    return { ...row, category: "unknown", counted: false, reason: "no-plan-key" };
  }
  if (row.planKey !== currentPlan) {
    return { ...row, category: "other-plan", counted: false, reason: "plan-mismatch" };
  }
  if (row.event === "goal-continuation" || row.origin === "goal" || row.origin === "goal-continuation") {
    return {
      ...row,
      category: "automatic",
      counted: false,
      ownerAuthorized: false,
      reason: "goal-signal-not-authorization",
    };
  }
  if (row.event === "owner-question") {
    return { ...row, category: "owner-question", counted: false };
  }
  if (row.event === "owner-answer") {
    if (row.origin === "owner-answer" && row.observed?.questionId) {
      return {
        ...row,
        category: "owner-authorized",
        counted: false,
        ownerAuthorized: true,
        authorizationScope: "historical",
        candidateBinding: false,
      };
    }
    return {
      ...row,
      category: "evidence-unconfirmed",
      counted: false,
      ownerAuthorized: false,
      reason: "answer-not-bound",
    };
  }
  if (row.event === "review-reservation") {
    if (row.origin === "owner-answer" && row.observed?.ownerAuthorized === true) {
      return {
        ...row,
        category: "owner-authorized",
        counted: false,
        ownerAuthorized: true,
        automaticBudget: false,
        authorizationScope: "historical",
        candidateBinding: false,
      };
    }
    return { ...row, category: "automatic", counted: false, ownerAuthorized: false };
  }
  if (row.event === "review-verdict" && row.observed?.verdict === "REJECT") {
    if (!row.observed.cause) {
      return { ...row, category: "evidence-unconfirmed", counted: false };
    }
    const causeKey = [row.planKey, "IS-4", row.observed.cause, "contradiction"].join("|");
    if (row.origin === "synthetic" && seen.has(causeKey)) {
      return { ...row, category: "duplicate", counted: false, causeKey, duplicateOf: causeKey };
    }
    seen.add(causeKey);
    return { ...row, category: "actual-blocker", counted: true, causeKey };
  }
  if (row.event === "review-launch") {
    return { ...row, category: "launch", counted: false };
  }
  if (row.event === "compaction" || row.event === "review-stop") {
    return { ...row, category: "harness-event", counted: false };
  }
  return { ...row, category: "unknown", counted: false };
}

const SEEN = new Set();
const ROWS = CASES.history.map((row) => classify(row, CASES.currentPlanKey, SEEN));
const BY_KEY = new Map(ROWS.map((row) => [row.lineOrKey, row]));

function get(key) {
  const row = BY_KEY.get(key);
  assert.ok(row, `missing history row ${key}`);
  return row;
}

test("history rows keep provenance, round, hash, origin, and observed fields", () => {
  assert.equal(CASES.currentPlanKey, "omo-5181-snapcompact-upgrade");
  assert.ok(CASES.history.length >= 18);
  for (const row of CASES.history) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(Object.hasOwn(row, field), `${row.lineOrKey} is missing ${field}`);
    }
    assert.equal(typeof row.observed, "object");
    assert.notEqual(row.observed, null);
  }
});

test("history-owner-vs-continuation: r84 is owner-authorized, the goal signal is not", () => {
  const answer = get("J:5970");
  const reservation = get("J:6065");
  const continuation = get("J:6055");

  assert.equal(answer.ownerAuthorized, true);
  assert.equal(answer.category, "owner-authorized");
  assert.equal(answer.authorizationScope, "historical");
  assert.equal(answer.candidateBinding, false);
  assert.equal(reservation.ownerAuthorized, true);
  assert.equal(reservation.category, "owner-authorized");
  assert.equal(reservation.automaticBudget, false);
  assert.equal(reservation.observed.hashBound, false);
  assert.equal(continuation.ownerAuthorized, false);
  assert.equal(continuation.category, "automatic");

  // The owner answered against the r83 hash; the r84 revision was a new hash.
  // The historical authorization is preserved, but it is not candidate binding.
  assert.notEqual(reservation.sha, answer.sha);
  assert.equal(get("J:6069-6073").observed.child, "st_01a203f7");
  assert.equal(get("J:6069-6073").observed.hashBound, false);
});

test("r83 reject, target hash, and stop are preserved", () => {
  const verdict = get("r83-verdict");
  assert.equal(verdict.observed.verdict, "REJECT");
  assert.equal(verdict.sha, "ab92ce5d927336a74dfdddd4c404db8e08ae7f378fcf0dd59e07245fe02ec5d1");
  assert.equal(verdict.observed.targetSha, verdict.sha);
  assert.equal(verdict.category, "actual-blocker");
  assert.equal(verdict.counted, true);
  assert.match(verdict.causeKey, /gateway-direct-sdk-before-unlock/);
  assert.equal(get("J:5931").observed.round_status, "changes_requested");
});

test("r82 and r83 are distinct blocker cases, not duplicate wording", () => {
  const r82 = get("r82-verdict");
  const r83 = get("r83-verdict");
  const r65 = get("r65-verdict");
  assert.equal(r82.counted, true);
  assert.equal(r83.counted, true);
  assert.equal(r65.counted, true);
  assert.notEqual(r82.causeKey, r83.causeKey);
  assert.notEqual(r65.causeKey, r83.causeKey);
});

test("r83 recorded limit 83 and the host launch are separate observations", () => {
  const reservation = get("J:5816");
  const launch = get("J:5827-5831");
  assert.equal(reservation.observed.review_round_limit, 83);
  assert.equal(launch.observed.limit, 83);
  assert.equal(launch.observed.accepted, true);
  assert.equal(launch.observed.child, "st_01a203eb");
  assert.equal(get("J:5893").observed.during, "r83");
  assert.equal(get("J:5893").category, "harness-event");
});

test("the owner question and answer stay separate and bound by request id", () => {
  const question = get("J:5957-5966");
  const answer = get("J:5970");
  assert.equal(question.category, "owner-question");
  assert.equal(answer.observed.questionId, question.observed.requestId);
  assert.equal(answer.observed.scope, "one_review");
});

test("other plans, unknown parents, and unbound approvals never enter the count", () => {
  assert.equal(get("role-plan-verdict").category, "other-plan");
  assert.equal(get("convergence-plan-verdict").category, "other-plan");
  assert.equal(get("synthetic-same-cause-other-plan").category, "other-plan");
  assert.equal(get("synthetic-unknown-parent").category, "unknown");
  assert.equal(get("synthetic-answer-without-question").category, "evidence-unconfirmed");
  for (const key of [
    "role-plan-verdict",
    "convergence-plan-verdict",
    "synthetic-same-cause-other-plan",
    "synthetic-unknown-parent",
    "synthetic-answer-without-question",
  ]) {
    assert.equal(get(key).counted, false);
  }
  assert.equal(ROWS.filter((row) => row.counted).length, 3);
});

test("a same-plan synthetic duplicate maps to the existing blocker key", () => {
  const duplicate = get("synthetic-same-plan-duplicate");
  assert.equal(duplicate.category, "duplicate");
  assert.equal(duplicate.counted, false);
  assert.equal(duplicate.duplicateOf, get("r83-verdict").causeKey);
});

test("history-misattribution: the filtered misattributed rows count zero", () => {
  const filtered = ROWS.filter((row) =>
    [
      "role-plan-verdict",
      "convergence-plan-verdict",
      "synthetic-unknown-parent",
      "synthetic-answer-without-question",
    ].includes(row.lineOrKey),
  );
  assert.equal(filtered.filter((row) => row.counted).length, 0);
});
