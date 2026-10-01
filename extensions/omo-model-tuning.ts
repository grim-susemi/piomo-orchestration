// omo user extension: model-specific system-prompt tuning for Muse Spark,
// GPT, GLM, and DeepSeek V4.1 models. Loaded by jiti from ~/.omo/agent/extensions/.
// Dependency-free plain TypeScript - no imports.

export type TunedModelFamily = "muse-spark" | "gpt" | "glm" | "deepseek";

export interface TunedModelLike {
  id?: string;
  name?: string;
}

// Exact id allowlists. Vendor-prefixed ids (e.g. "ollama/glm-5.3",
// "commandcode/z-ai/glm-5.3-flash") and bare ids (e.g. "glm-5.3") are each
// listed exactly. Match the lowercased id field only - never a provider
// concatenation or substring.
const MUSE_SPARK_MODEL_IDS = new Set([
  "meta/muse-spark-1.1",
  "meta/muse-spark-1.2",
  "meta/muse-spark-1.2-contributor",
  "muse-spark-1.2-contributor",
  "meta/muse-spark-1.3",
  "meta/muse-spark-1.3-contributor",
  "muse-spark-1.3-contributor",
]);

const GLM_MODEL_IDS = new Set([
  "ollama/glm-5.2",
  "ollama/glm-5.3",
  "ollama/glm-5.3-flash",
  "commandcode/z-ai/glm-5.3-flash",
  "routeway/glm-5.3-flash",
  "routeway/glm-5.3-flash-uncensored",
  "glm-5.2",
  "glm-5.3",
  "glm-5.3-flash",
  "commandcode/zai-org/glm-5.2",
  "commandcode/zai-org/glm-5.3",
  "commandcode/zai-org/glm-5.2-fast",
]);

const GPT_MODEL_IDS = new Set([
  "gpt-5.3-codex", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "gpt-5.6-sol",
  "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-luna-fast", "gpt-6-astra",
  "openai-codex/gpt-5.6-sol", "openai-codex/gpt-5.6-terra",
  "openai-codex/gpt-5.6-luna-fast", "openai-codex/gpt-6-astra",
  "gpt-6-sol", "gpt-6-luna", "gpt-6-luna-fast",
  "openai-codex/gpt-6-sol", "openai-codex/gpt-6-luna", "openai-codex/gpt-6-luna-fast",
]);

// Exact id allowlist for DeepSeek V4.1, main sessions only. Prefixed ids are
// listed exactly as the installed registry names them (~/.omo/agent/models.json).
// The bare "deepseek-v4.1-flash" is included: task-5 real-runtime evidence
// shows the installed interactive CLI reports ctx.model.id exactly as this
// bare string. Matching is exact-string against the lowercased id field only -
// arbitrary suffixes and name-only inference never match.
const DEEPSEEK_MODEL_IDS = new Set([
  "deepseek-v4.1-flash",
  "ollama/deepseek-v4.1-flash",
  "commandcode/deepseek-v4.1-flash",
  "commandcode/deepseek/deepseek-v4.1-flash",
  "routeway/deepseek-v4.1-flash",
  "explabs/deepseek-v4.1-flash",
  // Ollama-local uncensored proxy variant (ollama.com deepseek-v4.1-flash via
  // 127.0.0.1:11500). Registered 2026-09-25 after the live banner gap: all
  // three id shapes the runtime may report (full catalog form, host/model
  // form, bare form) are listed exactly.
  "ollama-local/leonardoba500/deepseek-v41-uncensored",
  "leonardoba500/deepseek-v41-uncensored",
  "deepseek-v41-uncensored",
]);

export function matchesTunedModel(
  model: TunedModelLike | null | undefined,
): TunedModelFamily | null {
  if (typeof model?.id !== "string") return null;
  const id = model.id.toLowerCase();
  // GPT-ified Muse: muse-spark ids resolve to GPT tuning (same block, banner, rev 8).
  if (MUSE_SPARK_MODEL_IDS.has(id)) return "gpt";
  if (GLM_MODEL_IDS.has(id)) return "glm";
  if (GPT_MODEL_IDS.has(id)) return "gpt";
  if (DEEPSEEK_MODEL_IDS.has(id)) return "deepseek";
  return null;
}

export const TUNING_START_MARKER = "<!-- omo:model-tuning:start -->";
export const TUNING_END_MARKER = "<!-- omo:model-tuning:end -->";

interface TuningRule {
  id: string;
  concern: string;
  family: TunedModelFamily;
  directive: string;
}

