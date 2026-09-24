export function normalize(v: string): string;
export function hasKimiK3(v: string): boolean;
export function hasDeepseekV4Flash0731(v: string): boolean;
export function hasDeepseekV4Flash(v: string): boolean;
export function hasDeepseekV4Pro(v: string): boolean;
export const KIMI_K3_SIGNATURE: string;
export const DEEPSEEK_FLASH_SIGNATURE: string;
export const DEEPSEEK_PRO_SIGNATURE: string;
// Optional fields accept explicit undefined (runtime reads them via ?. and
// typeof filters); required by exactOptionalPropertyTypes at strict call sites.
export function resolveCorrectionPreset(target: {
  id?: string | undefined;
  name?: string | undefined;
  systemPrompt?: string | undefined;
}): string | null;
export function resolvePresetMatch(target: { id?: string | undefined; name?: string | undefined }): string | null;
export const CORRECTION_START_MARKER: string;
export const CORRECTION_END_MARKER: string;
export interface CorrectionRule {
  id: string;
  concern: string;
  presets: string[];
  requires: string[];
  directive: string;
}
export const CORRECTION_RULES: CorrectionRule[];
export function familyOfPreset(preset: string): string | null;
export function stripCorrectionBlocks(input: string): string;
export function applyCorrection(
  basePrompt: string,
  preset: string | null,
  capabilities: Iterable<string>,
): string;
