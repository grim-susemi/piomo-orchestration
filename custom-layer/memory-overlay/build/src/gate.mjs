import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const modules = "C:/Users/USER/.bun/install/global/node_modules";
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

export async function verifyPayload(expectedManifestSha, root = path.dirname(fileURLToPath(import.meta.url))) {
  const raw = await readFile(path.join(root, "manifest.json"));
  if (digest(raw) !== expectedManifestSha) throw new Error("Overlay manifest digest mismatch");
  const manifest = JSON.parse(raw);
  if (manifest.omo !== "5.1.38" || manifest.senpi !== "2026.10.19" || manifest.revision !== "memory-rollback-r1") {
    throw new Error("Unsupported overlay identity");
  }
  const omo = await readJson(`${modules}/omo-ai/package.json`);
  const senpi = await readJson(`${modules}/@code-yeongyu/senpi/package.json`);
  const stamp = (await readFile(`${modules}/@code-yeongyu/senpi/.omo-engine-prepared`, "utf8")).trim();
  if (omo.version !== manifest.omo || senpi.version !== manifest.senpi || stamp !== manifest.omo) {
    throw new Error("Installed version or engine preparation stamp drifted");
  }
  for (const file of manifest.bundles) {
    if (digest(await readFile(`${modules}/omo-ai/plugin/extensions/${file.name}`)) !== file.beforeSha256) {
      throw new Error(`Installed upstream bytes drifted: ${file.name}`);
    }
    if (digest(await readFile(path.join(root, "package/plugin/extensions", file.name))) !== file.afterSha256) {
      throw new Error(`Overlay bytes drifted: ${file.name}`);
    }
  }
  for (const file of manifest.entryFiles) {
    if (digest(await readFile(path.join(root, "package", file.path))) !== file.sha256) {
      throw new Error(`Overlay entry drifted: ${file.path}`);
    }
  }
  if ((await realpath(path.join(root, "package/node_modules"))).toLowerCase() !== (await realpath(modules)).toLowerCase()) {
    throw new Error("Overlay dependency junction is not the pinned installed module tree");
  }
  return { revision: manifest.revision, omo: manifest.omo, senpi: manifest.senpi, bundles: manifest.bundles.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ ok: true, ...await verifyPayload(process.argv[2]) }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
