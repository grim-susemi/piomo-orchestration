#!/usr/bin/env node
// Source-derived probe for the compaction session-header patch.
//
//   probe.mjs --senpi-root <dir> [--from-backups]
//
// The runtime module graph is intentionally not imported: the builtin
// compaction module pulls the full provider barrel and a probe must stay cheap
// and offline. The probe instead reads the installed bytes and checks the two
// links that make the header appear:
//   1. generateSummaryMessage forwards the session id to summarizationStream;
//   2. the opencode / opencode-go provider wrapper turns options.sessionId into
//      `x-opencode-session` when that header is absent.
// Verdict: defect-absent when both links are present, defect-present otherwise.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SUFFIX = ".opencode-session.bak";
const CORE_FILE = "dist/core/extensions/builtin/compaction/speculative-summary.js";
const CHUNK_DIR = "dist/bundle/chunks";

const SESSION_CALL = "compactionSessionId(options.context, options.snapshot.model)";
const SESSION_FORWARD = "...(sessionId ? { sessionId } : {})";

function parseArgs(argv) {
  let senpiRoot;
  let fromBackups = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--senpi-root") senpiRoot = argv[++index];
    else if (arg === "--from-backups") fromBackups = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!senpiRoot) throw new Error("usage: probe.mjs --senpi-root <dir> [--from-backups]");
  return { senpiRoot: resolve(senpiRoot), fromBackups };
}

/** Body of a named function, brace-matched from its opening `{`. */
function extractFunctionBody(text, name) {
  const patterns = [
    new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`),
    new RegExp(`async\\s+function\\s+${name}\\s*\\(`),
    new RegExp(`function\\s+${name}\\s*\\(`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const open = text.indexOf("{", match.index + match[0].length);
    if (open === -1) return undefined;
    let depth = 0;
    for (let index = open; index < text.length; index += 1) {
      const char = text[index];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(open, index + 1);
      }
    }
    return undefined;
  }
  return undefined;
}

async function providerWrapperHasSessionHeader(root) {
  const dir = join(root, CHUNK_DIR);
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return { ok: false, reason: "bundle chunk directory missing" };
  }
  for (const name of names) {
    if (!/^chunk-.*\.js$/.test(name) && name !== "session-worker.js") continue;
    let text;
    try {
      text = await readFile(join(dir, name), "utf8");
    } catch {
      continue;
    }
    const hasHeaderConstant = text.includes('OPENCODE_SESSION_HEADER="x-opencode-session"');
    const hasSessionHeader = text.includes("[OPENCODE_SESSION_HEADER]:options.sessionId");
    const wrapsOpenCode =
      text.includes("withOpenCodeSessionHeader(openAICompletionsApi())") ||
      text.includes("withOpenCodeSessionHeader(anthropicMessagesApi())") ||
      text.includes("withOpenCodeSessionHeader(googleGenerativeAIApi())") ||
      text.includes("withOpenCodeSessionHeader(openAIResponsesApi())");
    if (hasHeaderConstant && hasSessionHeader && wrapsOpenCode) {
      return { ok: true, chunk: name };
    }
  }
  return { ok: false, reason: "opencode session-header wrapper not found" };
}

async function probe(senpiRoot, fromBackups) {
  const corePath = join(senpiRoot, CORE_FILE);
  const core = fromBackups ? await readFile(corePath + BACKUP_SUFFIX, "utf8") : await readFile(corePath, "utf8");
  const body = extractFunctionBody(core, "generateSummaryMessage");
  const callPresent = Boolean(body?.includes(SESSION_CALL));
  const forwardPresent = Boolean(body?.includes(SESSION_FORWARD));
  const wrapper = await providerWrapperHasSessionHeader(senpiRoot);
  const ok = callPresent && forwardPresent && wrapper.ok;
  return {
    verdict: ok ? "defect-absent" : "defect-present",
    source: fromBackups ? "backup" : "installed",
    summaryCall: callPresent,
    summaryForward: forwardPresent,
    providerWrapper: wrapper.ok,
    chunk: wrapper.chunk ?? null,
    reason: wrapper.reason ?? null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const { senpiRoot, fromBackups } = parseArgs(argv);
  try {
    const result = await probe(senpiRoot, fromBackups);
    console.log("PROBE " + JSON.stringify(result));
    return 0;
  } catch (error) {
    console.log("PROBE " + JSON.stringify({ verdict: "error", error: error?.message ?? String(error) }));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error?.stack ?? String(error));
      process.exit(1);
    },
  );
}

export { probe };
