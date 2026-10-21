#!/usr/bin/env node
// Managed delta: allow explicitly requested plan review after execution.
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = "5.1.40";
// 5.1.38 stays supported so the same script can check or remove the delta on a rolled-back install.
export const SUPPORTED_VERSIONS = Object.freeze(["5.1.38", VERSION]);
export const FILES = ["plugin/extensions/omo-task.js"];
export const EDITS = ["plan-consultant", "plan-reviewer"].map((name) => ({
  name,
  anchor: `"${name}":{requiresSkills:["ulw-plan"],requiresPlanArtifact:!0,forbidsSkills:["ulw-execute"]}`,
  replacement: `"${name}":{requiresSkills:["ulw-plan"],requiresPlanArtifact:!0,forbidsSkills:[]}`,
}));
EDITS.push({
  name: "tool-description",
  anchor: ", and ulw-execute was never invoked",
  replacement: ", including after an execution workflow",
});

export class PatchError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "PatchError";
    this.kind = kind;
  }
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function count(text, part) {
  return text.split(part).length - 1;
}

export function classifyText(text) {
  if (EDITS.every((e) => count(text, e.anchor) === 1 && count(text, e.replacement) === 0)) return "pristine";
  if (EDITS.every((e) => count(text, e.anchor) === 0 && count(text, e.replacement) === 1)) return "patched";
  return "unknown";
}

export function transformText(text, direction = "apply") {
  const expected = direction === "apply" ? "pristine" : "patched";
  if (classifyText(text) !== expected) throw new PatchError("anchor", `Expected ${expected} anchors`);
  let output = text;
  for (const edit of EDITS) {
    const from = direction === "apply" ? edit.anchor : edit.replacement;
    const to = direction === "apply" ? edit.replacement : edit.anchor;
    output = output.replace(from, () => to);
  }
  return output;
}

export async function checkTree(root) {
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const files = {};
  for (const file of FILES) {
    const text = await readFile(join(root, file), "utf8");
    files[file] = { state: classifyText(text), sha256: sha256(text) };
  }
  return { root, version, supported: SUPPORTED_VERSIONS.includes(version), files };
}

export async function applyTree(root) {
  const check = await checkTree(root);
  if (!check.supported) throw new PatchError("version", `Unsupported omo version: ${check.version}`);
  if (Object.values(check.files).some((f) => f.state === "unknown")) {
    throw new PatchError("anchor", "Unknown or partially edited gate; no file changed");
  }
  const pending = [];
  for (const file of FILES) {
    if (check.files[file].state === "patched") continue;
    const path = join(root, file);
    const before = await readFile(path, "utf8");
    if (sha256(before) !== check.files[file].sha256) throw new PatchError("drift", file);
    pending.push({ file, path, before, after: transformText(before) });
  }
  const written = [];
  try {
    for (const item of pending) {
      const backup = `${item.path}.plan-review-unlock.bak`;
      try {
        await writeFile(backup, item.before, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (await readFile(backup, "utf8") !== item.before) {
          throw new PatchError("backup-drift", item.file);
        }
      }
      const temporary = `${item.path}.plan-review-unlock.new`;
      await writeFile(temporary, item.after, { flag: "wx" });
      try {
        if (await readFile(item.path, "utf8") !== item.before) {
          throw new PatchError("drift", item.file);
        }
        await rename(temporary, item.path);
        written.push(item);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  } catch (error) {
    // Only undo our own bytes, never a concurrent editor's work.
    for (const item of written.reverse()) {
      if (await readFile(item.path, "utf8") !== item.after) {
        throw new PatchError("concurrent-change", `Manual reconciliation needed: ${item.path}`);
      }
      await writeFile(item.path, item.before);
    }
    throw error;
  }
  return { ...await checkTree(root), changed: pending.map((item) => item.file) };
}

export async function main(argv = process.argv.slice(2)) {
  let root;
  let mode;
  let receipt;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--omo-root": root = argv[++i]; break;
      case "--receipt": receipt = argv[++i]; break;
      case "--check": mode = "check"; break;
      case "--apply": mode = "apply"; break;
      default: throw new PatchError("argument", `Unknown argument: ${argv[i]}`);
    }
  }
  if (!root || !mode) throw new PatchError("argument", "Use --omo-root <dir> --check|--apply");
  const result = mode === "check" ? await checkTree(resolve(root)) : await applyTree(resolve(root));
  console.log(`${mode === "check" ? "CHECK" : "APPLIED"} ${JSON.stringify(result)}`);
  if (receipt) {
    await mkdir(dirname(resolve(receipt)), { recursive: true });
    await writeFile(resolve(receipt), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
