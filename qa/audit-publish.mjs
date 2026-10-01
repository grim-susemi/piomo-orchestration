#!/usr/bin/env node
// qa/audit-publish.mjs — source-only publish boundary audit for PiOMO Orchestration Mod.
//
// Usage:
//   node qa/audit-publish.mjs --root <curated-root> --allowlist provenance/allowlist.json --strict
//     [--ref <git-ref>] [--out <receipt.json>]
//
// Behaviour:
//   - Worktree mode (no --ref): audits every file under --root except VCS metadata (.git).
//   - Ref mode (--ref): audits the exact reachable file list of that git ref (for task 9).
//   - Every candidate path is classified against the allowlist (exact allowedPaths >
//     deniedPatterns > allowedPatterns > default-deny). Non-files (symlinks/junctions) are
//     violations.
//   - Every candidate file's content is synthetically inspected for secret tokens. Matched
//     values are NEVER printed: findings carry only path, line, pattern id, value length and
//     a truncated sha256 of the matched value.
//   - Exit codes: 0 pass; 2 violations (with --strict, also any violation otherwise only
//     reported); 64 usage; 66 missing allowlist; 70 internal error.

import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { execFileSync } from "node:child_process";

const EXIT_OK = 0;
const EXIT_VIOLATIONS = 2;
const EXIT_USAGE = 64;
const EXIT_NO_ALLOWLIST = 66;
const EXIT_INTERNAL = 70;

const SECRET_PATTERNS = [
  { id: "github-classic-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: "github-fine-grained-token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: "openai-like-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    id: "credential-json-field",
    re:
      /"(?:api[-_]?key|apikey|secret|access[-_]?token|auth[-_]?token|client[-_]?secret|private[-_]?key|password)"\s*:\s*"(?:[^"\\]|\\.){8,}"/gi,
  },
  { id: "bearer-token", re: /\bBearer\s+[A-Za-z0-9_\-.=]{25,}\b/g },
];

function usage() {
  process.stderr.write(
    "usage: node qa/audit-publish.mjs --root <curated-root> --allowlist provenance/allowlist.json " +
      "[--strict] [--ref <git-ref>] [--out <receipt.json>]\n",
  );
}

function parseArgs(argv) {
  const args = { strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") args.strict = true;
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--allowlist") args.allowlist = argv[++i];
    else if (a === "--ref") args.ref = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else {
      usage();
      process.exit(EXIT_USAGE);
    }
  }
  if (!args.root || !args.allowlist) {
    usage();
    process.exit(EXIT_USAGE);
  }
  return args;
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:[^/]*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function classifyPath(path, al) {
  if (al.allowedPaths.includes(path)) {
    return { allowed: true, rule: `allowedPaths:${path}` };
  }
  for (const g of al._deny) {
    if (g.re.test(path)) {
      return { allowed: false, code: "PROHIBITED_PATH", rule: `deniedPatterns:${g.glob}` };
    }
  }
  for (const g of al._allow) {
    if (g.re.test(path)) {
      return { allowed: true, rule: `allowedPatterns:${g.glob}` };
    }
  }
  return { allowed: false, code: "PROHIBITED_PATH", rule: "default-deny" };
}

function scanSecrets(text) {
  const findings = [];
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const value = m[0];
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({
        pattern: p.id,
        line,
        valueLength: value.length,
        valueSha256: createHash("sha256").update(value).digest("hex").slice(0, 16),
        value: "<redacted>",
      });
    }
  }
  return findings;
}

function isProbablyBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function toRelPosix(full, rootDir) {
  return posix.normalize(relative(rootDir, full).split(sep).join("/"));
}

function* walkTree(dir, rootDir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (dir === rootDir && e.name === ".git" && (e.isDirectory() || e.isFile())) continue;
    if (e.isSymbolicLink()) {
      yield { special: full };
    } else if (e.isDirectory()) {
      yield* walkTree(full, rootDir);
    } else if (e.isFile()) {
      yield { file: full };
    } else {
      yield { special: full };
    }
  }
}

