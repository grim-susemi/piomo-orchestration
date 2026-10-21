import { createHash } from "node:crypto";

export const UPSTREAM = Object.freeze({
  repository: "code-yeongyu/oh-my-openagent",
  pull: 10000,
  head: "dd86ddb7f9fd919ed4921bca2668c0016be7817e",
  base: "c2c258d6ea7284b3aeae052fbcee3a5231e0793e",
});
export const VERSION = Object.freeze({ omo: "5.1.40", senpi: "2026.10.19-2", revision: "memory-rollback-r1" });
export const PINS = Object.freeze({
  "omo.js": "99262013ba80365491acdb1224291f6f41c5b0e1013e07ca605e452ed8c83b19",
  "omo-memory-memfs.js": "a1c8a81358b7e5f22f323040d5489d13c33d756ee710fa5f5d79187667d33b7b",
  "omo-memory-doctor.js": "cdea5f06ea8b37cd6bd3c3171d24785af747b423f7ea8bd8acf6d53032801bfa",
});

export class PatchRefused extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "PatchRefused";
    this.code = code;
  }
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function replaceOne(text, before, after, name) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new PatchRefused("anchor_mismatch", `${name} has ${count} matches`);
  return text.replace(before, after);
}

export function patchBundle(name, input) {
  const expected = PINS[name];
  if (!expected || sha256(input) !== expected) throw new PatchRefused("hash_mismatch", name);
  const source = input.toString("utf8");
  const newline = source.indexOf("\n");
  const header = /^\/\/ omo:([^:]+):([A-Za-z0-9_-]+)$/.exec(source.slice(0, newline));
  if (!header) throw new PatchRefused("header_mismatch", name);
  const originalBody = source.slice(newline + 1);
  if (createHash("sha256").update(originalBody).digest("base64url") !== header[2]) {
    throw new PatchRefused("body_digest_mismatch", name);
  }
  let body = originalBody;
  for (const prefix of [
    '["-c","core.quotePath=false","status","--porcelain","--untracked-files=all",',
    '["restore","--source=HEAD","--staged","--worktree","--",',
    '["rm","-q","--cached","--ignore-unmatch","--",',
    // unstage(): added to the PR at head dd86ddb7 (the R21 overlay on head 4406c777 had 4 sites).
    '["restore","--source=HEAD","--staged","--",',
    '["rm","-q","--cached","-f","--ignore-unmatch","--",',
    '["add","-A","--",',
  ]) {
    body = replaceOne(body, `this.git(${prefix}`, `this.git(["--literal-pathspecs",${prefix.slice(1)}`, `${name} ${prefix}`);
  }
  if (name === "omo.js") {
    // 5.1.40 bindings, re-derived from the pinned bundle bytes: oP=NoEffectiveChangesError
    // ("Memory write produced no effective changes"), iP=DirtyRepoError ("Memory repo has
    // uncommitted changes..."), lM=MemorySecretError, yD=MemoryToolError, vN=StrandedGitLockError
    // and vD=undoBehindKeptLock. Order follows commit-write.ts at PR head dd86ddb7:
    // no-effective-changes first, then stranded lock, dirty repo rethrown, restore, secret wrap.
    // The 5.1.38 names (OK/LV/zG/zV/wB) are NOT reused; anchors are verified unique.
    body = replaceOne(body,
      'if(e instanceof oP)throw new yD(s??"made no effective changes",{cause:e});if(e instanceof lM)throw await t.restorePaths(l),new yD(e.message,{cause:e});if(e instanceof vN)return vD(t,l,e);throw e}',
      'if(e instanceof oP)throw new yD(s??"made no effective changes",{cause:e});if(e instanceof vN)return vD(t,l,e);if(e instanceof iP)throw e;await t.restorePaths(l);if(e instanceof lM)throw new yD(e.message,{cause:e});throw e}',
      "commitMemoryWrite catch");
  }
  const notice = `// Locally modified: ${VERSION.revision} on omo-ai ${VERSION.omo}; PR #10000 at ${UPSTREAM.head}. See overlay NOTICE.md.\n`;
  body = notice + body;
  const bodyHash = createHash("sha256").update(body).digest("base64url");
  // The first token identifies the untouched upstream source base; the second is the new actual body digest.
  const output = Buffer.from(`// omo:${header[1]}:${bodyHash}\n${body}`, "utf8");
  return Object.freeze({
    output,
    beforeSha256: expected,
    afterSha256: sha256(output),
    upstreamSourceFingerprint: header[1],
    bodyDigest: bodyHash,
  });
}
