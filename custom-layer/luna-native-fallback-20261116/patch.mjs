import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const baselineHash = "38c425f04338441641980f6e8d3fa1993728072a2cf8cc1b6700f91e935de505";
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const here = path.dirname(fileURLToPath(import.meta.url));
const recordBefore = "  delete record.fallback_models;\n  return JSON.stringify(record);";
const recordAfter = `  // Preserve only the owner's designated Luna low backup.
  const designated = record.fallback_models.filter(model =>
    model.provider === "chatgpt-subscription" && model.model_id === "gpt-6-luna" &&
    (model.reasoning ?? model.reasoning_effort ?? model.variant) === "low");
  if (designated.length === 0) delete record.fallback_models;
  else record.fallback_models = designated;
  return JSON.stringify(record);`;
const settingsBefore = "    return { ...original.call(this), modelFallback: false };";
const settingsAfter = `    const settings = original.call(this);
    const chains = Object.fromEntries(Object.entries(settings.chains).map(([key, models]) =>
      [key, models.filter(model => model === "chatgpt-subscription/gpt-6-luna:low")]));
    return { ...settings, chains, modelFallback: settings.modelFallback &&
      Object.values(chains).some(models => models.length > 0) };`;

class PatchQualificationError extends Error {}

export function transform(bytes) {
  if (hash(bytes) !== baselineHash) throw new PatchQualificationError("Unknown original bytes; run the behavioral probe before rederive or retirement.");
  let source = bytes.toString("utf8");
  for (const [before, after] of [[recordBefore, recordAfter], [settingsBefore, settingsAfter]]) {
    if (source.split(before).length !== 2) throw new PatchQualificationError("Expected exactly one qualified anchor.");
    source = source.replace(before, after);
  }
  return Buffer.from(source);
}

function main() {
  const [mode, target] = process.argv.slice(2);
  if (!["--candidate", "--apply", "--check"].includes(mode) || !target) {
    throw new PatchQualificationError("Usage: node patch.mjs --candidate|--apply|--check <installed-guard-file>");
  }
  const bytes = fs.readFileSync(target);
  const originalFile = path.join(here, "original.js");
  const original = hash(bytes) === baselineHash ? bytes : fs.readFileSync(originalFile);
  const candidate = transform(original);
  const candidateHash = hash(candidate);
  const currentHash = hash(bytes);
  if (mode === "--check") {
    const status = currentHash === candidateHash ? "applied" : currentHash === baselineHash ? "defect-present" : "unknown-rederive-or-probe";
    console.log(JSON.stringify({ status, target, currentHash, baselineHash, candidateHash }));
    process.exitCode = status === "applied" ? 0 : 1;
    return;
  }
  if (currentHash !== baselineHash && currentHash !== candidateHash) throw new PatchQualificationError("Target drift; no file was changed.");
  if (fs.existsSync(originalFile)) {
    if (hash(fs.readFileSync(originalFile)) !== baselineHash) throw new PatchQualificationError("Preserved original drift.");
  } else fs.writeFileSync(originalFile, original, { flag: "wx" });
  const candidateFile = path.join(here, "candidate.js");
  fs.writeFileSync(candidateFile, candidate);
  if (mode === "--apply" && currentHash !== candidateHash) {
    const backup = `${target}.bak-luna-native-fallback-20261116`;
    if (fs.existsSync(backup)) {
      if (hash(fs.readFileSync(backup)) !== baselineHash) throw new PatchQualificationError("Backup drift; no install.");
    } else fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(target, candidate);
    if (hash(fs.readFileSync(target)) !== candidateHash) throw new PatchQualificationError("Installed hash mismatch.");
  }
  console.log(JSON.stringify({ status: mode === "--apply" ? "applied" : "candidate", target, baselineHash, candidateHash }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
