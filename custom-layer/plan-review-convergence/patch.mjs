import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The host decides its own plan-review admission first (`Ca`) and its own
// plan-review prompt contract second; the managed delta runs only after those
// decisions and before the spawn result leaves `Lk`.  This way a stock denial
// never leaves a candidate reservation behind.
export const ANCHOR = 'return"deny"===s?.kind?';
export const WRAPPER = "let __prc=__prcGate(e,t,n,r);if(__prc)return __prc;let __prcH=__prcHandoff(e,t,n,r);if(__prcH)return{kind:\"force\",prompt:__prcH};";

export function patchHost(hostText, extensionPath) {
  const anchorCount = hostText.split(ANCHOR).length - 1;
  if (anchorCount !== 1) throw new Error(`ANCHOR_COUNT ${anchorCount}`);
  const extensionUrl = pathToFileURL(resolve(extensionPath)).href;
  const importLine = `import{gate as __prcGate,handoff as __prcHandoff}from${JSON.stringify(extensionUrl)};`;
  const lines = hostText.split("\n");
  const shebang = lines[0]?.startsWith("#!") ? `${lines.shift()}\n` : "";
  const body = lines.join("\n").replace(ANCHOR, `${WRAPPER}${ANCHOR}`);
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
