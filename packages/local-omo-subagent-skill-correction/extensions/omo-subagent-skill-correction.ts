// omo user extension (repo copy): subagent-delegation + skill-utilization
// correction for the DeepSeek V4 presets (flash / flash-0731 / pro) and
// Kimi K3. Spec: .omo/plans/omo-model-presets-deepseek-k3.md Appendix A.
// All prompt logic lives in ./omo-subagent-skill-correction.mjs; this file
// only wires hooks. Dependency-free beyond that sibling module.
import { applyCorrection, resolveCorrectionPreset } from "./omo-subagent-skill-correction.mjs";

// Canary control kill-switch (comment switch): set DISABLED = true to run a
// control session - no rules injected and no banner shown. Flip back to
// false for treatment sessions. Never toggle within a session.
const DISABLED = false;

export const BANNER_TEXT = "Optimized system prompt applied: subagent-skill-correction";

interface ModelLike {
  id: string;
  name?: string;
}

interface SkillLike {
  disableModelInvocation?: boolean;
}

interface SystemPromptOptionsLike {
  selectedTools?: string[];
  skills?: SkillLike[];
}

interface BeforeAgentStartEvent {
  systemPrompt: string;
  systemPromptOptions?: SystemPromptOptionsLike;
}

interface UiLike {
  setHeader: (header: unknown) => void;
}

interface ExtensionCtx {
  model: ModelLike;
  ui: UiLike;
}

interface PiLike {
  on: (event: string, cb: (event: BeforeAgentStartEvent, ctx: ExtensionCtx) => unknown) => void;
}

// Capability detection from structured event data only (never prompt text):
// selectedTools containing "task" -> task-tool; at least one advertised skill
// with disableModelInvocation !== true -> visible-skills.
export function detectCapabilities(options: SystemPromptOptionsLike | undefined): Set<string> {
  const capabilities = new Set<string>();
  if (options?.selectedTools?.includes("task")) capabilities.add("task-tool");
  if (Array.isArray(options?.skills) && options.skills.some((skill) => skill?.disableModelInvocation !== true)) {
    capabilities.add("visible-skills");
  }
  return capabilities;
}

export default function omoSubagentSkillCorrectionExtension(pi: PiLike): void {
  // The single prompt-mutating handler registered by THIS extension.
  pi.on("before_agent_start", (event, ctx) => {
    if (DISABLED) return undefined;
    try {
      const preset = resolveCorrectionPreset({
        id: ctx.model?.id ?? "",
        name: ctx.model?.name,
        systemPrompt: event.systemPrompt,
      });
      const applied = applyCorrection(event.systemPrompt, preset, detectCapabilities(event.systemPromptOptions));
      return applied === event.systemPrompt ? undefined : { systemPrompt: applied };
    } catch (err) {
      // Fail-open: leave a runner-console trace and return the original prompt.
      console.warn("[omo-subagent-skill-correction] before_agent_start failed; prompt left unchanged:", err);
      return undefined;
    }
  });

  // NO banner handlers. The builtin prompt-preset extension already renders
  // the per-model banner ("Optimized system prompt applied: <preset>") for
  // EVERY model it knows, and user extensions run AFTER builtins in the
  // extension chain - registering our own model_select/session_start handlers
  // here would overwrite (setHeader is last-writer-wins) and hide the builtin
  // banner for GPT/GLM/Claude and every other model. The builtin banner is
  // therefore the correct and sufficient routing evidence for this extension
  // too: if it says deepseek-v4-pro / kimi-k3, both the preset and this
  // correction are active. (Verified: resource-loader.js
  // orderedExtensions.unshift(factoryExtensions) -> builtin first, user after;
  // runner.emit walks this.extensions in array order.)
}
