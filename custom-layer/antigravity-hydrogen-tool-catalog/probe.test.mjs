import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.OPENCODEX_ROOT;
if (!root) throw new TypeError("OPENCODEX_ROOT must name the OpenCodex package to probe.");
const { createGoogleAdapter } = await import(pathToFileURL(join(root, "src/adapters/google.ts")).href);
const { createTranslatorBudget } = await import(pathToFileURL(join(root, "src/lib/translator-budget.ts")).href);
const { z } = await import(pathToFileURL(join(root, "node_modules/zod/index.js")).href);

const wireSchema = z.object({
  request: z.object({
    systemInstruction: z.unknown(),
    tools: z.array(z.unknown()).optional(),
    contents: z.array(z.unknown()),
  }),
});

async function wire(model, tools) {
  const adapter = createGoogleAdapter({
    adapter: "google", baseUrl: "https://daily-cloudcode-pa.googleapis.com",
    authMode: "oauth", googleMode: "cloud-code-assist",
    apiKey: "fixture-not-a-credential", project: "fixture-project", models: [],
  });
  const parsed = {
    modelId: model, stream: false, options: { reasoning: "low" },
    context: {
      systemPrompt: ["DIAGNOSTIC_USER_SYSTEM_SENTINEL"],
      messages: [{ role: "user", content: "DIAGNOSTIC_USER_MESSAGE_SENTINEL", timestamp: 0 }],
      ...(tools ? { tools: [{ name: "read_marker", description: "Read a diagnostic marker.",
        parameters: { type: "object", properties: {} } }] } : {}),
    },
  };
  const request = await adapter.buildRequest(parsed, {
    headers: new Headers(), translatorBudget: createTranslatorBudget(),
  });
  return wireSchema.parse(JSON.parse(request.body)).request;
}

test("Hydrogen preserves user system and declared tool while excluding optional proxy catalog injection", async () => {
  const bare = await wire("gemini-4-hydrogen-low", false);
  const tool = await wire("gemini-4-hydrogen-low", true);
  assert.deepEqual(tool.systemInstruction, bare.systemInstruction);
  assert.deepEqual(tool.contents, bare.contents);
  assert.equal(tool.tools?.length, 1);
});

test("Other Antigravity model retains existing catalog injection behavior", async () => {
  const bare = await wire("gemini-4-argon-low", false);
  const tool = await wire("gemini-4-argon-low", true);
  assert.notDeepEqual(tool.systemInstruction, bare.systemInstruction);
  assert.deepEqual(tool.contents, bare.contents);
  assert.equal(tool.tools?.length, 1);
});
