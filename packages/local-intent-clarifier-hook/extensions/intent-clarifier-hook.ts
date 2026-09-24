// intent-clarifier-hook — pi/omo input hook that nudges intent clarification (advisory)
// Live single source is this registered package copy; no loose extension is loaded for this hook.
// Emits a hidden ADVISORY note when a short/generic prompt heuristically looks vague;
// it never forces a question. AGENTS.md + ~/.agents/skills/intent-clarifier/ remain guidance.
// Current-request image attachments are recognized through the shared attachment
// policy (path extraction + native/path inventory), so attachment metadata is
// emitted independently of the short-text heuristics: an image-only or long-path
// request still reports count/source/needs-vision facts. The details line is
// machine-readable and always advisory; it never overrides clear context, never
// authorizes a read, and never forces a question.
import {
  buildAttachmentInventory,
  extractImagePathCandidates,
} from "./lib/custom-mode-policy.ts";
import type {
  AttachmentInventory,
  NativeImageInput,
} from "./lib/custom-mode-policy.ts";

const GATE_CUSTOM_TYPE = "omo-intent-clarifier:gate";
export const INTENT_DETAILS_PREFIX = "[intent-clarifier:details] ";
export const INTENT_DETAILS_VERSION = 1;

// Heuristics: short + generic verbs without scope/criteria/constraints
const VAGUE_PATTERNS: RegExp[] = [
  /고쳐줘|고쳐\s*줘/,
  /예쁘게|이쁘게/,
  /좀\s*(해줘|다듬|고쳐|빠르게|예쁘게)/,
  /대충|대강|적당히/,
  /빠르게|빨리\s*해줘/,
  /간단히|심플하게/,
  /알아서|추측|맘대로/,
  // English batch — added only after a real miss was observed in this run:
  // "please fix this login page for me" (33 chars, >32 short band, <=60 cap)
  // was not gated with Korean-only patterns. Pre-approved set from the plan.
  /\bfix\s+(it|this)\b|\bmake\s+it\s+(nicer|better|prettier)\b|\bclean\s+(this|it)\s+up\b|\bimprove\s+(this|it)\b/i,
];

