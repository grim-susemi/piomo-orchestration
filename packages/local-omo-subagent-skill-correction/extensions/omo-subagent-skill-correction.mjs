// omo subagent-skill correction - matching gate + capability-routing rules.
// Plan: .omo/plans/omo-model-presets-deepseek-k3.md, Appendix A.
//
// Matching contract:
//   (a) applied-preset signature detection is the primary, decisive gate and
//       fails closed: if the built system prompt carries no target-preset
//       signature, never correct - even when the id/name mirror matches
//       (G03: settings.promptPreset is not exposed to before_agent_start, so
//       the signature is the only evidence that a builtin preset was applied).
//   (b) the id/name normalized mirror below (verbatim from presets.ts via
//       Appendix A) disambiguates the flash variant: flash-0731 is checked
//       before generic flash. Colon-dated ids (deepseek-v4-flash:0731) fall
//       back to generic flash because the dated matcher allows only . _ -
//       separators.
// No provider allowlist anywhere.

// --- Resolver mirror (Appendix A, regexes verbatim) ---

export const normalize = (v) => v.toLowerCase().replace(/\s+/g, "-");

export const hasKimiK3 = (v) => {
  const n = normalize(v);
  return n === "k3" || /(?:^|[/@._-])kimi-k3(?:$|[/@._:-])/.test(n);
};

export const hasDeepseekV4Flash0731 = (v) =>
  /(?:^|[/@:._-])deepseek[._-]v4[._-]flash[._-]0731(?:$|[/@:._-])/.test(normalize(v));

export const hasDeepseekV4Flash = (v) => /(?:^|[/@:._-])deepseek[._-]v4[._-]flash(?:$|[/@:._-])/.test(normalize(v));

export const hasDeepseekV4Pro = (v) => /(?:^|[/@:._-])deepseek[._-]v4[._-]pro(?:$|[/@:._-])/.test(normalize(v));

// --- Applied-preset signatures (Appendix A, verified against preset sources) ---
// kimi-k3.ts buildKimiK3Core, deepseek-v4-pro.ts PRO_INTRO, and the flash
// intro builder (structure-first appears in flash/flash-0731 only, never pro).

export const KIMI_K3_SIGNATURE = "running on Kimi K3";
export const DEEPSEEK_FLASH_SIGNATURE = "structure-first";
export const DEEPSEEK_PRO_SIGNATURE = "running on DeepSeek V4 Pro";

/**
 * Resolve the correction preset for the current turn, or null (fail-closed).
 * target: { id?: string, name?: string, systemPrompt?: string } - any extra
 * fields (e.g. settings.promptPreset) are deliberately ignored.
 */
export function resolveCorrectionPreset(target) {
  const prompt = typeof target?.systemPrompt === "string" ? target.systemPrompt : "";
  const candidates = [target?.id, target?.name].filter((v) => typeof v === "string" && v.length > 0);
  const mirror = (re) => candidates.some((v) => re(v));
  // The signature alone is not enough: project context files (AGENTS.md etc.)
  // are concatenated into the prompt and could contain the literal signature
  // text for an unrelated model, which would corrupt a GPT/GLM/Claude prompt.
  // So the id/name mirror must agree with the signature family. This keeps
  // the fail-closed guarantee for non-target models.
  if (prompt.includes(KIMI_K3_SIGNATURE) && mirror(hasKimiK3)) return "kimi-k3";
  if (prompt.includes(DEEPSEEK_PRO_SIGNATURE) && mirror(hasDeepseekV4Pro)) return "deepseek-v4-pro";
  if (prompt.includes(DEEPSEEK_FLASH_SIGNATURE)) {
    // flash and flash-0731 share one signature; the id/name mirror picks the
    // variant, 0731 first. Unresolvable variant -> fail closed.
    if (mirror(hasDeepseekV4Flash0731)) return "deepseek-v4-flash-0731";
    if (mirror(hasDeepseekV4Flash)) return "deepseek-v4-flash";
    return null;
  }
  return null;
}

// Resolve a target model without requiring the built-in preset signature in
// the prompt (banner/routing use): id/name mirror only, mirroring the builtin
// resolver's order (0731 before flash, kimi-k3 exact/bounded).
export function resolvePresetMatch(target) {
  const candidates = [target?.id, target?.name].filter((v) => typeof v === "string" && v.length > 0);
  if (!candidates.length) return null;
  if (candidates.some(hasDeepseekV4Flash0731)) return "deepseek-v4-flash-0731";
  if (candidates.some(hasDeepseekV4Flash)) return "deepseek-v4-flash";
  if (candidates.some(hasDeepseekV4Pro)) return "deepseek-v4-pro";
  if (candidates.some(hasKimiK3)) return "kimi-k3";
  return null;
}

// --- Owned markers and rule data (Appendix A, verbatim) ---

export const CORRECTION_START_MARKER = "<!-- omo:subagent-skill-correction:start -->";
export const CORRECTION_END_MARKER = "<!-- omo:subagent-skill-correction:end -->";
const MARKER_NAMESPACE = "omo:subagent-skill-correction";

const DEEPSEEK_V4_PRESETS = ["deepseek-v4-flash", "deepseek-v4-flash-0731", "deepseek-v4-pro"];