function listRefFiles(rootDir, ref) {
  const out = execFileSync("git", ["-C", rootDir, "ls-tree", "-r", "--name-only", "-z", ref], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  return out.split("\0").filter(Boolean);
}

function readRefBlob(rootDir, ref, path) {
  return execFileSync("git", ["-C", rootDir, "cat-file", "blob", `${ref}:${path}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

function loadAllowlist(rootDir, allowlistArg) {
  const allowlistPath = isAbsolute(allowlistArg) ? allowlistArg : resolve(process.cwd(), allowlistArg);
  if (!existsSync(allowlistPath)) {
    process.stderr.write(`ALLOWLIST_MISSING: ${allowlistPath}\n`);
    process.exit(EXIT_NO_ALLOWLIST);
  }
  const raw = JSON.parse(readFileSync(allowlistPath, "utf8"));
  const al = {
    allowedPaths: raw.allowedPaths ?? [],
    allowedPatterns: raw.allowedPatterns ?? [],
    deniedPatterns: raw.deniedPatterns ?? [],
    _allow: (raw.allowedPatterns ?? []).map((glob) => ({ glob, re: globToRegExp(glob) })),
    _deny: (raw.deniedPatterns ?? []).map((glob) => ({ glob, re: globToRegExp(glob) })),
  };
  const selfPath = toRelPosix(allowlistPath, rootDir);
  if (!selfPath.startsWith("../") && !al.allowedPaths.includes(selfPath)) {
    process.stderr.write(`ALLOWLIST_SELF_NOT_ALLOWED: ${selfPath}\n`);
    process.exit(EXIT_INTERNAL);
  }
  return { al, selfPath };
}

function audit(args) {
  const rootDir = resolve(args.root);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    process.stderr.write(`ROOT_MISSING: ${rootDir}\n`);
    process.exit(EXIT_USAGE);
  }
  const { al } = loadAllowlist(rootDir, args.allowlist);

  const violations = [];
  const secrets = [];
  const scannedFiles = [];
  let fileCount = 0;

  const handleCandidate = (relPath, readContent) => {
    fileCount++;
    const verdict = classifyPath(relPath, al);
    if (!verdict.allowed) {
      violations.push({ path: relPath, code: verdict.code, rule: verdict.rule });
    }
    const content = readContent();
    if (content === null) return; // binary: path/type checks only
    const findings = scanSecrets(content);
    for (const f of findings) {
      secrets.push({ path: relPath, ...f });
    }
    scannedFiles.push(relPath);
  };

  if (args.ref) {
    for (const relPath of listRefFiles(rootDir, args.ref)) {
      handleCandidate(relPath, () => {
        const buf = readRefBlob(rootDir, args.ref, relPath);
        return isProbablyBinary(buf) ? null : buf.toString("utf8");
      });
    }
  } else {
    for (const entry of walkTree(rootDir, rootDir)) {
      if (entry.special) {
        const relPath = toRelPosix(entry.special, rootDir);
        violations.push({ path: relPath, code: "SYMLINK", rule: "non-regular-file" });
        continue;
      }
      const relPath = toRelPosix(entry.file, rootDir);
      handleCandidate(relPath, () => {
        const buf = readFileSync(entry.file);
        return isProbablyBinary(buf) ? null : buf.toString("utf8");
      });
    }
  }

  const violationsTotal = violations.length + secrets.length;
  const receipt = {
    tool: "qa/audit-publish.mjs",
    schema: "piomo.publish-audit/1",
    root: rootDir,
    allowlist: resolve(process.cwd(), args.allowlist),
    ref: args.ref ?? null,
    strict: args.strict,
    counts: {
      candidateFiles: fileCount,
      secretScannedFiles: scannedFiles.length,
      prohibitedPaths: violations.filter((v) => v.code === "PROHIBITED_PATH").length,
      symlinks: violations.filter((v) => v.code === "SYMLINK").length,
      secretFindings: secrets.length,
    },
    violations,
    secrets,
    verdict: violationsTotal === 0 ? "PASS" : "FAIL",
  };

  const summary = `audit-publish: files=${fileCount} prohibited=${receipt.counts.prohibitedPaths} ` +
    `symlinks=${receipt.counts.symlinks} secrets=${receipt.counts.secretFindings} verdict=${receipt.verdict}`;
  process.stdout.write(summary + "\n");
  for (const v of violations) {
    process.stdout.write(`${v.code}: ${v.path} (${v.rule})\n`);
  }
  for (const s of secrets) {
    process.stdout.write(
      `SECRET_FOUND: ${s.path}:${s.line} pattern=${s.pattern} value=<redacted len=${s.valueLength} sha256=${s.valueSha256}>\n`,
    );
  }
  if (args.out) {
    const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
    writeFileSyncSafe(outPath, JSON.stringify(receipt, null, 2) + "\n");
  }
  if (violationsTotal > 0 && args.strict) return EXIT_VIOLATIONS;
  return EXIT_OK;
}

function writeFileSyncSafe(outPath, data) {
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, data);
}

try {
  const args = parseArgs(process.argv.slice(2));
  process.exit(audit(args));
} catch (err) {
  process.stderr.write(`AUDIT_ERROR: ${err && err.message ? err.message : String(err)}\n`);
  process.exit(EXIT_INTERNAL);
}
