// Fake-clock tests for the D9 (plan r4) retry rule. Run: node --test test/extension.test.mjs
// The fake clock is shared by the fake rename, sleep and log; each fake
// advances it by its configured cost. `end` = the clock when the call throws
// or returns. Expected totals come from the reviewed reference simulation
// (.omo/evidence/freeze-fix/d9-trace-sim.mjs): c30+ov50 970, c120 980,
// c300 915, c30 980, late400 1245, lateOv200 1150, first1200 1200 (1 attempt).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRetryingRename } from "../extension.mjs";

const SRC = "C:\\proj\\senpi-task\\tasks\\st_abc123.json.1.abcdef01.tmp";
const DEST = "C:\\proj\\senpi-task\\tasks\\st_abc123.json";

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function rig({ attemptCost = () => 30, sleepOver = () => 0, logCost = 0, logFailure = null, renameImpl = null }) {
  let t = 0;
  const now = () => t;
  const attemptStarts = [];
  const sleepStarts = [];
  const logCalls = [];
  const rename =
    renameImpl ??
    ((src, dest) => {
      const n = attemptStarts.length;
      attemptStarts.push(t);
      t += attemptCost(t, n);
      throw codedError("EPERM");
    });
  const sleep = (ms) => {
    sleepStarts.push(t);
    t += ms + sleepOver(t);
  };
  const log = logFailure
    ? (info) => {
        logCalls.push(info);
        throw logFailure;
      }
    : (info) => {
        logCalls.push(info);
        t += logCost;
      };
  const wrapped = createRetryingRename({ rename, sleep, now, log, platform: "win32" });
  return { now, wrapped, attemptStarts, sleepStarts, logCalls };
}

async function flush(wrapped) {
  if (wrapped.state.pendingLog) await wrapped.state.pendingLog;
}

describe("retry budget", () => {
  it("30ms attempts end at 980 with the log after the throw", async () => {
    const r = rig({});
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 980);
    assert.ok(end <= 1000);
    assert.equal(r.logCalls.length, 0);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
    assert.equal(r.logCalls[0].event, "publish_retry_exhausted");
    assert.equal(r.logCalls[0].attempts, r.attemptStarts.length);
  });

  it("120ms attempts end at 980", async () => {
    const r = rig({ attemptCost: () => 120 });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 980);
    assert.ok(end <= 1000);
    assert.equal(r.logCalls.length, 0);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("300ms attempts end at 915", async () => {
    const r = rig({ attemptCost: () => 300 });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 915);
    assert.ok(end <= 1000);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("30ms attempts with 50ms sleep overshoot end at 970", async () => {
    const r = rig({ sleepOver: () => 50 });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 970);
    assert.ok(end <= 1000);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("a 400ms attempt starting after 800ms ends at 1245 with nothing after it", async () => {
    const r = rig({ attemptCost: (s) => (s > 800 ? 400 : 30) });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 1245);
    assert.ok(end <= 1000 + 370);
    const lastAttempt = r.attemptStarts[r.attemptStarts.length - 1];
    assert.ok(lastAttempt > 800);
    assert.ok(r.sleepStarts.every((s) => s < lastAttempt));
    assert.equal(end, lastAttempt + 400);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("a first attempt costing 1200ms means exactly 1 attempt and 1 log", async () => {
    const r = rig({ attemptCost: (s, n) => (n === 0 ? 1200 : 30) });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 1200);
    assert.equal(r.attemptStarts.length, 1);
    assert.equal(r.sleepStarts.length, 0);
    assert.equal(r.logCalls.length, 0);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("a 200ms overshoot on a sleep after 850ms ends at 1150 with no attempt after it", async () => {
    const r = rig({ sleepOver: (s) => (s > 850 ? 200 : 0) });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 1150);
    assert.ok(end <= 1000 + 180);
    const lateSleep = r.sleepStarts[r.sleepStarts.length - 1];
    assert.ok(lateSleep > 850);
    assert.ok(r.attemptStarts.every((a) => a <= lateSleep));
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("a log costing 500ms does not move the throw time", async () => {
    const r = rig({ logCost: 500 });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    const end = r.now();
    assert.equal(end, 980);
    assert.ok(end <= 1000);
    await flush(r.wrapped);
    assert.equal(r.logCalls.length, 1);
  });

  it("a rejecting log records logFailures and lastLogError without throwing", async () => {
    const r = rig({ logFailure: new Error("disk full") });
    assert.throws(() => r.wrapped(SRC, DEST), /EPERM/);
    await flush(r.wrapped);
    assert.equal(r.wrapped.state.logFailures, 1);
    assert.equal(r.wrapped.state.lastLogError, "disk full");
  });

  it("a rename succeeding once the clock passes 500ms returns with no log", async () => {
    let t = 0;
    const now = () => t;
    const logCalls = [];
    const wrapped = createRetryingRename({
      rename: () => {
        if (t < 500) {
          t += 30;
          throw codedError("EPERM");
        }
        return "ok";
      },
      sleep: (ms) => {
        t += ms;
      },
      now,
      log: (info) => {
        logCalls.push(info);
      },
      platform: "win32",
    });
    assert.equal(wrapped(SRC, DEST), "ok");
    assert.equal(wrapped.state.pendingLog, null);
    assert.equal(logCalls.length, 0);
  });

  it("ENOENT rethrows after 1 attempt with no log", async () => {
    let calls = 0;
    let t = 0;
    const wrapped = createRetryingRename({
      rename: () => {
        calls += 1;
        throw codedError("ENOENT");
      },
      sleep: (ms) => {
        t += ms;
      },
      now: () => t,
      log: () => {
        throw new Error("must not log");
      },
      platform: "win32",
    });
    assert.throws(() => wrapped(SRC, DEST), /ENOENT/);
    assert.equal(calls, 1);
    assert.equal(wrapped.state.pendingLog, null);
  });

  it("a non-task path passes through with 1 attempt only", async () => {
    let calls = 0;
    const wrapped = createRetryingRename({
      rename: () => {
        calls += 1;
        throw codedError("EPERM");
      },
      sleep: () => {
        throw new Error("must not sleep");
      },
      now: () => 0,
      log: () => {
        throw new Error("must not log");
      },
      platform: "win32",
    });
    assert.throws(() => wrapped("C:\\x\\other\\file.txt", "C:\\x\\other\\file2.txt"), /EPERM/);
    assert.equal(calls, 1);
    assert.equal(wrapped.state.pendingLog, null);
  });
});
