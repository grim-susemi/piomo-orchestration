// custom-mode-policy — contract-A current-request attachment primitives and the
// contract-D/E delegation primitives shared with omo-orchestrator-guard.ts.
//
// Pure extraction, canonicalization, dedup, and validation helpers plus the
// native-task batch/target planner, the CUSTOM_MODE_VISION_V1 prompt contract and
// the exact-ledger image materializer. Per-session authorization state (pending
// inputs, frames, receipts, ledgers) stays in omo-orchestrator-guard.ts; this
// module has no session state and no registration side effects. It sits below
// lib/ so the native one-level extension discovery never loads it as an
// extension (loader.js: "No recursion beyond one level"). Host filesystem/MIME
// helpers load through the same location-independent deep-import seam the guard
// uses; when they are unavailable every candidate fails closed with
// host-helpers-unavailable instead of falling back to a lexical grant.

import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { env } from "node:process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

export const CUSTOM_MODE_IMAGE_INVALID = "CUSTOM_MODE_IMAGE_INVALID";
export const CUSTOM_MODE_VISION_SENTINEL = "CUSTOM_MODE_VISION_V1";
export const TASK_ID_PATTERN = /^st_[0-9a-f]{8}$/;

export function isTaskId(value: unknown): value is string {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

export type ImageRejectionReason =
  | "url-not-fetched"
  | "local-uri-unsupported"
  | "glob-not-expanded"
  | "not-found"
  | "not-regular-file"
  | "unreadable"
  | "unsupported-image-content"
  | "invalid-native-data"
  | "host-helpers-unavailable";

export type GrantFailureReason =
  | "not-path-backed"
  | "not-found"
  | "not-regular-file"
  | "unreadable"
  | "content-changed"
  | "identity-changed"
  | "mime-changed"
  | "host-helpers-unavailable";

export interface ImagePathCandidate {
  /** Exact text span the candidate was extracted from. */
  raw: string;
  /** Candidate path/URI text with surrounding quotes removed. */
  value: string;
  quoted: boolean;
}

export interface CustomImageError {
  code: typeof CUSTOM_MODE_IMAGE_INVALID;
  reason: ImageRejectionReason;
  candidate: string;
  message: string;
}

export interface ImageAttachment {
  /** Stable within one generation: image-1, image-2, ... */
  id: string;
  source: "path" | "native";
  mimeType: string;
  size: number;
  sha256: string;
  /** Canonical path recorded for a path-backed grant (or a native merged into one). */
  path?: string;
  requestedPath?: string;
  /** dev:ino:size:mtimeNs:ctimeNs, rechecked before any later read. */
  identity?: string;
  /** Indexes of native entries this attachment covers (may be empty for pure paths). */
  nativeRefs: number[];
}

export interface AttachmentInventory {
  attachments: ImageAttachment[];
  errors: CustomImageError[];
}

export interface NativeImageInput {
  type?: "image";
  data: string | Uint8Array;
  mimeType?: string;
}

export type PathGrantVerification =
  | { ok: true }
  | { ok: false; reason: GrantFailureReason; message: string };

export interface PolicyFileStats {
  isFile(): boolean;
  size: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
}

export interface AttachmentPolicyDeps {
  resolveReadPathAsync: (filePath: string, cwd: string) => Promise<string>;
  canonicalizeFilesystemPath: (filePath: string) => Promise<string>;
  detectSupportedImageMimeType: (bytes: Uint8Array) => string | null | undefined;
  readFileBytes: (filePath: string) => Promise<Buffer>;
  statFile: (filePath: string) => Promise<PolicyFileStats>;
}

export type PolicyDepsOverride = Partial<AttachmentPolicyDeps>;

const SUPPORTED_IMAGE_SUFFIX = /\.(?:png|jpe?g|gif|webp|bmp)$/i;
const SCHEME_PREFIX = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_URI_PREFIX = /^local:\/\//i;
const GLOB_CHARACTERS = /[*?[\]]/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

const REASON_MESSAGES: Record<ImageRejectionReason, string> = {
  "url-not-fetched": "remote URLs are never fetched; save the image locally and reference the local file",
  "local-uri-unsupported": "local:// URIs are not filesystem paths; use the plain local file path",
  "glob-not-expanded": "wildcards are not expanded; name each readable image file explicitly",
  "not-found": "no readable file exists at this path; if the path contains spaces, wrap it in double quotes",
  "not-regular-file": "the path is not a regular file",
  "unreadable": "the file could not be read",
  "unsupported-image-content": "the file content is not a supported image (png/jpg/jpeg/gif/webp/bmp)",
  "invalid-native-data": "the native image payload is not valid base64 image data",
  "host-helpers-unavailable": "the host filesystem/MIME helpers are unavailable; attachment reads stay closed",
};

function rejection(reason: ImageRejectionReason, candidate: string): CustomImageError {
  return {
    code: CUSTOM_MODE_IMAGE_INVALID,
    reason,
    candidate,
    message: `Rejected image candidate ${JSON.stringify(candidate)}: ${REASON_MESSAGES[reason]}`,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * SHA-256 of decoded native image bytes, or undefined when the payload is not
 * valid base64 image data. Used to match a recorded native attachment against
 * the native images a delivered message actually carries.
 */
export function nativeImageSha256(input: NativeImageInput | undefined): string | undefined {
  const bytes = decodeNativeImage(input);
  return bytes === undefined ? undefined : sha256Hex(bytes);
}

function fileIdentity(stats: PolicyFileStats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":");
}

function isMissingError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (error as { code?: unknown }).code === "ENOENT";
}

/** Existing Windows comparison semantics: case-folded on win32, exact elsewhere. */
export function canonicalPathKey(filePath: string): string {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

/**
 * Does this text name a file with a supported image suffix (png/jpg/jpeg/gif/
 * webp/bmp, case-insensitive)? The guard uses this to route a denied read to the
 * contract-C single-image allowance instead of the generic document message.
 */
export function isSupportedImagePath(value: string): boolean {
  return typeof value === "string" && SUPPORTED_IMAGE_SUFFIX.test(value);
}

/**
 * Extract local image-file tokens from current user text. Quoted spans may contain
 * spaces; unquoted spans stop at whitespace or a quote/backtick. Only supported
 * image suffixes become candidates — the classification step turns unsupported
 * schemes/globs into explicit errors, so nothing is silently treated as no-image.
 */
export function extractImagePathCandidates(text: string): ImagePathCandidate[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const candidates: ImagePathCandidate[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === "'" || char === "`") {
      const closing = text.indexOf(char, index + 1);
      if (closing === -1) break;
      const inner = text.slice(index + 1, closing).trim();
      if (inner.length > 0 && SUPPORTED_IMAGE_SUFFIX.test(inner)) {
        candidates.push({ raw: text.slice(index, closing + 1), value: inner, quoted: true });
      }
      index = closing + 1;
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length && !/[\s"'`]/.test(text[end])) end += 1;
    const token = text.slice(index, end);
    if (SUPPORTED_IMAGE_SUFFIX.test(token)) candidates.push({ raw: token, value: token, quoted: false });
    index = end;
  }
  return candidates;
}

type CandidateClassification = { kind: "reject"; reason: ImageRejectionReason } | { kind: "path" };

function classifyCandidate(value: string): CandidateClassification {
  if (LOCAL_URI_PREFIX.test(value)) return { kind: "reject", reason: "local-uri-unsupported" };
  if (SCHEME_PREFIX.test(value)) return { kind: "reject", reason: "url-not-fetched" };
  if (GLOB_CHARACTERS.test(value)) return { kind: "reject", reason: "glob-not-expanded" };
  return { kind: "path" };
}

function decodeNativeImage(input: NativeImageInput | undefined): Buffer | undefined {
  const raw = input?.data;
  if (typeof raw === "string") {
    const bodyText = /^data:[^,]*,/i.test(raw) ? raw.slice(raw.indexOf(",") + 1) : raw;
    const body = bodyText.replace(/[\r\n]/g, "");
    if (body.length === 0 || body.length % 4 !== 0 || !BASE64_BODY.test(body)) return undefined;
    return Buffer.from(body, "base64");
  }
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  return undefined;
}

// --- Host seam: same location-independent deep-import strategy as the guard. ---

declare global {
  interface ImportMeta {
    readonly import?: (specifier: string, options?: Readonly<Record<string, unknown>>) => Promise<unknown>;
  }
}

interface HostPolicyTable {
  resolveReadPathAsync?: AttachmentPolicyDeps["resolveReadPathAsync"];
  canonicalizeFilesystemPath?: AttachmentPolicyDeps["canonicalizeFilesystemPath"];
  detectSupportedImageMimeType?: AttachmentPolicyDeps["detectSupportedImageMimeType"];
}

// Candidate-arm host seam: every host module resolves from this arm's senpi
// dist. The module's own package graph is tried first, then OMO_SENPI_DIST (the
// per-arm pin), then the install graph derived from OMO_BIN. Every path-based
// candidate is realpath-verified under its own root (the arm prefix, the pinned
// dist, or the install root) before it is imported. There is no live install,
// roaming-profile, or depth-relative fallback: a miss returns undefined and
// the read gate fails closed with host-helpers-unavailable.
function policyArmGraph(): Promise<{ dist: string; prefix: string } | undefined> {
  let hits: string[] | null;
  try {
    hits = createRequire(import.meta.url).resolve.paths("@code-yeongyu/senpi");
  } catch {
    return Promise.resolve(undefined);
  }
  const walk = async (): Promise<{ dist: string; prefix: string } | undefined> => {
    for (const base of hits ?? []) {
      const dir = join(base, "@code-yeongyu", "senpi");
      try {
        const meta = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { name?: unknown };
        if (meta.name !== "@code-yeongyu/senpi") continue;
        await stat(join(dir, "dist", "index.js"));
        return { dist: join(dir, "dist"), prefix: resolve(dir, "..", "..", "..") };
      } catch {
        continue;
      }
    }
    return undefined;
  };
  return walk();
}

// Contract section 2: a senpi package directory is a valid graph only when its
// package.json names the package and its dist/index.js exists. The pinned value
// and the install-graph bases are completed from this check instead of being
// trusted as given; an invalid input is skipped, never fatal.
const senpiDistFor = async (dir: string): Promise<string | undefined> => {
  try {
    const meta = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { name?: unknown };
    if (meta.name !== "@code-yeongyu/senpi") return undefined;
    const dist = await realpath(join(dir, "dist"));
    await stat(join(dist, "index.js"));
    return dist;
  } catch {
    return undefined;
  }
};

const withinRoot = (real: string, root: string): boolean => real === root || real.startsWith(root + sep);

// Contract section 1 order: arm graph, then the pin, then the OMO_BIN install
// graph; a step that misses falls through, and each candidate is realpath-verified
// against its own root before the import.
async function importHostModule(deep: string): Promise<unknown> {
  const hostImport = typeof import.meta.import === "function" ? import.meta.import : undefined;
  if (hostImport !== undefined) {
    try {
      return await hostImport(`@code-yeongyu/senpi/dist/${deep}`);
    } catch {
      // Fall through to the arm-rooted candidates below.
    }
  }
  const candidates: { dist: string; root: string }[] = [];
  const graph = await policyArmGraph();
  const armRoot = graph === undefined ? undefined : await realpath(graph.prefix).catch(() => undefined);
  if (graph !== undefined && armRoot !== undefined) {
    candidates.push({ dist: graph.dist, root: armRoot });
  }
  const pinned = env.OMO_SENPI_DIST;
  if (typeof pinned === "string" && pinned.length > 0) {
    const pinnedDist = await senpiDistFor(resolve(pinned, ".."));
    if (pinnedDist !== undefined && (armRoot === undefined || withinRoot(pinnedDist, armRoot))) {
      candidates.push({ dist: pinnedDist, root: pinnedDist });
    }
  }
  const omoBin = env.OMO_BIN;
  if (typeof omoBin === "string" && omoBin.length > 0) {
    const suffix = join("node_modules", "omo-ai", "bin", "omo.js");
    const binReal = await realpath(resolve(omoBin)).catch(() => undefined);
    if (binReal !== undefined && binReal.endsWith(suffix)) {
      const installRoot = await realpath(binReal.slice(0, binReal.length - suffix.length - 1)).catch(() => undefined);
      if (installRoot !== undefined) {
        for (const dir of [join(installRoot, "node_modules", "@code-yeongyu", "senpi"),
          join(installRoot, "node_modules", "omo-ai", "node_modules", "@code-yeongyu", "senpi")]) {
          const dist = await senpiDistFor(dir);
          if (dist !== undefined && withinRoot(dist, installRoot)) candidates.push({ dist, root: installRoot });
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const real = await realpath(resolve(candidate.dist, deep));
      if (!withinRoot(real, candidate.root)) continue;
      return await import(pathToFileURL(real).href);
    } catch {
      // Next candidate; a total miss fails closed below.
    }
  }
  return undefined;
}

let hostPolicyTable: Promise<HostPolicyTable> | undefined;

function loadHostPolicyTable(): Promise<HostPolicyTable> {
  hostPolicyTable ??= (async () => {
    const table: HostPolicyTable = {};
    const pathUtils = (await importHostModule("core/tools/path-utils.js")) as
      { resolveReadPathAsync?: AttachmentPolicyDeps["resolveReadPathAsync"] } | undefined;
    if (typeof pathUtils?.resolveReadPathAsync === "function") {
      table.resolveReadPathAsync = pathUtils.resolveReadPathAsync;
    }
    const filesystemPolicy = (await importHostModule("core/tools/filesystem-policy.js")) as
      { canonicalizeFilesystemPath?: AttachmentPolicyDeps["canonicalizeFilesystemPath"] } | undefined;
    if (typeof filesystemPolicy?.canonicalizeFilesystemPath === "function") {
      table.canonicalizeFilesystemPath = filesystemPolicy.canonicalizeFilesystemPath;
    }
    const mime = (await importHostModule("utils/mime.js")) as
      { detectSupportedImageMimeType?: AttachmentPolicyDeps["detectSupportedImageMimeType"] } | undefined;
    if (typeof mime?.detectSupportedImageMimeType === "function") {
      table.detectSupportedImageMimeType = mime.detectSupportedImageMimeType;
    }
    return table;
  })();
  return hostPolicyTable;
}

const DEFAULT_DEPS: Partial<AttachmentPolicyDeps> = {
  readFileBytes: (filePath: string) => readFile(filePath),
  statFile: (filePath: string) =>
    stat(filePath, { bigint: true }) as unknown as Promise<PolicyFileStats>,
};

async function resolveDeps(override?: PolicyDepsOverride): Promise<Partial<AttachmentPolicyDeps>> {
  const host = await loadHostPolicyTable();
  return { ...DEFAULT_DEPS, ...host, ...override };
}

function missingDeps(deps: Partial<AttachmentPolicyDeps>): ImageRejectionReason | undefined {
  if (typeof deps.resolveReadPathAsync !== "function"
    || typeof deps.canonicalizeFilesystemPath !== "function"
    || typeof deps.detectSupportedImageMimeType !== "function"
    || typeof deps.readFileBytes !== "function"
    || typeof deps.statFile !== "function") {
    return "host-helpers-unavailable";
  }
  return undefined;
}

async function validatePathCandidate(
  candidate: string,
  cwd: string,
  deps: Partial<AttachmentPolicyDeps>,
): Promise<{ attachment: ImageAttachment } | { error: CustomImageError }> {
  const unavailable = missingDeps(deps);
  if (unavailable !== undefined) return { error: rejection(unavailable, candidate) };
  let resolved: string;
  try {
    resolved = await deps.resolveReadPathAsync!(candidate, cwd);
  } catch {
    return { error: rejection("not-found", candidate) };
  }
  let canonical: string;
  try {
    canonical = await deps.canonicalizeFilesystemPath!(resolved);
  } catch {
    return { error: rejection("unreadable", candidate) };
  }
  let stats: PolicyFileStats;
  try {
    stats = await deps.statFile!(canonical);
  } catch (error) {
    return { error: rejection(isMissingError(error) ? "not-found" : "unreadable", candidate) };
  }
  if (!stats.isFile()) return { error: rejection("not-regular-file", candidate) };
  let bytes: Buffer;
  try {
    bytes = await deps.readFileBytes!(canonical);
  } catch (error) {
    return { error: rejection(isMissingError(error) ? "not-found" : "unreadable", candidate) };
  }
  const mimeType = deps.detectSupportedImageMimeType!(bytes);
  if (typeof mimeType !== "string" || mimeType.length === 0) {
    return { error: rejection("unsupported-image-content", candidate) };
  }
  return {
    attachment: {
      id: "",
      source: "path",
      mimeType,
      size: Number(stats.size),
      sha256: sha256Hex(bytes),
      path: canonical,
      requestedPath: candidate,
      identity: fileIdentity(stats),
      nativeRefs: [],
    },
  };
}

/**
 * Build the current-request attachment inventory. Path candidates are validated
 * against real readable regular files with detected supported MIME; native entries
 * are decoded from memory only. Canonical paths dedupe case-insensitively on
 * Windows; byte-identical native entries dedupe by SHA-256; a native/path pair
 * dedupes only when bytes match. Ids stay image-1, image-2, ... in this build order.
 */
export async function buildAttachmentInventory(input: {
  text: string;
  nativeImages?: readonly NativeImageInput[];
  cwd: string;
  deps?: PolicyDepsOverride;
}): Promise<AttachmentInventory> {
  const deps = await resolveDeps(input.deps);
  const attachments: ImageAttachment[] = [];
  const errors: CustomImageError[] = [];
  const seenPathKeys = new Set<string>();
  const bySha = new Map<string, ImageAttachment>();

  for (const candidate of extractImagePathCandidates(input.text)) {
    const classification = classifyCandidate(candidate.value);
    if (classification.kind === "reject") {
      errors.push(rejection(classification.reason, candidate.value));
      continue;
    }
    const result = await validatePathCandidate(candidate.value, input.cwd, deps);
    if ("error" in result) {
      errors.push(result.error);
      continue;
    }
    const attachment = result.attachment;
    const key = canonicalPathKey(attachment.path as string);
    if (seenPathKeys.has(key)) continue;
    seenPathKeys.add(key);
    attachment.id = `image-${attachments.length + 1}`;
    attachments.push(attachment);
    if (!bySha.has(attachment.sha256)) bySha.set(attachment.sha256, attachment);
  }

  const natives = input.nativeImages ?? [];
  for (let index = 0; index < natives.length; index += 1) {
    const candidate = `native:${index}`;
    const bytes = decodeNativeImage(natives[index]);
    if (bytes === undefined) {
      errors.push(rejection("invalid-native-data", candidate));
      continue;
    }
    if (typeof deps.detectSupportedImageMimeType !== "function") {
      errors.push(rejection("host-helpers-unavailable", candidate));
      continue;
    }
    const mimeType = deps.detectSupportedImageMimeType(bytes);
    if (typeof mimeType !== "string" || mimeType.length === 0) {
      errors.push(rejection("unsupported-image-content", candidate));
      continue;
    }
    const digest = sha256Hex(bytes);
    const prior = bySha.get(digest);
    if (prior !== undefined) {
      prior.nativeRefs.push(index);
      continue;
    }
    const attachment: ImageAttachment = {
      id: `image-${attachments.length + 1}`,
      source: "native",
      mimeType,
      size: bytes.length,
      sha256: digest,
      nativeRefs: [index],
    };
    attachments.push(attachment);
    bySha.set(digest, attachment);
  }

  return { attachments, errors };
}

/**
 * Preflight recheck for a path-backed grant: the recorded canonical path must still
 * hold the same content hash and file identity. Replacing the file (even with
 * byte-identical content) invalidates the grant instead of widening it.
 */
export async function verifyPathGrant(
  attachment: ImageAttachment,
  depsOverride?: PolicyDepsOverride,
): Promise<PathGrantVerification> {
  const recordedPath = attachment?.path;
  if (typeof recordedPath !== "string" || recordedPath.length === 0) {
    return { ok: false, reason: "not-path-backed", message: "attachment has no canonical path grant" };
  }
  const deps = await resolveDeps(depsOverride);
  if (typeof deps.statFile !== "function" || typeof deps.readFileBytes !== "function"
    || typeof deps.detectSupportedImageMimeType !== "function") {
    return { ok: false, reason: "host-helpers-unavailable", message: REASON_MESSAGES["host-helpers-unavailable"] };
  }
  let stats: PolicyFileStats;
  try {
    stats = await deps.statFile(recordedPath);
  } catch (error) {
    const reason: GrantFailureReason = isMissingError(error) ? "not-found" : "unreadable";
    return { ok: false, reason, message: REASON_MESSAGES[reason] };
  }
  if (!stats.isFile()) {
    return { ok: false, reason: "not-regular-file", message: REASON_MESSAGES["not-regular-file"] };
  }
  let bytes: Buffer;
  try {
    bytes = await deps.readFileBytes(recordedPath);
  } catch (error) {
    const reason: GrantFailureReason = isMissingError(error) ? "not-found" : "unreadable";
    return { ok: false, reason, message: REASON_MESSAGES[reason] };
  }
  if (sha256Hex(bytes) !== attachment.sha256) {
    return { ok: false, reason: "content-changed", message: "file content no longer matches the recorded SHA-256" };
  }
  if (typeof attachment.identity === "string" && fileIdentity(stats) !== attachment.identity) {
    return { ok: false, reason: "identity-changed", message: "file identity/stat fields changed since the grant was recorded" };
  }
  const mimeType = deps.detectSupportedImageMimeType(bytes);
  if (mimeType !== attachment.mimeType) {
    return { ok: false, reason: "mime-changed", message: "detected image MIME no longer matches the recorded grant" };
  }
  return { ok: true };
}

// --- Contract-D/E delegation primitives ---------------------------------------

export interface VisionContractImage {
  id: string;
  path: string;
  mime_type: string;
}

export interface VisionPromptContract {
  version: 1;
  frame_id: string;
  generation_id: string;
  requires_vision: true;
  model: string;
  images: VisionContractImage[];
}

/**
 * Read-only instructions that follow the sentinel header. The exact text is part
 * of the installed prefix so re-installation can strip and replace it instead of
 * stacking copies.
 */
export const VISION_CONTRACT_INSTRUCTIONS = [
  "You are a bounded read-only vision extractor. Use the native read tool to read every path in the images list above, then report per-image observations and uncertainties in your final message. Do not edit files, run shell commands, or start further work.",
].join("\n");

export function buildVisionContractPrefix(contract: VisionPromptContract): string {
  return `${CUSTOM_MODE_VISION_SENTINEL}\n${JSON.stringify(contract)}\n${VISION_CONTRACT_INSTRUCTIONS}\n\n`;
}

export type VisionPromptInstall =
  | { ok: true; prompt: string; replaced: boolean }
  | { ok: false; reason: "sentinel-conflict" | "sentinel-malformed"; message: string };

/**
 * Prepend the generated contract to a main-authored prompt exactly once. A prefix
 * this extension wrote for the same version/frame is replaced in place; any
 * conflicting version or frame id is rejected instead of accepted as
 * authorization. A sentinel that does not lead the prompt is main-authored text
 * and stays untouched.
 */
export function installVisionContractPrompt(prompt: string, contract: VisionPromptContract): VisionPromptInstall {
  if (typeof prompt !== "string") {
    return { ok: false, reason: "sentinel-malformed", message: "the vision task prompt must be a string" };
  }
  const prefix = buildVisionContractPrefix(contract);
  if (!prompt.startsWith(`${CUSTOM_MODE_VISION_SENTINEL}\n`)) {
    return { ok: true, prompt: `${prefix}${prompt}`, replaced: false };
  }
  const lineStart = CUSTOM_MODE_VISION_SENTINEL.length + 1;
  const newline = prompt.indexOf("\n", lineStart);
  const line = newline === -1 ? prompt.slice(lineStart) : prompt.slice(lineStart, newline);
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: "sentinel-malformed",
      message: `the ${CUSTOM_MODE_VISION_SENTINEL} header is not a valid JSON line` };
  }
  const record = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : undefined;
  if (record?.version !== 1 || record.frame_id !== contract.frame_id
    || record.generation_id !== contract.generation_id) {
    return { ok: false, reason: "sentinel-conflict",
      message: `the caller-supplied ${CUSTOM_MODE_VISION_SENTINEL} header names a different version/frame; it is not this extension's authorization` };
  }
  let body = newline === -1 ? "" : prompt.slice(newline + 1);
  if (body.startsWith(`${VISION_CONTRACT_INSTRUCTIONS}\n\n`)) {
    body = body.slice(VISION_CONTRACT_INSTRUCTIONS.length + 2);
  }
  return { ok: true, prompt: `${prefix}${body}`, replaced: true };
}

/** Decoded bytes of a native image input, or undefined for invalid base64 data. */
export function nativeImageBytes(input: NativeImageInput | undefined): Buffer | undefined {
  return decodeNativeImage(input);
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

export function imageExtensionForMime(mimeType: string): string | undefined {
  return MIME_EXTENSIONS[mimeType?.toLowerCase()];
}

export type MaterializeResult =
  | { ok: true; path: string; created: boolean }
  | { ok: false; reason: "unsupported-image-content" | "generated-file-conflict" | "unwritable"; message: string };

/**
 * Write supplied native image bytes under the exact generated ledger path.
 * Exclusive creation: an existing file is only reused when its bytes match;
 * otherwise the materialization fails instead of overwriting anything.
 */
export async function materializeImageBytes(input: {
  bytes: Uint8Array;
  mimeType: string;
  directory: string;
  fileName: string;
  deps?: PolicyDepsOverride;
}): Promise<MaterializeResult> {
  const deps = await resolveDeps(input.deps);
  if (typeof deps.detectSupportedImageMimeType === "function") {
    const detected = deps.detectSupportedImageMimeType(Buffer.from(input.bytes));
    if (typeof detected !== "string" || detected.length === 0 || detected !== input.mimeType) {
      return { ok: false, reason: "unsupported-image-content",
        message: `the materialized bytes do not match the recorded ${input.mimeType} image` };
    }
  }
  const target = join(input.directory, input.fileName);
  try {
    await mkdir(input.directory, { recursive: true });
  } catch {
    return { ok: false, reason: "unwritable", message: `cannot create the generated image directory ${input.directory}` };
  }
  try {
    await writeFile(target, input.bytes, { flag: "wx" });
    return { ok: true, path: target, created: true };
  } catch (error) {
    if (!isExistingFileError(error)) {
      return { ok: false, reason: "unwritable", message: `cannot create the generated image file ${target}` };
    }
  }
  try {
    const existing = await readFile(target);
    if (sha256Hex(existing) === sha256Hex(input.bytes)) return { ok: true, path: target, created: false };
  } catch {
    // Fall through to the conflict below: an unreadable pre-existing target is
    // never overwritten.
  }
  return { ok: false, reason: "generated-file-conflict",
    message: `a file already exists at the generated path ${target} and its bytes differ; refusing to overwrite` };
}

function isExistingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (error as { code?: unknown }).code === "EEXIST";
}

function normalizePathToken(value: string): string {
  return (process.platform === "win32" ? value.toLowerCase() : value).replace(/\\/g, "/");
}

const UNMATCHED_IMAGE_REFERENCE = "unmatched-image-content";

/**
 * Inspect a structured carrier input for references to the current generation's
 * raw images: canonical/requested path tokens in any string, or image-content
 * objects (by decoded bytes SHA-256 or embedded path). Results are used only to
 * deny forwarding; this function never creates a grant.
 */
export function attachmentReferencesIn(
  value: unknown,
  attachments: readonly ImageAttachment[],
  depth = 0,
): string[] {
  const found = new Set<string>();
  if (depth > 12 || value === undefined || value === null) return [];
  if (typeof value === "string") {
    const normalized = normalizePathToken(value);
    for (const attachment of attachments) {
      for (const candidate of [attachment.path, attachment.requestedPath]) {
        if (typeof candidate === "string" && candidate.length > 0
          && normalized.includes(normalizePathToken(candidate))) {
          found.add(attachment.id);
        }
      }
    }
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      for (const id of attachmentReferencesIn(entry, attachments, depth + 1)) found.add(id);
    }
    return [...found];
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "image") {
      const bytes = typeof record.data === "string" || record.data instanceof Uint8Array
        ? decodeNativeImage({ data: record.data as string | Uint8Array }) : undefined;
      const digest = bytes === undefined ? undefined : sha256Hex(bytes);
      const match = digest === undefined ? undefined
        : attachments.find((attachment) => attachment.sha256 === digest);
      if (match !== undefined) {
        found.add(match.id);
      } else {
        const pathToken = typeof record.path === "string" ? normalizePathToken(record.path) : undefined;
        const pathMatch = pathToken === undefined ? undefined : attachments.find((attachment) =>
          [attachment.path, attachment.requestedPath].some((candidate) =>
            typeof candidate === "string" && pathToken.includes(normalizePathToken(candidate))));
        found.add(pathMatch?.id ?? UNMATCHED_IMAGE_REFERENCE);
      }
    }
    for (const entry of Object.values(record)) {
      for (const id of attachmentReferencesIn(entry, attachments, depth + 1)) found.add(id);
    }
    return [...found];
  }
  return [];
}

export interface NormalizedTaskItem {
  index: number;
  /** The exact item object preflight may mutate (top-level input for the single form). */
  raw: Record<string, unknown>;
  prompt: string;
  category?: string;
  subagentType?: string;
  model?: string;
}

export type TaskBatchPlan =
  | { ok: true; form: "single" | "batch"; items: NormalizedTaskItem[] }
  | { ok: false; reason: string; message: string; item?: number };

const TASK_BATCH_LIMIT = 16;

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Normalize a native task request (single or batch) exactly the way the native
 * schema inherits it — top-level category/subagent_type/model flow into items
 * that omit them — and reject structural problems before any item is mutated.
 */
export function planNativeTaskBatch(input: unknown): TaskBatchPlan {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "batch-form", message: "the task call must be a JSON object" };
  }
  const call = input as Record<string, unknown>;
  const hasTasks = call.tasks !== undefined;
  const hasPrompt = call.prompt !== undefined;
  if (hasTasks && hasPrompt) {
    return { ok: false, reason: "batch-form",
      message: "provide exactly one of prompt or tasks; both were given" };
  }
  if (!hasTasks && !hasPrompt) {
    return { ok: false, reason: "batch-form", message: "the task call needs a prompt or a tasks array" };
  }
  const topCategory = stringField(call.category);
  const topSubagent = stringField(call.subagent_type);
  const topModel = stringField(call.model);
  const topBackground = call.run_in_background;

  const evaluate = (index: number, raw: Record<string, unknown>, promptValue: unknown,
    inherited: boolean): TaskBatchPlan | NormalizedTaskItem => {
    if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
      return { ok: false, reason: "batch-item-prompt", item: index,
        message: `item ${index} needs a nonempty prompt string` };
    }
    const category = inherited ? stringField(raw.category) : topCategory;
    const subagentType = inherited ? stringField(raw.subagent_type) : topSubagent;
    const model = inherited ? stringField(raw.model) : topModel;
    if (category !== undefined && model !== undefined) {
      return { ok: false, reason: "category-model-conflict", item: index,
        message: `item ${index} resolves to a category with a model override; category-routed tasks take their model from omo.json` };
    }
    if (category !== undefined && subagentType !== undefined) {
      return { ok: false, reason: "category-subagent-conflict", item: index,
        message: `item ${index} gives both category and subagent_type; provide exactly one` };
    }
    if (category === undefined && subagentType === undefined && model === undefined) {
      return { ok: false, reason: "missing-target", item: index,
        message: `item ${index} needs a category, subagent_type, or model target` };
    }
    if (inherited && raw.run_in_background !== undefined && raw.run_in_background !== topBackground) {
      return { ok: false, reason: "batch-item-background", item: index,
        message: `item ${index} run_in_background disagrees with the top-level value` };
    }
    return { index, raw, prompt: promptValue, ...(category !== undefined ? { category } : {}),
      ...(subagentType !== undefined ? { subagentType } : {}), ...(model !== undefined ? { model } : {}) };
  };

  if (!hasTasks) {
    const evaluated = evaluate(0, call, call.prompt, false);
    if ("ok" in evaluated) return evaluated;
    return { ok: true, form: "single", items: [evaluated] };
  }
  if (!Array.isArray(call.tasks)) {
    return { ok: false, reason: "batch-form", message: "tasks must be an array of items" };
  }
  if (call.tasks.length === 0 || call.tasks.length > TASK_BATCH_LIMIT) {
    return { ok: false, reason: "batch-size", message: `tasks must hold 1-${TASK_BATCH_LIMIT} items` };
  }
  const items: NormalizedTaskItem[] = [];
  for (let index = 0; index < call.tasks.length; index += 1) {
    const raw = call.tasks[index];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, reason: "batch-item", item: index, message: `item ${index} must be an object` };
    }
    const evaluated = evaluate(index, raw as Record<string, unknown>, (raw as Record<string, unknown>).prompt, true);
    if ("ok" in evaluated) return evaluated;
    items.push(evaluated);
  }
  return { ok: true, form: "batch", items };
}
