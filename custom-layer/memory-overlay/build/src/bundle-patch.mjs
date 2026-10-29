import { createHash } from "node:crypto";

export const UPSTREAM = Object.freeze({
  repository: "code-yeongyu/oh-my-openagent",
  pull: 10000,
  head: "4bec605458f7466eff0fae740db0d40c3486510c",
  base: "c2c258d6ea7284b3aeae052fbcee3a5231e0793e",
});
export const VERSION = Object.freeze({ omo: "5.1.48", senpi: "2026.10.25-2", revision: "memory-rollback-r1" });
export const PINS = Object.freeze({
  "omo.js": "56824d1cd5c625616dcde59c8e29cdb58064a7d46c88d41bba5387a6e6bc0e66",
  "omo-memory-memfs.js": "76e0704451a39c985dd5e6d78ddc12d84cea1e14c8f14ec1a5b3020ed047e13a",
  "omo-memory-doctor.js": "e9a1c6e210e63fb4d5caa5a0f2528d7f090482e143fecf11d2ec68ef929fd753",
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
    // 5.1.48 bindings, re-derived from the pinned bundle bytes: fC=NoEffectiveChangesError
    // ("Memory write produced no effective changes"), uC=DirtyRepoError ("Memory repo has
    // uncommitted changes..."), jD=MemorySecretError, JF=MemoryToolError, NM=StrandedGitLockError
    // and VF=undoBehindKeptLock. Upstream 5.1.48 restores only on a secret error; the delta
    // re-adds the transaction restore for any other failure while rethrowing the dirty repo
    // before any restore, then wraps the secret error. The 5.1.44 names (dP/lP/QM/PF/sM/jF)
    // and 5.1.40 names (oP/iP/lM/yD/vN/vD) are NOT reused; anchors are verified unique.
    body = replaceOne(body,
      'if(e instanceof fC)throw new JF(s??"made no effective changes",{cause:e});if(e instanceof jD)throw await t.restorePaths(d),new JF(e.message,{cause:e});if(e instanceof NM)return VF(t,d,e);throw e}',
      'if(e instanceof fC)throw new JF(s??"made no effective changes",{cause:e});if(e instanceof NM)return VF(t,d,e);if(e instanceof uC)throw e;await t.restorePaths(d);if(e instanceof jD)throw new JF(e.message,{cause:e});throw e}',
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
