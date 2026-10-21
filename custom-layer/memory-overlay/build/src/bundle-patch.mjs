import { createHash } from "node:crypto";

export const UPSTREAM = Object.freeze({
  repository: "code-yeongyu/oh-my-openagent",
  pull: 10000,
  head: "4406c7776ca6582cc206819fadc1b34a060d4729",
  base: "90ba59d80a16732f3e56892478c42f773105062c",
});
export const VERSION = Object.freeze({ omo: "5.1.38", senpi: "2026.10.19", revision: "memory-rollback-r1" });
export const PINS = Object.freeze({
  "omo.js": "de9603b563e9bca417f431006e0ced5bab0e126dc3b530b5fd1e83c0371cff69",
  "omo-memory-memfs.js": "8b40193e6882b3451ffa4b1b879fa7528e5557896191517b4352740b796d6260",
  "omo-memory-doctor.js": "fb63df01193939faacb3152f802368b7b6fa36a3c4de0df5bdfd02b8f3c3c8a4",
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
    '["add","-A","--",',
  ]) {
    body = replaceOne(body, `this.git(${prefix}`, `this.git(["--literal-pathspecs",${prefix.slice(1)}`, `${name} ${prefix}`);
  }
  if (name === "omo.js") {
    // 5.1.38 bindings, re-derived from the pinned bundle bytes: wB=DirtyRepoError
    // ("Memory repo has uncommitted changes..."), OK=MemorySecretError, LV=MemoryToolError
    // (thrown wrapper), zG=stranded git lock error whose upstream rollback zV is kept first
    // and unchanged. The 5.1.35 names (pB/qW/$J) are NOT reused; anchors are verified unique.
    body = replaceOne(body,
      "if(e instanceof OK)throw await t.restorePaths(l),new LV(e.message,{cause:e});if(e instanceof zG)return zV(t,l,e);throw e}",
      "if(e instanceof zG)return zV(t,l,e);if(e instanceof wB)throw e;await t.restorePaths(l);if(e instanceof OK)throw new LV(e.message,{cause:e});throw e}",
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
