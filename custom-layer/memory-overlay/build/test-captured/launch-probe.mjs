import { writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

export default function launchProbe(pi) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      const output = process.env.MEMORY_ROLLBACK_LAUNCH_RECEIPT;
      const root = "C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.38/evidence";
      assert.equal(path.dirname(path.resolve(output)).toLowerCase(), path.resolve(root).toLowerCase());
      const expected = "C:/Users/USER/.omo-stable-500/staging/memory-rollback-5.1.38-r1/package/plugin/extensions/omo.js";
      const paths = [...ctx.loadedExtensionPaths];
      const owners = paths.filter((p) => /[/\\]extensions[/\\]omo\.js$/.test(p));
      assert.equal(owners.length, 1);
      assert.equal(path.resolve(owners[0]).toLowerCase(), path.resolve(expected).toLowerCase());
      assert.equal(pi.getAllTools().filter((t) => t.name === "memory").length, 1);
      await writeFile(output, JSON.stringify({
        ok: true, pid: process.pid, executable: process.execPath, argv: process.argv,
        cwd: ctx.cwd, agentDir: ctx.agentDir, owners, loadedExtensions: paths,
        memoryToolCount: 1, modelRequested: false
      }, null, 2) + "\n", { flag: "wx" });
      console.log("MEMORY_OVERLAY_LAUNCH_PASS " + JSON.stringify({ pid: process.pid, owner: owners[0] }));
    } finally {
      ctx.shutdown();
    }
  });
}
