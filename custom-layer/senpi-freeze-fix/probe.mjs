#!/usr/bin/env node
// Defect probe for the senpi freeze fix (plan research-session-freeze-fix, D3).
//
//   probe.mjs --senpi-root <dir> [--from-backups]
//
// Copies dist to a temp directory, optionally overlays every .freeze-fix.bak
// onto its file (the pre-patch state), and answers two questions:
//
//   urlExtraction       does commandPaths() turn "curl https://github.com/a"
//                       into a path starting with // or \\ ?
//   syncWalkerFallback  does canonicalizeFilesystemPath still call
//                       realpathWithoutOpenStrict, with no UNC timeout guard?
//
// Prints PROBE {json} and deletes the temp copy. Exit 0 whenever a verdict was
// produced; exit 1 only when the copy or an import failed.

import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMMAND_PATHS =
  "core/extensions/builtin/moved-path-guard/command-paths.js";
const FILESYSTEM_POLICY = "core/tools/filesystem-policy.js";
const BACKUP_SUFFIX = ".freeze-fix.bak";

function parseArgs(argv) {
  let senpiRoot;
  let fromBackups = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--senpi-root") senpiRoot = argv[++index];
    else if (arg === "--from-backups") fromBackups = true;
    else {
      process.stderr.write(
        "usage: probe.mjs --senpi-root <dir> [--from-backups]\n"
      );
      process.exit(2);
    }
  }
  if (!senpiRoot) {
    process.stderr.write("usage: probe.mjs --senpi-root <dir> [--from-backups]\n");
    process.exit(2);
  }
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

async function overlayBackups(copyRoot) {
  const entries = await readdir(copyRoot, { recursive: true });
  let overlaid = 0;
  for (const entry of entries) {
    if (!entry.endsWith(BACKUP_SUFFIX)) continue;
    const backupPath = join(copyRoot, entry);
    const targetPath = join(copyRoot, entry.slice(0, -BACKUP_SUFFIX.length));
    await writeFile(targetPath, await readFile(backupPath));
    overlaid += 1;
  }
  return overlaid;
}

async function probe(senpiRoot, fromBackups) {
  const tempRoot = await mkdtemp(join(tmpdir(), "freeze-fix-probe-"));
  const copyRoot = join(tempRoot, "dist");
  try {
    await cp(join(senpiRoot, "dist"), copyRoot, { recursive: true });
    const overlaid = fromBackups ? await overlayBackups(copyRoot) : 0;

    const commandPathsModule = await import(
      pathToFileURL(join(copyRoot, COMMAND_PATHS)).href
    );
    const paths = commandPathsModule.commandPaths("curl https://github.com/a", "C:/");
    const urlExtraction = paths.some(
      (path) => path.startsWith("//") || path.startsWith("\\")
    )
      ? "present"
      : "absent";

    const policyText = await readFile(join(copyRoot, FILESYSTEM_POLICY), "utf8");
    const body = extractFunctionBody(policyText, "canonicalizeFilesystemPath");
    let syncWalkerFallback;
    if (body === undefined) syncWalkerFallback = "unrecognized";
    else if (!body.includes("realpathWithoutOpenStrict(")) syncWalkerFallback = "absent";
    else if (!body.includes("omoFreezeFixUncTimeout")) syncWalkerFallback = "present";
    else syncWalkerFallback = "absent";

    let verdict;
    if (urlExtraction === "absent" && syncWalkerFallback === "absent") {
      verdict = "defect-absent";
    } else if (urlExtraction === "present" || syncWalkerFallback === "present") {
      verdict = "defect-present";
    } else {
      verdict = "needs-review";
    }

    return {
      senpiRoot,
      fromBackups,
      overlays: overlaid,
      urlExtraction,
      syncWalkerFallback,
      verdict,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const { senpiRoot, fromBackups } = parseArgs(process.argv.slice(2));
  try {
    const result = await probe(senpiRoot, fromBackups);
    process.stdout.write(`PROBE ${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    process.stdout.write(
      `PROBE ${JSON.stringify({ senpiRoot, fromBackups, error: error.message })}\n`
    );
    process.exit(1);
  }
}

main();