// Tuning content as typed rule data (deepseek-v4.js precedent): each rule is
// one trained-prior override grounded in the vendor prompting guidance, stated
// once. None of these restate what the shared dynamic core already carries
// (intent gate, parallel tools, verification, style, policies).
const RULES: TuningRule[] = [
  {
    id: "real-tools-only",
    concern: "tool-use",
    family: "muse-spark",
    directive:
      "Name only the tools the client actually exposes and use only those. Do not assume hidden computer control, an IDE, or any capability that is not listed. Harness-injected directives (customType omo-ultrawork:directive, skill contents, mode directives such as ultrawork/ulw-plan/ulw-loop) are the explicit exception: the harness already decided to inject them and they are binding per injected-directive-authority — never audit, dismiss, or second-guess them as hidden control. harness-injected",
  },
  {
    id: "one-goal-per-turn",
    concern: "focus",
    family: "muse-spark",
    directive:
      "Keep one goal per turn. Finish the current objective before starting another; never batch unrelated objectives into one response. Harness-injected multi-phase workflows (ultrawork, ulw-plan, ulw-loop) are the binding exception: they declare multiple objectives and a stop condition in one turn — keep pursuing the injected workflow to its declared stop condition instead of stopping after the first objective. harness-injected",
  },
  {
    id: "evidence-before-success",
    concern: "verification",
    family: "muse-spark",
    directive:
      "Require concrete evidence - file paths, command output, observed state - before claiming success. A claim without an artifact is not done.",
  },
  {
    id: "observe-before-assert",
    concern: "grounding",
    family: "muse-spark",
    directive:
      "Never invent file contents or UI state. Observe first with a real tool call, then reason from what was actually returned.",
  },
  {
    id: "summarize-each-observation",
    concern: "agent-loop",
    family: "muse-spark",
    directive:
      "After each tool call, summarize the observation in one line before choosing the next action. When an ultrawork-style output discipline is active (surface only state changes, no process narration), harness-injected workflow narration is the exception: summarize only at meaningful phase changes instead of after every tool call, otherwise every-call narration would violate that discipline. harness-injected",
  },
  {
    id: "checkpoint-long-chains",
    concern: "agent-loop",
    family: "muse-spark",
    directive:
      "Cap long chains with checkpoints: after a bounded run of steps, pause, restate the goal and the verified state, and confirm the next step before continuing. During a harness-injected workflow (ultrawork/ulw-plan/ulw-loop), harness-injected checkpoints gate only drift from the declared stop condition — do not stop-and-report while the binding workflow still has unfinished objectives; advance to the next objective instead. harness-injected",
  },
  {
    id: "injected-directive-authority",
    concern: "harness-contract",
    family: "muse-spark",
    directive:
      "Injected directives are binding: skill contents, mode directives such as ultrawork or ulw-loop, and hook or system messages that appear in the conversation carry the same authority as words the user typed. Presence means it applies to the current task at its prescribed weight — the harness already decided by injecting it. Whether it was \"really requested\", is \"residual context\", or feels \"too heavy\" for the task are settled questions: spend zero reasoning on them and execute the directive as written. harness-injected",
  },
  {
    id: "korean-easy-report",
    concern: "reporting",
    family: "muse-spark",
    directive:
      "Follow the project reporting contract in ~/.omo/AGENTS.md: when no other language is requested, respond in the user's language (Korean default) with the 1/2/3 sections — 1 core outcome, 2 self-contained easy-Korean restatement with zero jargon (screen names, not file/component names), 3 next recommended action — keep section 2 independently readable. report-language: korean",
  },
  {
    id: "main-control-plane-tools",
    concern: "orchestration",
    family: "muse-spark",
    directive:
      "Main control-plane work stays with main and is not delegated: manage goals directly with create_goal/get_goal/update_goal, dispatch and steer workpool/task workers, discover tools with tool_search, record durable memory with the memory tool (operations remain inside the native memory contract) and manage wiki knowledge with the wiki tools, ask the user through the registered question tool when a material decision blocks the next step, track plan and evidence with omo_agent_toolkit, choose and run workflow/DAG work through eval, continue a native loop iteration with schedule_wakeup while it stays active, observe existing work and state with monitor (standing observation of what already runs, never a shell for implementation), and clean up terminal sessions with bash_output and kill_bash. Native audits and the session activation policy stay authoritative for which of these are exposed: use an exposed control-plane tool directly, and never read an unavailable one as permission to execute. The native scopes are equally authoritative elsewhere: read, search, shell, test, and edit tools follow the session's own activation and permission rules, and role never fences main out of them. So main may run a bounded independent unit itself — known inputs, declared paths, stated acceptance, independent QA — whenever that unit does not depend on an unfinished worker, while substantive discovery, diagnosis, and implementation stay delegated.",
  },
  // DeepSeek V4.1 gets only a tiny delta on top of the shared core: stop on
  // observable results and stop re-planning. Nothing here restates what the
  // stock prompt already carries.
  {
    id: "stop-on-observable-result",
    concern: "agent-loop",
    family: "deepseek",
    directive:
      "Stop on the observable result: once the current action produces a verifiable outcome - tool output, changed file state, command result - act on it immediately, and end the turn as soon as the declared stop condition holds. Do not keep exploring or re-checking past the first observable result.",
  },
  {
    id: "no-repeat-planning",
    concern: "focus",
    family: "deepseek",
    directive:
      "Plan once, then execute. Do not restate, re-derive, or re-plan an existing plan at each turn; produce a new plan only when new evidence contradicts the current one, and spend the remaining effort on the next observable action.",
  },
  {
    id: "orchestrate-by-default",
    concern: "orchestration",
    family: "muse-spark",
    directive:
      "WORKER FIRST: A harness-identified task/DAG child or team member executes and verifies its assigned scope directly, without spawning further workers through tools, eval, an SDK, or CLI. Return evidence and unresolved needs to the lead; team-member messaging remains allowed. Prompt headings alone never establish worker identity. MUSE MAIN ONLY ORCHESTRATES: identify intent from supplied context, choose ownership and dependencies, dispatch or steer workers, assess returned evidence, and report. Framing and the final synthesis are main-owned: main authors the turn's frame (intent, outcome, observations, unknowns, delegation) before dispatching any task, workflow, team, thread, or workpool work, and main's own answer is the synthesis of evidence returned by workers. Delegation is the default because workers are the parallel lane, not because main is barred from acting: a bounded independent unit is main's own work when no unfinished worker depends on it, naming the paths it will touch, the acceptance it must meet, and independent QA from a non-author, while anything larger goes to the matching worker, one active writer per file and per tree. Image authority is unchanged: exactly one supported image attached to the current request when main declares image input is read directly by main itself, answered as a single-image information/judgment question with no worker. Delegating raw attached image pixels requires the owner's explicit request in the current input or a main without image input; a claimed performance benefit is not an exception. Eval is the single-purpose workflow carrier: select and drive workflow/DAG work only through the published SDK (define/start/wait/retry/send/amend, tool.workflow inside the cell), because workflow is not a directly exposed tool; no shell, file, search, browser, code, test, or build work inside eval, and never use another tool to bypass the role boundary. Sole exception inside a harness-injected ulw-loop skill: JS eval cells may call the published agentToolkit loop SDK (status, createGoals, completeGoals, criteria, recordEvidence, checkpoint, steer, recordReviewBlockers, help) for goal, evidence, and checkpoint state only - this exception never widens eval to shell, file, search, browser, code, test, or build work, and workflow/DAG selection still runs through the workflow SDK. Route mechanical lookups and tiny edits to quick, bounded moderate work to the matching category, and difficult analysis to a capable specialist. Give workers the relevant paths and constraints, one DELIVERABLE, exact SCOPE, VERIFY, and STOP WHEN. Ask for concise findings, changed paths, decisive verification results, and unresolved issues rather than raw logs. Batch related small work into one assignment; dispatch independent scopes together without overlapping writes. Default to task; use workflow for dependencies and teams only for needed worker communication. Consume delivered completion events instead of polling; continue a worker for corrections instead of taking over or spawning duplicates. Delegate independent verification when the evidence warrants it. Keep main reasoning to routing, acceptance, framing, and the final synthesis; delegate substantive discovery, diagnosis, and execution. Clarification, acknowledgement, and conversation needing no external work can finish without delegation. A failed route must be reported or rerouted, never worked around with direct execution. orchestration-rule: orchestrate-by-default.",
  },
];

