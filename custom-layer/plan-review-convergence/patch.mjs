import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ANCHOR = "function Lk(e,t,n,r){";
export const WRAPPER = "let __prc=__prcGate(e,t,n,r);if(__prc)return __prc;";

export function patchHost(hostText, extensionPath) {
  const anchorCount = hostText.split(ANCHOR).length - 1;
  if (anchorCount !== 1) throw new Error(`ANCHOR_COUNT ${anchorCount}`);
  const extensionUrl = pathToFileURL(resolve(extensionPath)).href;
  const importLine = `import{gate as __prcGate}from${JSON.stringify(extensionUrl)};`;
  const lines = hostText.split("\n");
  const shebang = lines[0]?.startsWith("#!") ? `${lines.shift()}\n` : "";
  const body = lines.join("\n").replace(ANCHOR, `${ANCHOR}${WRAPPER}`);
  return `${shebang}${importLine}\n${body}`;
}

export function writePatchedHost({ hostPath, extensionPath, outPath }) {
  const patched = patchHost(readFileSync(hostPath, "utf8"), extensionPath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, patched, "utf8");
  return { outPath, anchor: ANCHOR, wrapper: WRAPPER };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const hostPath = value("--host");
  const extensionPath = value("--extension");
  const outPath = value("--out");
  if (!hostPath || !extensionPath || !outPath) {
    console.error("Use --host <omo-task.js> --extension <extension.mjs> --out <patched.js>");
    process.exitCode = 2;
  } else {
    try {
      const result = writePatchedHost({ hostPath, extensionPath, outPath });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(`PATCH_FAILED ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
