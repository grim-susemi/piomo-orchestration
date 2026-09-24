// This file lives in the auto-discovered extensions directory. Export a no-op
// factory and register tests only when Node executes the harness directly.
module.exports = function omoModelTuningTestHarnessExtension() {};

if (require.main === module) {
  const nodeAssert = require("node:assert/strict");
  let assertionCount = 0;
  const assert = new Proxy(nodeAssert, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value === "function") {
        return function (...args) { assertionCount += 1; return value.apply(target, args); };
      }
      return value;
    },
  });
  const test = require("node:test");
  const { after } = require("node:test");
  const {
    applyTuning,
    buildTuning,
    matchesTunedModel,
    TUNING_END_MARKER,
    TUNING_START_MARKER,
  } = require("./omo-model-tuning.ts");

  const basePrompt = "shared base prompt";
  const count = (value, token) => value.split(token).length - 1;

  const gptIds = ["gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol",
    "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-luna-fast", "gpt-6-astra",
    "openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra",
    "openai-codex/gpt-5.6-luna-fast", "openai-codex/gpt-6-astra"];

  const glmIds = ["ollama/glm-5.2", "ollama/glm-5.3", "ollama/glm-5.3-flash",
    "commandcode/z-ai/glm-5.3-flash", "routeway/glm-5.3-flash",
    "routeway/glm-5.3-flash-uncensored", "glm-5.2", "glm-5.3", "glm-5.3-flash"];

  const gpt6Ids = ["gpt-6-sol", "gpt-6-luna", "gpt-6-luna-fast",
    "openai-codex/gpt-6-sol", "openai-codex/gpt-6-luna", "openai-codex/gpt-6-luna-fast"];

  const zaiOrgGlmIds = ["commandcode/zai-org/glm-5.2", "commandcode/zai-org/glm-5.3",
    "commandcode/zai-org/glm-5.2-fast"];

  test("matches exact GPT ids bare, prefixed, and case-insensitively", () => {
    for (const id of gptIds) {
      assert.equal(matchesTunedModel({ id }), "gpt", id);
      assert.equal(matchesTunedModel({ id: id.toUpperCase() }), "gpt", id);
    }
    for (const model of [{ id: "gpt-6-astra-extra" }, { id: "other/gpt-6-astra" },
      { id: "openai-codex/gpt-5.4" }, { id: "gpt-99" }, { id: " gpt-6-astra" }, { name: "gpt-6-astra" }]) {
      assert.equal(matchesTunedModel(model), null);
    }
  });

  test("matches the closed exact GLM id set (6 prefixed + 3 bare), case-insensitively", () => {
    for (const id of glmIds) {
      assert.equal(matchesTunedModel({ id }), "glm", id);
      assert.equal(matchesTunedModel({ id: id.toUpperCase() }), "glm", id);
    }
  });

  test("never matches GLM ids by substring or wrong provider prefix", () => {
    for (const model of [{ id: "glm-5.3-studio" }, { id: "other/glm-5.3" },
      { id: "ollama/glm-5.3-pro" }, { id: "glm-99" }, { id: " glm-5.3" }, { name: "glm-5.3" }]) {
      assert.equal(matchesTunedModel(model), null);
    }
  });

  test("matches the added GPT-6 Sol allowlist ids (bare and openai-codex/prefixed)", () => {
    for (const id of ["gpt-6-sol", "openai-codex/gpt-6-sol"]) {
      assert.equal(matchesTunedModel({ id }), "gpt", id);
      assert.equal(matchesTunedModel({ id: id.toUpperCase() }), "gpt", id);
    }
    for (const model of [{ id: "gpt-6-sol-extra" }, { id: "other/gpt-6-sol" },
      { id: "gpt-6-sols" }, { id: "gpt-6-sol " }]) {
      assert.equal(matchesTunedModel(model), null);
    }
  });

  test("matches the added GPT-6 Luna allowlist ids (base and fast, bare and prefixed)", () => {
    for (const id of ["gpt-6-luna", "gpt-6-luna-fast", "openai-codex/gpt-6-luna",
      "openai-codex/gpt-6-luna-fast"]) {
      assert.equal(matchesTunedModel({ id }), "gpt", id);
      assert.equal(matchesTunedModel({ id: id.toUpperCase() }), "gpt", id);
    }
    for (const model of [{ id: "gpt-6-luna-pro" }, { id: "openai-codex/gpt-6-luna-fast-extra" },
      { id: "other/gpt-6-luna" }, { id: "gpt-6-luna-fast " }]) {
      assert.equal(matchesTunedModel(model), null);
    }
  });

  test("matches the added commandcode/zai-org GLM allowlist ids", () => {
    for (const id of zaiOrgGlmIds) {
      assert.equal(matchesTunedModel({ id }), "glm", id);
      assert.equal(matchesTunedModel({ id: id.toUpperCase() }), "glm", id);
    }
    for (const model of [{ id: "commandcode/zai-org/glm-5.4" }, { id: "commandcode/z-ai/glm-5.2" },
      { id: "other/zai-org/GLM-5.2" }, { id: "commandcode/zai-org/glm-5.2-fast-extra" }]) {
      assert.equal(matchesTunedModel(model), null);
    }
  });

  test("new allowlist hits are idempotent on preset-prefixed bases", () => {
    for (const id of [...gpt6Ids, ...zaiOrgGlmIds]) {
      const family = matchesTunedModel({ id });
      assert.ok(family, id);
      const presetBase = `preset: ${id}\n${basePrompt}`;
      const tuned = applyTuning(presetBase, family);
      assert.equal(applyTuning(tuned, family), tuned);
      assert.ok(tuned.startsWith(`preset: ${id}`));
      assert.equal(count(tuned, TUNING_START_MARKER), 1);
      assert.equal(count(tuned, TUNING_END_MARKER), 1);
    }
  });

  test("GPT has one revisioned family identity and idempotent tuning block", () => {
    const tuned = applyTuning(basePrompt, "gpt");
    assert.equal(count(tuned, TUNING_START_MARKER), 1);
    assert.equal(count(tuned, TUNING_END_MARKER), 1);
    assert.equal(count(tuned, "model-family: gpt; tuning-revision: 7"), 1);
    assert.equal(applyTuning(tuned, "gpt"), tuned);
    assert.equal(tuned, `${basePrompt}\n\n${buildTuning("gpt")}`);
  });

  test("GLM has one revisioned family identity and idempotent tuning block", () => {
    const tuned = applyTuning(basePrompt, "glm");
    assert.equal(count(tuned, TUNING_START_MARKER), 1);
    assert.equal(count(tuned, TUNING_END_MARKER), 1);
    assert.equal(count(tuned, "model-family: glm; tuning-revision: 2"), 1);
    assert.equal(applyTuning(tuned, "glm"), tuned);
    assert.equal(tuned, `${basePrompt}\n\n${buildTuning("glm")}`);
  });

  test("GPT ships the Muse orchestration directive with only the family label changed", () => {
    const directive = buildTuning("muse-spark").split("\n")
      .find((line) => line.includes("orchestration-rule: orchestrate-by-default."));
    assert.ok(directive);
    assert.ok(buildTuning("gpt").split("\n").includes(directive.replace("MUSE MAIN", "GPT MAIN")));
  });

  test("GLM ships the Muse orchestration directive with only the family label changed", () => {
    const directive = buildTuning("muse-spark").split("\n")
      .find((line) => line.includes("orchestration-rule: orchestrate-by-default."));
    assert.ok(directive);
    assert.ok(buildTuning("glm").split("\n").includes(directive.replace("MUSE MAIN", "GLM MAIN")));
  });

  test("GLM main adds the DeepSeek stop rules without replacing its existing GPT rules", () => {
    // Given: GPT's orchestration rules and DeepSeek's two extra worker-loop rules.
    const gptRules = buildTuning("gpt").split("\n").slice(2, -2);
    const deepseekRules = buildTuning("deepseek").split("\n").slice(2, -2);
    const glmRules = buildTuning("glm").split("\n").slice(2, -2);
    const additional = deepseekRules.filter(rule =>
      !gptRules.some(shared => rule === shared.replace("GPT MAIN", "DEEPSEEK MAIN")));
    // When: GLM's family block is built. Then: the shipped copies of both
    // sources are present, but the stock GLM prompt remains the prefix.
    assert.equal(additional.length, 2);
    assert.equal(glmRules.length, 4);
    for (const rule of additional) assert.ok(glmRules.includes(rule));
    for (const rule of gptRules) assert.ok(glmRules.includes(rule.replace("GPT MAIN", "GLM MAIN")));
    const stock = "Senpi stock GLM 5.3 prompt";
    assert.ok(applyTuning(stock, "glm").startsWith(`${stock}\n\n${TUNING_START_MARKER}`));
  });

  test("switching to and from GPT preserves each existing family's shipped block", () => {
    for (const family of ["muse-spark", "glm"]) {
      const original = applyTuning(basePrompt, family);
      const gpt = applyTuning(original, "gpt");
      assert.equal(count(gpt, "model-family:"), 1);
      assert.equal(count(gpt, "model-family: gpt; tuning-revision: 7"), 1);
      assert.equal(applyTuning(gpt, family), original);
    }
  });

  test("switching to and from GLM preserves each existing family's shipped block", () => {
    for (const family of ["muse-spark", "gpt"]) {
      const original = applyTuning(basePrompt, family);
      const glm = applyTuning(original, "glm");
      assert.equal(count(glm, "model-family:"), 1);
      assert.equal(count(glm, "model-family: glm; tuning-revision: 2"), 1);
      assert.equal(applyTuning(glm, family), original);
    }
  });

  test("GPT refreshes stale revisions without losing surrounding context", () => {
    const previous = [basePrompt, TUNING_START_MARKER, "model-family: gpt; tuning-revision: 0",
      TUNING_END_MARKER, "fixture-context: retained"].join("\n");
    const refreshed = applyTuning(previous, "gpt");
    assert.equal(count(refreshed, "tuning-revision: 0"), 0);
    assert.equal(count(refreshed, "model-family: gpt; tuning-revision: 7"), 1);
    assert.ok(refreshed.startsWith(`${basePrompt}\n\nfixture-context: retained`));
    assert.equal(applyTuning(refreshed, "gpt"), refreshed);
  });

  test("GLM refreshes stale revisions without losing surrounding context", () => {
    const previous = [basePrompt, TUNING_START_MARKER, "model-family: glm; tuning-revision: 0",
      TUNING_END_MARKER, "fixture-context: retained"].join("\n");
    const refreshed = applyTuning(previous, "glm");
    assert.equal(count(refreshed, "tuning-revision: 0"), 0);
    assert.equal(count(refreshed, "model-family: glm; tuning-revision: 2"), 1);
    assert.ok(refreshed.startsWith(`${basePrompt}\n\nfixture-context: retained`));
    assert.equal(applyTuning(refreshed, "glm"), refreshed);
  });

  test("tuning extension injects the selected family's shipped block", () => {
    const handlers = new Map();
    require("./omo-model-tuning.ts").default({ on: (event, handler) => handlers.set(event, handler) });
    for (const [id, family] of [["openai-codex/gpt-6-astra", "gpt"],
      ["meta/muse-spark-1.3", "gpt"], ["ollama/glm-5.3", "glm"]]) {
      const context = { model: { id } };
      const result = handlers.get("before_agent_start")({ systemPrompt: basePrompt }, context);
      assert.equal(result.systemPrompt, `${basePrompt}\n\n${buildTuning(family)}`);
      assert.equal(handlers.get("before_agent_start")(result, context), undefined);
    }
  });

  test("keeps Muse matching intact", () => {
    assert.equal(matchesTunedModel({ id: "meta/muse-spark-1.3" }), "gpt");
  });

  test("GPT-ified Muse ids resolve to GPT tuning", () => {
    assert.equal(matchesTunedModel({ id: "meta/muse-spark-1.2" }), "gpt");
  });

  test("matches bare and prefixed Muse Spark contributor ids as GPT", () => {
    for (const id of ["meta/muse-spark-1.2-contributor", "meta/muse-spark-1.3-contributor",
      "muse-spark-1.2-contributor", "muse-spark-1.3-contributor"]) {
      assert.equal(matchesTunedModel({ id }), "gpt", id);
    }
  });

  test("is idempotent for the same family", () => {
    const first = applyTuning(basePrompt, "glm");
    assert.equal(applyTuning(first, "glm"), first);
  });

  test("refreshes an existing Muse revision while preserving surrounding context", () => {
    const previous = [
      basePrompt,
      TUNING_START_MARKER,
      "model-family: muse-spark; tuning-revision: 7",
      TUNING_END_MARKER,
      "fixture-context: retained",
    ].join("\n");

    const refreshed = applyTuning(previous, "muse-spark");

    assert.equal(count(refreshed, TUNING_START_MARKER), 1);
    assert.equal(count(refreshed, "tuning-revision: 7"), 0);
    assert.equal(count(refreshed, "tuning-revision: 9"), 1);
    assert.ok(refreshed.startsWith(`${basePrompt}\n\nfixture-context: retained`));
    assert.equal(applyTuning(refreshed, "muse-spark"), refreshed);
  });

  test("replaces a previous family tuning block", () => {
    const muse = applyTuning(basePrompt, "muse-spark");
    const glm = applyTuning(muse, "glm");

    assert.equal(count(glm, TUNING_START_MARKER), 1);
    assert.equal(count(glm, TUNING_END_MARKER), 1);
    assert.equal(count(glm, "model-family: glm; tuning-revision: 2"), 1);
    assert.equal(count(glm, "model-family: muse-spark"), 0);
  });

  test("repairs an orphan start marker before adding the tuning block", () => {
    const orphanFragment = "incomplete tuning fragment";
    const withOrphan = `${basePrompt}\n\n${TUNING_START_MARKER}\n${orphanFragment}`;
    const repaired = applyTuning(withOrphan, "glm");

    assert.equal(count(repaired, TUNING_START_MARKER), 1);
    assert.equal(count(repaired, TUNING_END_MARKER), 1);
    assert.equal(count(repaired, "model-family: glm; tuning-revision: 2"), 1);
    assert.ok(repaired.indexOf(orphanFragment) < repaired.indexOf(TUNING_START_MARKER));
  });

  test("passes through the base prompt for a null family", () => {
    assert.equal(applyTuning(basePrompt, null), basePrompt);
  });

  test("returns null for malformed ids without throwing", () => {
    assert.equal(matchesTunedModel({ id: "" }), null);
    assert.equal(matchesTunedModel({ id: undefined }), null);
    assert.equal(matchesTunedModel({}), null);
    assert.equal(matchesTunedModel(undefined), null);
  });

  test("snapshots sequential family tuning before a wiki-style append", () => {
    const muse = applyTuning(basePrompt, "muse-spark");
    const gpt = applyTuning(muse, "gpt");
    const glm = applyTuning(gpt, "glm");
    const wikiAppend = "## Wiki Boot Rules (oh-my-llmwikimode)\nwiki-rule: deterministic-fixture";
    const composed = `${glm}\n\n${wikiAppend}`;

    assert.equal(composed, `${basePrompt}\n\n${buildTuning("glm")}\n\n${wikiAppend}`);
    assert.equal(count(muse, "model-family: muse-spark"), 1);
    assert.equal(count(gpt, "model-family: gpt"), 1);
    assert.equal(count(gpt, "model-family: muse-spark"), 0);
    assert.equal(count(composed, TUNING_START_MARKER), 1);
    assert.equal(count(composed, TUNING_END_MARKER), 1);
    assert.equal(count(composed, "model-family:"), 1);
    assert.equal(count(composed, "model-family: glm; tuning-revision: 2"), 1);
    assert.equal(count(composed, "model-family: gpt"), 0);
    assert.ok(composed.indexOf(TUNING_END_MARKER) < composed.indexOf(wikiAppend));
  });

  // --- DeepSeek V4.1 main-only role gate (Todo 2 RED tests) ---

  const deepseekIds = ["deepseek-v4.1-flash", "ollama/deepseek-v4.1-flash", "commandcode/deepseek-v4.1-flash",
    "routeway/deepseek-v4.1-flash", "explabs/deepseek-v4.1-flash"];
  const DEEPSEEK_TOKEN = "model-family: deepseek; tuning-revision: 2";

  function factoryWith(kind) {
    const handlers = new Map();
    require("./omo-model-tuning.ts").default({
      on: (event, handler) => handlers.set(event, handler),
      sessionKind: kind,
    });
    return handlers;
  }

  test("matches exact DeepSeek V4.1 ids as a closed set, case-insensitively", () => {
    for (const id of deepseekIds) {
      assert.equal(matchesTunedModel({ id }), "deepseek", id);
      assert.equal(matchesTunedModel({ id: id.toUpperCase() }), "deepseek", id);
    }
    for (const model of [{ id: "other/deepseek-v4.1-flash" },
      { id: "ollama/deepseek-v4.1-flash-pro" }, { id: "deepseek-v4.1" },
      { id: "deepseek-v4-flash" }, { id: "ollama/deepseek-v4-flash" },
      { id: "deepseek-v4.1-flash:free" }, { id: " ollama/deepseek-v4.1-flash" },
      { id: "ollama/deepseek-v4.1-flash " }, { name: "ollama/deepseek-v4.1-flash" }]) {
      assert.equal(matchesTunedModel(model), null, JSON.stringify(model));
    }
    // Other families stay exactly as shipped.
    assert.equal(matchesTunedModel({ id: "openai-codex/gpt-6-astra" }), "gpt");
    assert.equal(matchesTunedModel({ id: "ollama/glm-5.3" }), "glm");
    assert.equal(matchesTunedModel({ id: "meta/muse-spark-1.3" }), "gpt");
  });

  test("bare deepseek-v4.1-flash (the id observed by the installed CLI) follows the main-only gate", () => {
    const bare = "deepseek-v4.1-flash";
    assert.equal(matchesTunedModel({ id: bare }), "deepseek", bare);
    const event = { systemPrompt: basePrompt, systemPromptOptions: { cwd: "/tmp" } };
    const main = factoryWith("interactive").get("before_agent_start")(event, { model: { id: bare } });
    assert.ok(main, "interactive main must receive the deepseek block for the bare id");
    assert.equal(count(main.systemPrompt, TUNING_START_MARKER), 1);
    assert.equal(count(main.systemPrompt, DEEPSEEK_TOKEN), 1);
    for (const kind of ["worker", undefined]) {
      const handler = factoryWith(kind).get("before_agent_start");
      const result = handler(event, { model: { id: bare } });
      const text = result?.systemPrompt ?? event.systemPrompt;
      assert.equal(count(text, DEEPSEEK_TOKEN), 0, `kind=${kind}`);
      assert.equal(count(text, TUNING_START_MARKER), 0, `kind=${kind}`);
    }
    const bypass = factoryWith("interactive").get("before_agent_start")({
      systemPrompt: basePrompt, systemPromptOptions: { customPrompt: "user override", cwd: "/tmp" },
    }, { model: { id: bare } });
    assert.equal(bypass, undefined, "customPrompt must bypass the bare-id deepseek block");
    // Arbitrary suffixes and name-only inference stay unmatched.
    for (const model of [{ id: "deepseek-v4.1-flash-pro" }, { id: "deepseek-v4.1-flashx" },
      { id: "deepseek-v4.1-flas" }, { id: "deepseek-v4.1-flash " }, { name: bare }]) {
      assert.equal(matchesTunedModel(model), null, JSON.stringify(model));
    }
  });

  test("deepseek tuning block is owned, distinct, and idempotent", () => {
    const tuned = applyTuning(basePrompt, "deepseek");
    assert.equal(count(tuned, TUNING_START_MARKER), 1);
    assert.equal(count(tuned, TUNING_END_MARKER), 1);
    assert.equal(count(tuned, DEEPSEEK_TOKEN), 1);
    assert.ok(tuned.startsWith(basePrompt));
    assert.equal(applyTuning(tuned, "deepseek"), tuned);
    // The deepseek block must not leak other families' revision tokens.
    assert.equal(count(tuned, "model-family: gpt; tuning-revision: 7"), 0);
    assert.equal(count(tuned, "model-family: glm; tuning-revision: 2"), 0);
    assert.equal(count(tuned, "model-family: muse-spark; tuning-revision: 9"), 0);
  });

  test("deepseek main includes the two shipped GPT orchestration rules alongside its own rules", () => {
    // Given: both families share the same owned-block renderer.
    const gptRules = buildTuning("gpt").split("\n").slice(2, -2);
    const deepseekRules = buildTuning("deepseek").split("\n").slice(2, -2);
    // When: the DeepSeek block is assembled from the current GPT rule source.
    // Then: the GPT rules travel with their DeepSeek label; the two DeepSeek
    // rules remain additional, rather than replacing the stock base prompt.
    assert.equal(gptRules.length, 2);
    assert.equal(deepseekRules.length, 4);
    for (const rule of gptRules) {
      assert.ok(deepseekRules.includes(rule.replaceAll("GPT MAIN", "DEEPSEEK MAIN")));
    }
    const preset = "Senpi stock DeepSeek V4.1 prompt";
    const composed = applyTuning(preset, "deepseek");
    assert.ok(composed.startsWith(`${preset}\n\n${TUNING_START_MARKER}`));
    assert.equal(count(composed, TUNING_START_MARKER), 1);
  });

  test("same DeepSeek id yields a main-only block: interactive gets it, worker and unknown kinds do not", () => {
    const event = { systemPrompt: basePrompt, systemPromptOptions: { cwd: "/tmp" } };
    const interactive = factoryWith("interactive");
    const interactiveHandler = interactive.get("before_agent_start");
    const interactiveResult = interactiveHandler(event, { model: { id: "ollama/deepseek-v4.1-flash" } });
    assert.ok(interactiveResult, "interactive session must receive the deepseek block");
    assert.equal(count(interactiveResult.systemPrompt, TUNING_START_MARKER), 1);
    assert.equal(count(interactiveResult.systemPrompt, DEEPSEEK_TOKEN), 1);
    // Same provider/model id on the interactive session keeps other-family blocks working.
    const glmResult = interactiveHandler(event, { model: { id: "ollama/glm-5.3" } });
    assert.equal(count(glmResult.systemPrompt, "model-family: glm; tuning-revision: 2"), 1);

    for (const kind of ["worker", undefined]) {
      const handlers = factoryWith(kind);
      const result = handlers.get("before_agent_start")(event, { model: { id: "ollama/deepseek-v4.1-flash" } });
      const text = result?.systemPrompt ?? event.systemPrompt;
      assert.equal(count(text, DEEPSEEK_TOKEN), 0, `kind=${kind}`);
      assert.equal(count(text, TUNING_START_MARKER), 0, `kind=${kind}`);
    }
  });

  test("skips DeepSeek tuning when systemPromptOptions.customPrompt is set", () => {
    const handlers = factoryWith("interactive");
    const handler = handlers.get("before_agent_start");
    const ctx = { model: { id: "ollama/deepseek-v4.1-flash" } };
    const withCustom = handler({
      systemPrompt: basePrompt,
      systemPromptOptions: { customPrompt: "custom prompt body", cwd: "/tmp" },
    }, ctx);
    const customText = withCustom?.systemPrompt ?? basePrompt;
    assert.equal(count(customText, DEEPSEEK_TOKEN), 0);
    assert.equal(count(customText, TUNING_START_MARKER), 0);
    // Without customPrompt the block is applied.
    const withoutCustom = handler({ systemPrompt: basePrompt, systemPromptOptions: { cwd: "/tmp" } }, ctx);
    assert.ok(withoutCustom, "deepseek block must be applied without customPrompt");
    assert.equal(count(withoutCustom.systemPrompt, DEEPSEEK_TOKEN), 1);
    assert.equal(count(withoutCustom.systemPrompt, TUNING_START_MARKER), 1);
  });

  test("deepseek block replaces another family's block keeping exactly one owned marker pair", () => {
    const gpt = applyTuning(basePrompt, "gpt");
    const deepseek = applyTuning(gpt, "deepseek");
    assert.equal(count(deepseek, TUNING_START_MARKER), 1);
    assert.equal(count(deepseek, TUNING_END_MARKER), 1);
    assert.equal(count(deepseek, DEEPSEEK_TOKEN), 1);
    assert.equal(count(deepseek, "model-family: gpt"), 0);
    assert.ok(deepseek.startsWith(basePrompt));
    assert.equal(applyTuning(deepseek, "deepseek"), deepseek);
  });

  test("model_select stays banner-only: sets the DeepSeek banner and never returns a prompt", () => {
    const handlers = factoryWith("interactive");
    let headerFactory;
    const ui = { setHeader: (header) => { headerFactory = header; } };
    const ctx = { model: { id: "ollama/deepseek-v4.1-flash" }, ui };
    const returned = handlers.get("model_select")({ type: "model_select" }, ctx);
    assert.equal(returned, undefined);
    assert.ok(headerFactory, "deepseek model_select must set its banner header");
    const rendered = headerFactory(undefined, {
      fg: (_color, text) => text,
      bold: (text) => text,
    }).render();
    assert.ok(rendered.join("\n").includes("deepseek"));
    // Untargeted models keep the builtin banner slot untouched.
    let untouched = true;
    handlers.get("model_select")({ type: "model_select" },
      { model: { id: "some-other-model" }, ui: { setHeader: () => { untouched = false; } } });
    assert.ok(untouched);
  });

  after(() => {
    console.log(`TUNING SUITE: ${assertionCount} assertions executed`);
  });
}