// Typed rule data: concern (2) x family (2). Directive texts verbatim from
// Appendix A; tests assert structure only, never this prose.
export const CORRECTION_RULES = [
  {
    id: "deepseek-v4.delegate-separable-work",
    concern: "subagent-delegation",
    presets: DEEPSEEK_V4_PRESETS,
    requires: ["task-tool"],
    directive:
      "At task intake, partition the work into the local critical path and separable workstreams. A bounded workstream that does not depend on the parent's in-progress edits is a `task` call: spawn it before local implementation, and submit independent workstreams in one batch. Keep only trivial lookups and tightly coupled edits local. Delegation is complete only after every child result has been read and its evidence integrated into the parent answer.",
  },
  {
    id: "deepseek-v4.load-matching-skills",
    concern: "skill-utilization",
    presets: DEEPSEEK_V4_PRESETS,
    requires: ["visible-skills"],
    directive:
      "Before the first non-discovery action, compare the task with every visible skill description. For each loose match, read that skill's listed `SKILL.md` and follow it; when matching work is delegated, include the skill name in `load_skills`. Proceed without a skill only after this scan finds no match - recognizing a match without loading it does not complete the gate.",
  },
  {
    id: "kimi-k3.delegate-separable-work",
    concern: "subagent-delegation",
    presets: ["kimi-k3"],
    requires: ["task-tool"],
    directive:
      "Settle the delegation decision once at task intake: if a bounded research, reconnaissance, review, or independent-verification workstream can run without the parent's in-progress edits, spawn it with `task` before the local critical path, batching independent workstreams. Keep trivial or tightly coupled work local. Stop delegation once child results are consumed and integrated; do not reopen the decision or duplicate the child's work.",
  },
  {
    id: "kimi-k3.load-matching-skills",
    concern: "skill-utilization",
    presets: ["kimi-k3"],
    requires: ["visible-skills"],
    directive:
      "Make the visible-skill scan a terminal gate before substantive work: compare the task with every listed description, read each loosely matching `SKILL.md`, and apply it. If matching work is delegated, pass its skill name in `load_skills`. The gate is complete only when all matches are loaded or the scan finds none.",
  },
];

export function familyOfPreset(preset) {
  if (preset === "kimi-k3") return "kimi-k3";
  if (DEEPSEEK_V4_PRESETS.includes(preset)) return "deepseek-v4";
  return null;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count += 1;
    i += needle.length;
  }
  return count;
}

// Strip every owned block (each with its owned preceding "\n\n"). Refuses to
// guess: malformed / nested / unterminated / reversed markers throw.
export function stripCorrectionBlocks(input) {
  const mentions = countOccurrences(input, MARKER_NAMESPACE);
  const starts = countOccurrences(input, CORRECTION_START_MARKER);
  const ends = countOccurrences(input, CORRECTION_END_MARKER);
  if (mentions !== starts + ends) {
    throw new Error(`malformed correction marker: ${mentions} namespace mention(s) but ${starts} start + ${ends} end marker(s)`);
  }
  let out = "";
  let rest = input;
  while (rest.length > 0) {
    const s = rest.indexOf(CORRECTION_START_MARKER);
    const e = rest.indexOf(CORRECTION_END_MARKER);
    if (e !== -1 && (s === -1 || e < s)) {
      throw new Error("reversed correction markers: end marker before any start marker");
    }
    if (s === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, s);
    const afterStart = rest.slice(s + CORRECTION_START_MARKER.length);
    const endIdx = afterStart.indexOf(CORRECTION_END_MARKER);
    if (endIdx === -1) {
      throw new Error("unterminated correction block: start marker without end marker");
    }
    const nestedIdx = afterStart.indexOf(CORRECTION_START_MARKER);
    if (nestedIdx !== -1 && nestedIdx < endIdx) {
      throw new Error("nested correction block: start marker inside an open block");
    }
    rest = afterStart.slice(endIdx + CORRECTION_END_MARKER.length);
    if (out.endsWith("\n\n")) out = out.slice(0, -2);
  }
  return out;
}

function renderCorrectionBlock(preset, rules) {
  const family = familyOfPreset(preset);
  const lines = [
    CORRECTION_START_MARKER,
    `<omo-prompt-delta schema="1" family="${family}" preset="${preset}">`,
    ...rules.map(
      (rule) =>
        `  <rule id="${rule.id}" concern="${rule.concern}" requires="${rule.requires.join(",")}">${rule.directive}</rule>`,
    ),
    "</omo-prompt-delta>",
    CORRECTION_END_MARKER,
  ];
  return lines.join("\n");
}

/**
 * strip owned blocks -> resolve rules for preset+capabilities -> re-render.
 * preset null/unknown or zero matching rules returns the stripped prompt.
 * capabilities: iterable of "task-tool" / "visible-skills".
 */
export function applyCorrection(basePrompt, preset, capabilities) {
  const stripped = stripCorrectionBlocks(basePrompt);
  const caps = new Set(capabilities ?? []);
  const rules = CORRECTION_RULES.filter(
    (rule) => rule.presets.includes(preset) && rule.requires.every((need) => caps.has(need)),
  );
  if (rules.length === 0) return stripped;
  return `${stripped}\n\n${renderCorrectionBlock(preset, rules)}`;
}
