#!/usr/bin/env node
// This candidate is deliberately fenced to disposable fixtures, not shared installations.
import { readFile, writeFile, realpath, rename, unlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep, isAbsolute, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { BASELINE_SHA256, FILE, VERSION, PatchError, sha256, transformText } from "./patch.mjs";

export const AFTER_SHA256 = "64112d39dcdc24069e759481c92b420a109c879c6fdaab7087de054d573204c4";
export const FIXTURE_MARKER = ".task-owned-work-disposable.json";
const SUFFIX = ".task-owned-work-reclaim-guard";

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function fixtureTarget(root) {
  const canonical = await realpath(root);
  const temporaryRoot = await realpath(tmpdir());
  if (!inside(temporaryRoot, canonical) || !basename(canonical).startsWith("task-owned-work-fixture-")) {
    throw new PatchError("fixture-only", "Only disposable task-owned-work-fixture-* roots under os.tmpdir() are accepted");
  }
  const markerPath = join(canonical, FIXTURE_MARKER);
  if ((await lstat(markerPath)).isSymbolicLink()) throw new PatchError("fixture-only", "Fixture marker cannot be a link");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  if (marker.schema !== "task-owned-work-disposable-v1" || marker.disposable !== true) {
    throw new PatchError("fixture-only", "Explicit disposable fixture marker required");
  }
  const { version } = JSON.parse(await readFile(join(canonical, "package.json"), "utf8"));
  if (version !== VERSION) throw new PatchError("version", `Unqualified fixture version: ${version}`);
  const file = join(canonical, FILE);
  if ((await lstat(file)).isSymbolicLink() || !inside(canonical, await realpath(file))) {
    throw new PatchError("fixture-only", "Fixture target cannot escape its root");
  }
  // A parent junction must not redirect the target even if the leaf itself is a regular file.
  if (!inside(canonical, await realpath(dirname(file)))) throw new PatchError("fixture-only", "Fixture directory escapes its root");
  return file;
}

export async function installFixture(root, direction = "apply") {
  if (direction !== "apply" && direction !== "remove") throw new PatchError("argument", "Expected apply or remove");
  const file = await fixtureTarget(resolve(root));
  const before = await readFile(file);
  const beforeHash = sha256(before);
  const expectedBefore = direction === "apply" ? BASELINE_SHA256 : AFTER_SHA256;
  const expectedAfter = direction === "apply" ? AFTER_SHA256 : BASELINE_SHA256;
  if (beforeHash === expectedAfter) return { changed: false, direction, file, sha256: beforeHash, fixtureOnly: true };
  if (beforeHash !== expectedBefore) throw new PatchError("drift", "Whole target hash differs; nothing changed");
  const after = Buffer.from(transformText(before.toString("utf8"), direction));
  if (sha256(after) !== expectedAfter) throw new PatchError("output-hash", "Transformed output is not qualified");
  const backup = `${file}${SUFFIX}.bak`;
  if (direction === "apply") {
    try {
      await writeFile(backup, before, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if ((await lstat(backup)).isSymbolicLink() || sha256(await readFile(backup)) !== BASELINE_SHA256) {
        throw new PatchError("backup-drift", "Existing backup is foreign; preserve it");
      }
    }
  }
  const temporary = `${file}${SUFFIX}.new`;
  let created = false;
  try {
    await writeFile(temporary, after, { flag: "wx" });
    created = true;
    if (sha256(await readFile(temporary)) !== expectedAfter) throw new PatchError("output-hash", "Staged bytes differ");
    if (sha256(await readFile(file)) !== beforeHash) throw new PatchError("drift", "Target changed before replacement; preserve it");
    await rename(temporary, file);
    created = false;
    const observed = sha256(await readFile(file));
    if (observed !== expectedAfter) throw new PatchError("post-write-drift", "Target changed after replacement; do not restore over it");
    return { changed: true, direction, file, beforeSha256: beforeHash, sha256: observed, backup, fixtureOnly: true };
  } finally {
    // Never delete an existing temporary file we did not create.
    if (created) await unlink(temporary);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3 || argv[0] !== "--fixture-root" || !["--apply", "--remove"].includes(argv[2])) {
    throw new PatchError("argument", "Use --fixture-root <disposable-root> --apply|--remove; installed roots are forbidden");
  }
  const result = await installFixture(argv[1], argv[2].slice(2));
  console.log(`FIXTURE_INSTALL ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 2;
  });
}
