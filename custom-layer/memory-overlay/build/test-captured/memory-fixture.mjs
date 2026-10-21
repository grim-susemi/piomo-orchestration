import { mkdtemp, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

export async function memoryFixture(plugin) {
  const work = "C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.40/.work";
  await mkdir(work, { recursive: true });
  const sandbox = await mkdtemp(`${work}/native-`);
  const home = `${sandbox}/home`;
  const agentDir = `${home}/.omo/agent`;
  const cwd = `${sandbox}/workspace`;
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  for (const name of [
    "PI_SESSION_FILE", "PI_SESSION_ID", "PI_SESSION_CWD", "MEMORY_DIR", "AGENT_ID",
    "OMO_MEMORY_AGENT_ID", "OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR",
    "HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH", "HERDR_WORKSPACE_ID"
  ]) delete process.env[name];
  Object.assign(process.env, {
    HOME: home, USERPROFILE: home,
    OMO_CODING_AGENT_DIR: agentDir, SENPI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_DIR: agentDir,
    OMO_NATIVE: "1", SENPI_RUNTIME: "node"
  });
  // MEMORY_ROLLBACK_SENPI_ROOT selects an isolated engine tree (e.g. a staged candidate) instead of the installed one.
  const sdk = process.env.MEMORY_ROLLBACK_SENPI_ROOT ? new URL("dist/core/", "file:///" + process.env.MEMORY_ROLLBACK_SENPI_ROOT.replaceAll("\\", "/").replace(/\/?$/, "/")).href : "file:///C:/Users/USER/.bun/install/global/node_modules/@code-yeongyu/senpi/dist/core/";
  const { createAgentSession } = await import(`${sdk}sdk.js`);
  const { DefaultResourceLoader } = await import(`${sdk}resource-loader.js`);
  const { SettingsManager } = await import(`${sdk}settings-manager.js`);
  const { SessionManager } = await import(`${sdk}session-manager.js`);
  const { ModelRuntime } = await import(`${sdk}model-runtime.js`);
  const { AuthStorage } = await import(`${sdk}auth-storage.js`);
  const settings = SettingsManager.inMemory();
  const auth = AuthStorage.inMemory();
  const modelRuntime = await ModelRuntime.create({
    settingsManager: settings, credentials: auth, agentDir, allowModelNetwork: false, refreshOnCreate: false
  });
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager: settings, additionalExtensionPaths: [plugin],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, authStorage: auth, settingsManager: settings, resourceLoader: loader,
    sessionManager: SessionManager.create(cwd, `${agentDir}/sessions`), tools: ["memory"], autoTitleSessions: false
  });
  const close = async () => {
    await session.waitForIdle();
    await session.waitForSettledSessionWork();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  };
  try {
    await session.bindExtensions({ mode: "rpc" });
    assert.deepEqual(loader.getExtensions().errors, []);
    const binding = session.sessionManager.getEntries()
      .filter((e) => e.type === "custom" && e.customType === "senpi-memory.session-binding").at(-1)?.data;
    assert.ok(binding);
    const canonical = path.join(home, ".omo/memory/agents", binding.identity, "repo");
    assert.equal(createHash("sha256").update(canonical).digest("hex"), binding.repoPathHash);
    const write = (params) => session.executeTool("memory", params, { activateInactiveTool: true });
    const create = (file_path, file_text) => write({
      command: "create", file_path, file_text, reason: "Isolated native regression fixture",
      description: "Private regression fixture"
    });
    const seed = await create("reference/seed.md", "Baseline fixture content.\n");
    assert.ok(seed.details?.writeNotice?.sha, JSON.stringify(seed));
    // SDK-only sessions have not persisted a model message and intentionally use
    // transient-runs. Resolve the one physical repo, never assume the binding is it.
    const root = path.join(home, ".omo/memory");
    const repos = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name === ".git").map((e) => e.parentPath);
    assert.equal(repos.length, 1);
    const repo = await realpath(repos[0]);
    assert.ok(repo.toLowerCase().startsWith((await realpath(root)).toLowerCase() + path.sep));
    const owners = loader.getExtensions().extensions.filter((e) => e.tools.has("memory"));
    assert.equal(owners.length, 1);
    assert.ok((await realpath(owners[0].resolvedPath)).startsWith(await realpath(plugin)));
    return { sandbox, home, repo, binding, write, create, close,
      owner: owners[0].resolvedPath, executable: process.execPath, pid: process.pid };
  } catch (error) {
    await close();
    throw error;
  }
}
