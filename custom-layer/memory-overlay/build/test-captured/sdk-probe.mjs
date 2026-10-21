import { mkdtemp, mkdir, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const work = "C:/Users/USER/orca/projects/piomo-memory-rollback-5.1.38/.work";
await mkdir(work, { recursive: true });
const sandbox = await mkdtemp(`${work}/sdk-probe-`);
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
  cwd, agentDir, settingsManager: settings,
  additionalExtensionPaths: [process.argv[2] ?? "C:/Users/USER/.bun/install/global/node_modules/omo-ai/plugin"],
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true
});
await loader.reload();
let session;
try {
  ({ session } = await createAgentSession({
    cwd, agentDir, modelRuntime, authStorage: auth, settingsManager: settings, resourceLoader: loader,
    sessionManager: SessionManager.create(cwd, `${agentDir}/sessions`), tools: ["memory"], autoTitleSessions: false
  }));
  await session.bindExtensions({ mode: "rpc" });
  const definition = session.getToolDefinition("memory");
  const bindings = session.sessionManager.getEntries().filter((e) =>
    e.type === "custom" && e.customType === "senpi-memory.session-binding");
  const binding = bindings.at(-1)?.data;
  const repoPath = path.join(home, ".omo", "memory", "agents", binding?.identity ?? "", "repo");
  if (!binding || createHash("sha256").update(repoPath).digest("hex") !== binding.repoPathHash) {
    throw new Error("Memory binding does not point to the isolated profile");
  }
  const seedResult = await session.executeTool("memory", {
    command: "create", file_path: "reference/seed.md", reason: "Create isolated fixture seed",
    description: "Fixture seed", file_text: "Baseline fixture content.\n"
  }, { activateInactiveTool: true });
  console.log("SEED_RESULT " + JSON.stringify(seedResult));
  if (seedResult.isError) throw new Error("Native fixture seed write failed");
  const memoryRoot = path.join(home, ".omo/memory");
  const physicalRepos = (await readdir(memoryRoot, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isDirectory() && e.name === ".git")
    .map((e) => e.parentPath);
  if (physicalRepos.length !== 1 || !physicalRepos[0].startsWith(memoryRoot)) {
    throw new Error("Expected exactly one physical repository under the isolated memory root");
  }
  const physicalRepo = physicalRepos[0];
  await stat(path.join(physicalRepo, "reference/seed.md"));
  console.log("SDK_PROBE " + JSON.stringify({
    sandbox, tools: session.getAllTools().map((t) => t.name),
    memoryParameters: definition?.parameters, bindings: bindings.map((e) => e.data),
    diagnostics: loader.getExtensions().errors, repoPath, physicalRepo, seedResult
  }));
  if (!definition) throw new Error("Actual memory tool was not registered");
} finally {
  if (session) {
    await session.waitForIdle();
    await session.waitForSettledSessionWork();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
}