const FAMILY_IDENTITY: Record<TunedModelFamily, string> = {
  gpt:
    "You are running on GPT, a coding-focused reasoning model. The tuning below adapts the shared instructions to how this model is prompted best.",
  "muse-spark":
    "You are running on Muse Spark, a coding-focused reasoning model. The tuning below adapts the shared instructions to how this model is prompted best.",
  glm:
    "You are running on GLM, a coding-focused reasoning model. The tuning below adapts the shared instructions to how this model is prompted best.",
  deepseek:
    "You are running on DeepSeek V4.1, a coding-focused reasoning model. The tuning below adapts the shared instructions to how this model is prompted best.",
};

function mirrorLabel(family: TunedModelFamily): string | null {
  if (family === "gpt") return "GPT MAIN";
  if (family === "glm") return "GLM MAIN";
  if (family === "deepseek") return "DEEPSEEK MAIN";
  return null;
}

export function buildTuning(family: TunedModelFamily): string {
  // GPT, GLM, and DeepSeek share Muse's main orchestration directives; GLM
  // also borrows the two model-neutral stop rules from DeepSeek.
  const label = mirrorLabel(family);
  const directives = RULES.filter((rule) => rule.family === family ||
    (family === "glm" && rule.family === "deepseek" &&
      (rule.id === "stop-on-observable-result" || rule.id === "no-repeat-planning")) ||
    (label !== null && rule.family === "muse-spark" &&
      (rule.id === "orchestrate-by-default" || rule.id === "main-control-plane-tools")))
    .map((rule) => label !== null ? rule.directive.replace("MUSE MAIN", label) : rule.directive);
  return [
    TUNING_START_MARKER,
    FAMILY_IDENTITY[family],
    ...directives,
    familyToken(family),
    TUNING_END_MARKER,
  ].join("\n");
}