const CLEAR_SIGNALS: RegExp[] = [
  /그냥\s*해줘|추측해서|바로\s*해줘|묻지\s*말고/,
  /파일|폴더|경로|\.ts|\.js|\.py|\.md|`[^`]+`/,
  /\d+번째\s*줄|\d+번\s*줄|라인\s*\d+/,
  /이\s*파일|이\s*코드|여기\s*코드|첨부/,
  /에러|오류|스택|TRACE|Exception/i,
  /로그\s|로그:|로그 분석|에러\s*로그/i,
  /→\s*\[intent-clarifier\]/,
];

const SKIP_COMMANDS = /^\s*(\/(plan|help|reload|clear|fork|compact|model|skill|hook|mcp|context|goal|todo|reset|init-deep)|ulw|hyperplan)/i;

function isVague(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (text.length > 140) return false; // long prompt likely has details
  if (SKIP_COMMANDS.test(text)) return false;
  // explicit skip signals -> not vague
  for (const re of CLEAR_SIGNALS) if (re.test(text)) return false;
  // very short generic request
  if (text.length <= 32) {
    for (const re of VAGUE_PATTERNS) if (re.test(text)) return true;
    // single short sentence without specifics counts as vague
    if (/^[^\n]{4,32}$/.test(text) && !/[.!?]{2,}/.test(text)) {
      // e.g. "로그인 고쳐줘", "화면 예쁘게 해줘"
      if (text.split(/\s+/).length <= 5) return true;
    }
  }
  // mid-length but still generic
  for (const re of VAGUE_PATTERNS) if (re.test(text) && text.length <= 60) return true;
  return false;
}

function buildGateDirective(prompt: string): string {
  return [
    `[intent-clarifier] heuristic ambiguity check — ADVISORY, not a gate.`,
    `A short/generic user prompt was detected: "${prompt.slice(0, 200)}"`,
    `This is a hint, not an order to interrogate the user. Decide from the surrounding conversation.`,
    `Proceed directly, WITHOUT asking, when the prompt is:`,
    `- a concrete request with enough detail to act on;`,
    `- a follow-up, correction, or approval continuing scope already agreed in this session;`,
    `- a status/info question you can answer directly;`,
    `- already answered, or covered by "그냥 해줘 / 추측해서 해줘".`,
    `Otherwise propose ONE refined sentence: "다듬은 요청: ..." and ask at most 1–3 short`,
    `questions (2–3 options each) ONLY when a genuinely missing consequential decision`,
    `(어디(범위) / 어떻게(기준) / 제외(제약)) would change what you build.`,
    `Then continue with the refined request after one confirmation; never re-ask or stall on`,
    `an explicit approval, and never re-open decisions already settled in this session.`,
    `Reference: ~/.agents/skills/intent-clarifier/SKILL.md`,
  ].join("\n");
}

interface BeforeAgentStartEvent {
  prompt: string;
  systemPrompt: string;
  images?: unknown[];
}

interface HookContext {
  cwd?: string;
  model?: { input?: readonly string[] } | undefined;
}

interface PiLike {
  on: (event: string, cb: (event: BeforeAgentStartEvent, ctx?: HookContext) => unknown) => void;
}

function normalizeNativeImages(images: unknown): NativeImageInput[] {
  if (!Array.isArray(images)) return [];
  const result: NativeImageInput[] = [];
  for (const entry of images) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { type?: unknown; data?: unknown; mimeType?: unknown };
    if (record.type !== "image") continue;
    if (typeof record.data !== "string" && !(record.data instanceof Uint8Array)) continue;
    result.push({
      type: "image",
      data: record.data as string | Uint8Array,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
    });
  }
  return result;
}

function resolveCwd(ctx: HookContext | undefined): string {
  // native before_agent_start always carries ctx.cwd; "." keeps relative resolution
  // on the process cwd without depending on the process global.
  return typeof ctx?.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : ".";
}

function mainHasImageInput(ctx: HookContext | undefined): boolean | null {
  const input = ctx?.model?.input;
  return Array.isArray(input) ? input.includes("image") : null;
}

function buildAttachmentDirective(inventory: AttachmentInventory, ctx: HookContext | undefined): string {
  const attachments = inventory.attachments;
  const nativeEntries = attachments.reduce((sum, attachment) => sum + (attachment.nativeRefs?.length ?? 0), 0);
  const pathImages = attachments.filter((attachment) => attachment.source === "path").length;
  const sources = [...new Set(attachments.map((attachment) => attachment.source))];
  const vision = mainHasImageInput(ctx);
  const lines = [
    `[intent-clarifier] attachment advisory - ADVISORY, not a gate. It never authorizes a read and never forces a question.`,
    `Attachment facts for THIS request: ${attachments.length} image attachment(s)`,
    `(native entries: ${nativeEntries}; path files: ${pathImages}; sources: ${sources.length > 0 ? sources.join(", ") : "none"}).`,
    `Image interpretation needs an image-capable model on the route (main model image input: ${vision === null ? "unknown" : vision ? "yes" : "no"}).`,
    `This metadata is a fact of the current request, not a read permission.`,
  ];
  if (inventory.errors.length > 0) {
    lines.push(`Explicit attachment errors (surface them; never silently treat the request as text-only):`);
    for (const error of inventory.errors) lines.push(`- ${error.reason}: ${error.candidate}`);
  }
  lines.push(
    `Guidance (advisory):`,
    `- do not ask which image the user means when the current request itself carries the attachment;`,
    `- a single-image information/judgment question can be answered directly after observing that one image;`,
    `- hand raw image pixels to a worker only when the owner explicitly requested it in this request, or when main has no image input.`,
  );
  return lines.join("\n");
}

function buildAdvisoryDetails(input: {
  vague: boolean;
  inventory: AttachmentInventory;
  ctx: HookContext | undefined;
}) {
  const attachments = input.inventory.attachments;
  return {
    version: INTENT_DETAILS_VERSION,
    advisory: true as const,
    question_policy: "advisory" as const,
    vague: input.vague,
    attachments: {
      count: attachments.length,
      sources: [...new Set(attachments.map((attachment) => attachment.source))],
      native_images: attachments.reduce((sum, attachment) => sum + (attachment.nativeRefs?.length ?? 0), 0),
      path_images: attachments.filter((attachment) => attachment.source === "path").length,
      // Image pixels must be interpreted by an image-capable model somewhere on the
      // route; this is capability metadata, never a category-name inference.
      needs_vision: attachments.length > 0,
      ids: attachments.map((attachment) => attachment.id),
      errors: input.inventory.errors.map((error) => ({ reason: error.reason, candidate: error.candidate })),
    },
    main_has_image_input: mainHasImageInput(input.ctx),
  };
}

export default function intentClarifierHook(pi: PiLike) {
  // Once-per-key idempotency guard. BeforeAgentStartEvent carries no inputId
  // (senpi types.d.ts:950-958 — prompt/images?/systemPrompt/systemPromptOptions
  // only; inputId lives on InputEvent/InputDispositionEvent), so each session
  // instance keys pending by the exact prompt string. The set is accumulate-only
  // (never cleared): a queued/steer input can neither replace nor re-fire the
  // active request, and a genuinely different prompt fires its own advisory at
  // most once. Same-input re-injection is silent.
  const firedPrompts = new Set<string>();
  pi.on("before_agent_start", (event, ctx) => {
    try {
      const prompt = typeof event?.prompt === "string" ? event.prompt : "";
      const nativeImages = normalizeNativeImages(event?.images);
      const needsInventory = nativeImages.length > 0 || extractImagePathCandidates(prompt).length > 0;
      const vague = isVague(prompt);
      if (!vague && !needsInventory) return undefined;
      if (firedPrompts.has(prompt)) return undefined; // idempotency: silent on same-input re-injection
      firedPrompts.add(prompt);
      if (!needsInventory) {
        // No host filesystem work: the sync fixture/tone suites read .message
        // directly, so this branch returns the plain result object (await is a
        // pass-through for it, keeping the details tests await-compatible).
        const sections: string[] = [];
        sections.push(buildGateDirective(prompt));
        sections.push(`${INTENT_DETAILS_PREFIX}${JSON.stringify(buildAdvisoryDetails({ vague, inventory: { attachments: [], errors: [] }, ctx }))}`);
        return {
          message: {
            customType: GATE_CUSTOM_TYPE,
            display: false as const,
            content: [{ type: "text" as const, text: sections.join("\n") }],
          },
        };
      }
      // Inventory path: host filesystem reads stay async (the details tests await
      // the handler); the returned promise resolves to the same message shape.
      return buildAttachmentInventory({ text: prompt, nativeImages, cwd: resolveCwd(ctx) }).then(
        (inventory) => {
          const hasAttachmentFacts = inventory.attachments.length > 0 || inventory.errors.length > 0;
          if (!vague && !hasAttachmentFacts) return undefined;
          const sections: string[] = [];
          if (vague) sections.push(buildGateDirective(prompt));
          if (hasAttachmentFacts) sections.push(buildAttachmentDirective(inventory, ctx));
          sections.push(`${INTENT_DETAILS_PREFIX}${JSON.stringify(buildAdvisoryDetails({ vague, inventory, ctx }))}`);

          // Inject as hidden custom message (harness-injected authority, display:false)
          // This is the same mechanism ulw uses (customType omo-ultrawork:directive).
          return {
            message: {
              customType: GATE_CUSTOM_TYPE,
              display: false as const,
              content: [{ type: "text" as const, text: sections.join("\n") }],
            },
          };
        },
        (err) => {
          console.warn("[intent-clarifier-hook] before_agent_start failed:", err);
          return undefined;
        },
      );
    } catch (err) {
      console.warn("[intent-clarifier-hook] before_agent_start failed:", err);
      return undefined;
    }
  });
}
