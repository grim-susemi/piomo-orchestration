import { readFile, writeFile, mkdir, cp, symlink, lstat, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchBundle, PINS, sha256, VERSION, UPSTREAM, PatchRefused } from "./bundle-patch.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = "C:/Users/USER/.omo-stable-500/staging/upgrade-5.1.40-inspect/pristine-omo-ai";
export const MODULES = "C:/Users/USER/.bun/install/global/node_modules";

export async function stagePackage(outputRoot) {
  const sourceVersion = JSON.parse(await readFile(`${SOURCE}/package.json`, "utf8")).version;
  if (sourceVersion !== VERSION.omo) {
    throw new PatchRefused("version_mismatch", `source ${sourceVersion}, expected ${VERSION.omo}`);
  }
  // The overlay is staged BEFORE the global install (its manifest digest is embedded in the
  // new wrapper/reentry candidates), so equality with the installed tree cannot be asserted
  // here. The committed gate.mjs asserts installed bundle bytes == manifest beforeSha256 on
  // every memory-capable launch, which binds the staged base to the installed 5.1.40 bytes.
  const changes = [];
  for (const name of Object.keys(PINS)) {
    const source = await readFile(`${SOURCE}/plugin/extensions/${name}`);
    changes.push({ name, ...patchBundle(name, source) });
  }
  try {
    await lstat(outputRoot);
    throw new PatchRefused("target_exists", outputRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(outputRoot), { recursive: true });
  const packageRoot = path.join(outputRoot, "package");
  await cp(SOURCE, packageRoot, { recursive: true, force: false, errorOnExist: true,
    filter: (source) => path.basename(source) !== "node_modules" });
  for (const change of changes) {
    await writeFile(path.join(packageRoot, "plugin/extensions", change.name), change.output);
  }
  await copyFile(`${project}/NOTICE.md`, `${packageRoot}/NOTICE.md`);
  await copyFile(`${project}/UPSTREAM-LICENSE.md`, `${packageRoot}/UPSTREAM-LICENSE.md`);
  await copyFile(`${project}/src/gate.mjs`, `${outputRoot}/gate.mjs`);
  await symlink(MODULES, `${packageRoot}/node_modules`, "junction");
  const entryFiles = [];
  for (const relative of ["package.json", "bin/omo.js", "bin/lib/launcher.js"]) {
    entryFiles.push({ path: relative, sha256: sha256(await readFile(path.join(packageRoot, relative))) });
  }
  const manifest = {
    revision: VERSION.revision, omo: VERSION.omo, senpi: VERSION.senpi,
    upstream: UPSTREAM,
    bundles: changes.map(({ name, output, ...record }) => ({ name, ...record })),
    entryFiles,
    gateSha256: sha256(await readFile(`${outputRoot}/gate.mjs`)),
  };
  const raw = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(`${outputRoot}/manifest.json`, raw, { flag: "wx" });
  return { outputRoot, manifestSha256: sha256(raw), ...manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new PatchRefused("missing_target", "supply a new owned staging directory");
    console.log(JSON.stringify(await stagePackage(path.resolve(process.argv[2])), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
