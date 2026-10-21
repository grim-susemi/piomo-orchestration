import { readFile, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { memoryFixture } from "./memory-fixture.mjs";

const [plugin, mode, receiptPath] = process.argv.slice(2);
assert.ok(plugin && ["baseline", "patched"].includes(mode) && receiptPath);
const run = promisify(execFile);
const fixture = await memoryFixture(plugin);
const { repo, write, create } = fixture;
const git = async (...args) => (await run("git.exe", ["-C", repo, ...args],
  { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout;
const status = () => git("status", "--porcelain", "--untracked-files=all");
const exists = async (relative) => {
  try { await stat(`${repo}/${relative}`); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
};
const results = {};
const committed = (result) => !!result.details?.writeNotice?.sha;
try {
  // Line-ending conversion is not under test. Keep fixture checkout bytes
  // deterministic rather than inheriting the workstation's autocrlf setting.
  await git("config", "core.autocrlf", "false");
  assert.equal(await status(), "");
  const seedBefore = await readFile(`${repo}/reference/seed.md`);
  const headBefore = (await git("rev-parse", "HEAD")).trim();
  const hook = `${repo}/.git/hooks/pre-commit`;
  const nativeHook = await readFile(hook);
  // A real Git policy rejection, not a mock of commitPaths or a thrown JS error.
  await writeFile(hook, "#!/bin/sh\nif git diff --cached --name-only | grep -F -x 'reference/rejected.md' >/dev/null; then\n  echo LOCAL_FIXTURE_POLICY_REJECT >&2\n  exit 1\nfi\n");
  const rejected = await create("reference/rejected.md", "This write is rejected by the fixture hook.\n");
  const dirtyAfter = await status();
  const failedPathExists = await exists("reference/rejected.md");
  assert.equal(committed(rejected), false);
  assert.equal((await git("rev-parse", "HEAD")).trim(), headBefore);
  assert.deepEqual(await readFile(`${repo}/reference/seed.md`), seedBefore);
  const next = await create("reference/after-rejection.md", "Normal write after hook rejection.\n");
  results.hook = { rejection: rejected, dirtyAfter, failedPathExists, nextCommitted: committed(next), next };
  if (mode === "baseline") {
    assert.ok(failedPathExists && dirtyAfter.includes("rejected.md"));
    assert.equal(committed(next), false);
    // Remove only this fixture's known rejected paths so later independent
    // scenarios can run; this is not a repair of the user's memory repository.
    await git("--literal-pathspecs", "rm", "-f", "--ignore-unmatch", "--", "reference/rejected.md", "reference/after-rejection.md");
  } else {
    assert.equal(failedPathExists, false);
    assert.equal(dirtyAfter, "");
    assert.ok(committed(next), JSON.stringify(next));
    assert.equal(await status(), "");
  }
  await writeFile(hook, nativeHook);
  // The actual shipped hook remains effective; no secret-scanner changes.
  const guarded = await create("reference/guarded.md", "to" + "ken=abc" + "123456\n");
  assert.equal(committed(guarded), false);
  assert.equal(await exists("reference/guarded.md"), false);
  assert.equal(await status(), "");
  results.guard = { rejected: true, result: guarded };
  const safe = await create("reference/guard-control.md", "Normal control still commits.\n");
  assert.ok(committed(safe), JSON.stringify(safe));

  const neighbour = await create("reference/x.md", "Neighbour must remain unchanged.\n");
  assert.ok(committed(neighbour), JSON.stringify(neighbour));
  const neighbourBefore = await readFile(`${repo}/reference/x.md`);
  const nativeRejected = await create("reference/[refused].md",
    'api' + 'Key: "!op read example"\n');
  const nativeDirty = await status();
  results.nativeHook = { result: nativeRejected, dirtyAfter: nativeDirty,
    failedPathExists: await exists("reference/[refused].md") };
  assert.equal(committed(nativeRejected), false);
  assert.ok(JSON.stringify(nativeRejected).includes("credential_assignment"));
  assert.deepEqual(await readFile(`${repo}/reference/x.md`), neighbourBefore);
  if (mode === "patched") {
    assert.equal(nativeDirty, "");
    assert.equal(results.nativeHook.failedPathExists, false);
  } else {
    assert.ok(nativeDirty.includes("[refused].md"));
    await git("--literal-pathspecs", "rm", "-f", "--ignore-unmatch", "--", "reference/[refused].md");
  }
  const bracket = await create("reference/[x].md", "Literal brackets, not a path pattern.\n");
  results.brackets = { committed: committed(bracket), result: bracket, status: await status() };
  assert.deepEqual(await readFile(`${repo}/reference/x.md`), neighbourBefore);
  if (mode === "patched") {
    assert.ok(committed(bracket), JSON.stringify(bracket));
    assert.equal(await status(), "");
  } else if (!committed(bracket)) {
    await git("--literal-pathspecs", "add", "-A", "--", "reference/[x].md");
    await git("commit", "-m", "Fixture cleanup for literal bracket baseline");
  }

  const original = await create("reference/Notes.md", "Case-original remains recoverable.\n");
  assert.ok(committed(original), JSON.stringify(original));
  const caseBefore = await readFile(`${repo}/reference/Notes.md`);
  const alias = await write({
    command: "str_replace", file_path: "reference/notes.md", reason: "Fixture case-alias transaction",
    old_string: "Case-original", new_string: "Case-edited"
  });
  results.caseAlias = { committed: committed(alias), exists: await exists("reference/Notes.md"),
    result: alias, status: await status() };
  // DirtyRepoError must not roll back or delete somebody else's changed path.
  if (mode === "patched") {
    assert.equal(results.caseAlias.committed, false);
    assert.equal(results.caseAlias.exists, true);
    assert.ok((await readFile(`${repo}/reference/Notes.md`, "utf8")).includes("Case-edited"));
    assert.ok((await status()).includes("Notes.md"));
  }
  await git("--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", "reference/Notes.md");
  assert.deepEqual(await readFile(`${repo}/reference/Notes.md`), caseBefore);
  if (mode === "patched") {
    // A hook can leave a separate legitimate edit while refusing this transaction.
    // Only the transaction path may be rolled back; the other edit must survive.
    const beforeNeighbour = await readFile(`${repo}/reference/x.md`, "utf8");
    const appended = "\nIndependent neighbour edit from fixture hook.\n";
    await writeFile(hook, "#!/bin/sh\nif git diff --cached --name-only | grep -F -x 'reference/neighbour-transaction.md' >/dev/null; then\n  printf '\\nIndependent neighbour edit from fixture hook.\\n' >> reference/x.md\n  echo LOCAL_FIXTURE_NEIGHBOUR_REJECT >&2\n  exit 1\nfi\n");
    const rejectedWithNeighbour = await create("reference/neighbour-transaction.md", "Rejected transaction beside a separate edit.\n");
    assert.equal(committed(rejectedWithNeighbour), false);
    assert.equal(await exists("reference/neighbour-transaction.md"), false);
    assert.equal(await readFile(`${repo}/reference/x.md`, "utf8"), beforeNeighbour + appended);
    assert.equal(await status(), " M reference/x.md\n");
    const blockedByNeighbour = await create("reference/must-not-overwrite-neighbour.md", "Must wait for the unrelated edit.\n");
    assert.equal(committed(blockedByNeighbour), false);
    assert.equal(await exists("reference/must-not-overwrite-neighbour.md"), false);
    assert.equal(await readFile(`${repo}/reference/x.md`, "utf8"), beforeNeighbour + appended);
    results.neighbourEdit = { rejected: rejectedWithNeighbour, transactionRemoved: true,
      separateEditPreserved: true, nextCorrectlyRefusedWhileDirty: true, status: await status() };
    await writeFile(hook, nativeHook);
    await git("--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", "reference/x.md");
    assert.equal(await readFile(`${repo}/reference/x.md`, "utf8"), beforeNeighbour);
  }
  const final = await create("reference/final-control.md", "Final normal write commits.\n");
  assert.ok(committed(final), JSON.stringify(final));
  assert.equal(await status(), "");
  const receipt = {
    mode, plugin, pid: fixture.pid, executable: fixture.executable, owner: fixture.owner,
    sandbox: fixture.sandbox, repo, binding: fixture.binding, results,
    finalStatus: await status(), finalHead: (await git("rev-parse", "HEAD")).trim(),
    limitation: "Windows NTFS fixtures; POSIX-only colon pathspec filenames are not exercised."
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log("NATIVE_SCENARIOS_PASS " + JSON.stringify({ mode, receiptPath, owner: fixture.owner, pid: fixture.pid }));
} catch (error) {
  await writeFile(receiptPath + ".failure.json", JSON.stringify({
    mode, plugin, sandbox: fixture.sandbox, repo, results,
    error: { message: error.message, stack: error.stack }, status: await status()
  }, null, 2) + "\n", { flag: "wx" });
  throw error;
} finally {
  await fixture.close();
}
