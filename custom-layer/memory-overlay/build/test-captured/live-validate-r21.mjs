import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const project = "C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.38";
const wrapper = "C:/Users/USER/.omo-stable-500/omo.cmd";
const entry = "C:/Users/USER/.omo-stable-500/staging/omo-memory-selector-entry-r21.mjs";
const probe = `${project}/test/launch-probe.mjs`;
const env = { ...process.env };
for (const name of [
  "PI_SESSION_ID", "PI_SESSION_FILE", "PI_SESSION_CWD", "MEMORY_DIR", "AGENT_ID",
  "OMO_MEMORY_AGENT_ID", "HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH", "HERDR_WORKSPACE_ID"
]) delete env[name];

async function runProbe(kind, receipt) {
  const cmdArgs = kind === "cmd"
    ? ["/d", "/s", "/c", `""${wrapper}" --mode rpc --no-session --extension "${probe}""`]
    : [entry, "--mode", "rpc", "--no-session", "--extension", probe];
  const child = execFile(kind === "cmd" ? "cmd.exe" : process.execPath, cmdArgs, {
    env: { ...env, MEMORY_ROLLBACK_LAUNCH_RECEIPT: receipt },
    cwd: project, windowsHide: true, windowsVerbatimArguments: kind === "cmd",
    timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  let out = "";
  let ended = false;
  const on = (chunk) => {
    out += chunk.toString();
    if (!ended && out.includes("MEMORY_OVERLAY_LAUNCH_PASS")) {
      ended = true;
      try { child.stdin.end('{"type":"get_state"}\n'); } catch {}
    }
  };
  child.stdout.on("data", on);
  child.stderr.on("data", on);
  const code = await new Promise((resolve) => child.on("close", (c) => resolve(c)));
  assert.equal(code, 0, out.slice(-1500));
  const loaded = JSON.parse(await readFile(receipt, "utf8"));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.memoryToolCount, 1);
  assert.equal(loaded.agentDir.toLowerCase(), "c:\\users\\user\\.omo-stable-500\\home\\.omo\\agent");
  return { kind, receipt, pid: loaded.pid, owner: loaded.owners[0], loadedExtensions: loaded.loadedExtensions.length };
}

const results = [];
results.push(await runProbe("cmd", `${project}/evidence/live-launch-cmd-r21.json`));
results.push(await runProbe("reentry", `${project}/evidence/live-launch-reentry-r21.json`));
console.log("LIVE_VALIDATE_R21_PASS " + JSON.stringify(results));
