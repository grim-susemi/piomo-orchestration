import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFixture, FIXTURE_MARKER, AFTER_SHA256 } from "../installer.mjs";
import { FILE, VERSION, BASELINE_SHA256, sha256 } from "../patch.mjs";

const qualification = JSON.parse(await readFile(new URL("../qualification.json", import.meta.url), "utf8"));
const original = await readFile(join(qualification.omoRoot, FILE));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "task-owned-work-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "plugin/extensions"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ version: VERSION }));
  await writeFile(join(root, FIXTURE_MARKER), JSON.stringify({ schema: "task-owned-work-disposable-v1", disposable: true }));
  await writeFile(join(root, FILE), original);
  return { root, file: join(root, FILE) };
}

test("owned-work installer applies, preserves backup, is idempotent and removes its exact delta", async (t) => {
  const { root, file } = await fixture(t);
  const applied = await installFixture(root);
  assert.equal(applied.sha256, AFTER_SHA256);
  assert.equal(sha256(await readFile(applied.backup)), BASELINE_SHA256);
  assert.equal((await installFixture(root)).changed, false);
  const removed = await installFixture(root, "remove");
  assert.equal(removed.sha256, BASELINE_SHA256);
  assert.equal((await readFile(file)).equals(original), true);
  assert.equal((await installFixture(root, "remove")).changed, false);
});

test("owned-work installer refuses shared roots before any write", async () => {
  await assert.rejects(installFixture(qualification.omoRoot), { kind: "fixture-only" });
  assert.equal(sha256(await readFile(join(qualification.omoRoot, FILE))), BASELINE_SHA256);
});

test("owned-work installer requires disposable identity and qualified version", async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(join(root, FIXTURE_MARKER), JSON.stringify({ disposable: false }));
  await assert.rejects(installFixture(root), { kind: "fixture-only" });
  await writeFile(join(root, FIXTURE_MARKER), JSON.stringify({ schema: "task-owned-work-disposable-v1", disposable: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "unqualified" }));
  await assert.rejects(installFixture(root), { kind: "version" });
  assert.equal(sha256(await readFile(file)), BASELINE_SHA256);
});

test("owned-work installer rejects unrelated corruption before apply and inverse", async (t) => {
  const { root, file } = await fixture(t);
  await writeFile(file, Buffer.concat([original, Buffer.from("\n// unrelated change")]));
  const corruptBefore = await readFile(file);
  await assert.rejects(installFixture(root), { kind: "drift" });
  assert.equal((await readFile(file)).equals(corruptBefore), true);
  await writeFile(file, original);
  await installFixture(root);
  await writeFile(file, Buffer.concat([await readFile(file), Buffer.from("\n// newer editor")]));
  const corruptAfter = await readFile(file);
  await assert.rejects(installFixture(root, "remove"), { kind: "drift" });
  assert.equal((await readFile(file)).equals(corruptAfter), true);
});

test("owned-work installer preserves foreign backups and existing staging files", async (t) => {
  const { root, file } = await fixture(t);
  const backup = `${file}.task-owned-work-reclaim-guard.bak`;
  const staged = `${file}.task-owned-work-reclaim-guard.new`;
  await writeFile(backup, "foreign backup");
  await assert.rejects(installFixture(root), { kind: "backup-drift" });
  assert.equal(await readFile(backup, "utf8"), "foreign backup");
  await writeFile(backup, original);
  await writeFile(staged, "someone else's staging");
  await assert.rejects(installFixture(root), { code: "EEXIST" });
  assert.equal(await readFile(staged, "utf8"), "someone else's staging");
  assert.equal(sha256(await readFile(file)), BASELINE_SHA256);
  assert.equal((await stat(backup)).size, original.length);
});
