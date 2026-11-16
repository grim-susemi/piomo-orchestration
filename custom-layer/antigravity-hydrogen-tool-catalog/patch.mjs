import { createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASELINE = "ed5d4f981ff77e4d262e5d461f50a45d78c8dc3b03e7f1bd08720e034dac935c";
const ORIGINAL = "const toolCatalogNudge = buildNonOpenAIToolCatalogNudgeForTools(parsed.context.tools, parsed.options.toolChoice);";
const CANDIDATE = 'const toolCatalogNudge = /*piomo-hydrogen-tool-catalog*/ isCloudCodeAssist && /^gemini-4-hydrogen(?:-|$)/.test(identityModelId) ? undefined : buildNonOpenAIToolCatalogNudgeForTools(parsed.context.tools, parsed.options.toolChoice);';
const hash = source => createHash("sha256").update(source).digest("hex");

// Exact source qualification prevents this delta from overwriting an update or another writer.
export function transform(source) {
  const pristine = source.includes(CANDIDATE) ? source.replace(CANDIDATE, ORIGINAL) : source;
  if (hash(pristine) !== BASELINE || pristine.split(ORIGINAL).length !== 2) {
    throw new TypeError("Unqualified Google adapter: run official behavioral probe and rederive or retire");
  }
  return pristine.replace(ORIGINAL, CANDIDATE);
}

async function main(args) {
  const rootAt = args.indexOf("--ocx-root");
  const root = args[rootAt + 1];
  if (rootAt < 0 || !root) throw new TypeError("--ocx-root required");
  const target = join(resolve(root), "src/adapters/google.ts");
  const source = await readFile(target, "utf8");
  const candidate = transform(source);
  const apply = args.includes("--apply");
  const backup = target + ".bak-piomo-hydrogen-tool-catalog";
  if (apply && candidate !== source) {
    if (hash(await readFile(target)) !== hash(source)) throw new TypeError("Concurrent adapter change");
    await writeFile(backup, source, { flag: "wx" });
    const temporary = target + ".new-piomo-hydrogen-tool-catalog";
    await writeFile(temporary, candidate, { flag: "wx" });
    await rename(temporary, target);
  }
  console.log(JSON.stringify({
    status: apply ? "applied-on-disk" : candidate === source ? "patched" : "candidate",
    target, before: hash(source), after: hash(candidate),
    backup: apply ? backup : undefined, liveLoadVerified: false,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