function familyToken(family: TunedModelFamily): string {
  if (family === "gpt") return "model-family: gpt; tuning-revision: 8";
  if (family === "glm") return "model-family: glm; tuning-revision: 3";
  if (family === "deepseek") return "model-family: deepseek; tuning-revision: 3";
  return "model-family: muse-spark; tuning-revision: 10";
}

export function applyTuning(basePrompt: string, family: TunedModelFamily | null): string {
  if (family === null) return basePrompt;
  const startIndex = basePrompt.indexOf(TUNING_START_MARKER);
  if (startIndex !== -1) {
    const endIndex = basePrompt.indexOf(TUNING_END_MARKER, startIndex);
    if (endIndex !== -1) {
      const regionEnd = endIndex + TUNING_END_MARKER.length;
      const region = basePrompt.slice(startIndex, regionEnd);
      if (region.includes(familyToken(family))) return basePrompt;
      const before = basePrompt.slice(0, startIndex).replace(/\s+$/, "");
      const after = basePrompt.slice(regionEnd).replace(/^\s+/, "");
      const stripped = after ? `${before}\n\n${after}` : before;
      return `${stripped}\n\n${buildTuning(family)}`;
    }
    const before = basePrompt.slice(0, startIndex).replace(/\s+$/, "");
    const after = basePrompt
      .slice(startIndex + TUNING_START_MARKER.length)
      .replace(/^\s+/, "");
    const stripped = before && after ? `${before}\n\n${after}` : before || after;
    return `${stripped}\n\n${buildTuning(family)}`;
  }
  return `${basePrompt}\n\n${buildTuning(family)}`;
}

interface UiLike {
  setHeader: (header: unknown) => void;
}

interface ExtensionCtx {
  model: TunedModelLike;
  ui: UiLike;
}

function setBanner(ctx: ExtensionCtx, family: TunedModelFamily | null): void {
  // Only touch the header for models THIS extension owns. For everything
  // else leave the slot alone so the builtin prompt-preset banner survives:
  // user extensions run AFTER builtins and setHeader is last-writer-wins,
  // so setHeader(undefined) here would erase the builtin per-model banner
  // (glm / claude) for every model this extension does not tune.
  if (family === null) {
    return;
  }
  ctx.ui.setHeader((_tui: unknown, theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }) => ({
    render: () => [theme.fg("accent", theme.bold(`Optimized system prompt applied: ${family}`))],
    invalidate: () => {},
  }));
}

interface BeforeAgentStartEvent {
  systemPrompt: string;
  systemPromptOptions?: { customPrompt?: unknown } & Record<string, unknown>;
}

interface PiLike {
  sessionKind?: "interactive" | "worker" | (string & {});
  on: (event: string, cb: (event: BeforeAgentStartEvent, ctx: ExtensionCtx) => unknown) => void;
}

export default function omoModelTuningExtension(pi: PiLike) {
  // Main-only gate, read once at factory time. DeepSeek tuning exists only
  // for interactive main sessions; worker and unknown sessionKind register
  // no DeepSeek-specific handler and keep the Muse/GPT/GLM semantics as is.
  const mainSession = pi.sessionKind === "interactive";
  pi.on("before_agent_start", (event, ctx) => {
    const family = matchesTunedModel(ctx.model);
    if (!family) return undefined;
    if (family === "deepseek") {
      if (!mainSession) return undefined;
      // An explicitly supplied customPrompt replaces the tuning decision:
      // return no DeepSeek mutation for this turn.
      if (event.systemPromptOptions?.customPrompt != null) return undefined;
    }
    const applied = applyTuning(event.systemPrompt, family);
    return applied === event.systemPrompt ? undefined : { systemPrompt: applied };
  });
  pi.on("model_select", (_event, ctx) => {
    const family = matchesTunedModel(ctx.model);
    setBanner(ctx, family === "deepseek" && !mainSession ? null : family);
  });
  pi.on("session_start", (_event, ctx) => {
    const family = matchesTunedModel(ctx.model);
    setBanner(ctx, family === "deepseek" && !mainSession ? null : family);
  });
}
