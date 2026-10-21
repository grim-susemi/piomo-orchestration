import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDITS, FILES, classifyText, transformText, applyTree, checkTree } from "../patch.mjs";
import { evaluateText } from "../probe.mjs";

// Deliberately use different identifiers from the installed minifier.
const fixture = `const policies={${EDITS.slice(0, 2).map((e) => e.anchor).join(",")}};
function lookup(role){return policies[role]}
function gate(role,state){let p=lookup(role);if(void 0===p)return{kind:"allow"};let f=p.forbidsSkills.find(x=>state.hasInvoked(x));if(void 0!==f)return{kind:"deny",message:\`Agent "\${role}" is plan-gated and cannot be spawned: history\`};let r=p.requiresSkills.filter(x=>!state.hasUserRequested(x));if(r.length>0)return{kind:"deny"};return p.requiresPlanArtifact&&!state.hasPlanArtifact()?{kind:"deny"}:{kind:"allow"}}
const help="${EDITS[2].anchor}";`;
const source = fixture;

async function sandbox(t, text = source, version = "5.1.38") {
  const root = await mkdtemp(join(tmpdir(), "plan-review-unlock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({ version }));
  await mkdir(join(root, "plugin/extensions"), { recursive: true });
  for (const file of FILES) await writeFile(join(root, file), text);
  return root;
}

test("original gate refuses a plan after execution", () => {
  // Given original gate; when it evaluates an explicit plan after execution.
  const result = evaluateText(source);
  // Then the defect is observable for both real policy roles.
  assert.equal(result.verdict, "defect-present");
});

test("patched gate allows explicit review after execution", () => {
  // Given the source delta; when the actual gate is evaluated.
  const result = evaluateText(transformText(source));
  // Then both reviewers are usable and the two remaining prerequisites hold.
  assert.equal(result.verdict, "defect-absent");
  for (const role of ["plan-consultant", "plan-reviewer"]) {
    assert.equal(result.results[role].afterExecution, "allow");
    assert.equal(result.results[role].noRequest, "deny");
    assert.equal(result.results[role].noArtifact, "deny");
  }
});

test("inverse delta preserves all unrelated bytes including CRLF", () => {
  const before = `// unrelated payload\r\n${source.replaceAll("\n", "\r\n")}\r\n`;
  const after = transformText(before);
  assert.equal(transformText(after, "remove"), before);
});

test("unknown gate text is not treated as an upstream fix", () => {
  assert.equal(evaluateText("export const unrelated = true").verdict, "needs-review");
});

test("5.1.40 and 5.1.38 are supported, any other version is refused", async (t) => {
  for (const version of ["5.1.40", "5.1.38"]) {
    assert.equal((await checkTree(await sandbox(t, source, version))).supported, true);
  }
  const other = await sandbox(t, source, "5.1.41");
  await assert.rejects(applyTree(other), (error) => error.kind === "version");
  assert.equal(classifyText(await readFile(join(other, FILES[0]), "utf8")), "pristine");
});

test("apply changes the task gate and second apply is a no-op", async (t) => {
  const root = await sandbox(t);
  const result = await applyTree(root);
  assert.deepEqual(result.changed, FILES);
  assert.deepEqual((await applyTree(root)).changed, []);
  assert.equal(classifyText(await readFile(join(root, FILES[0]), "utf8")), "patched");
});

test("unknown anchor refuses the entire tree before writing", async (t) => {
  const root = await sandbox(t);
  await writeFile(join(root, FILES[0]), `${source}\n${EDITS[0].anchor}`);
  await assert.rejects(applyTree(root), { kind: "anchor" });
  assert.equal(await readFile(join(root, FILES[0]), "utf8"), `${source}\n${EDITS[0].anchor}`);
});

test("an unsupported update remains read-only until requalified", async (t) => {
  const root = await sandbox(t, source, "9.0.0");
  assert.equal((await checkTree(root)).supported, false);
  await assert.rejects(applyTree(root), { kind: "version" });
  assert.equal(await readFile(join(root, FILES[0]), "utf8"), source);
});
