import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * todo-9-health anchor transform - harness-diagnostics-improve Todo 9.
 *
 * Splices the detect-only bundle health section (patches/deltas/todo-9-health.insert.js) into
 * plugin/extensions/omo-task.js *after* the slot-4 gateRepair splice and after the todo-8-quota
 * splice. The delta lands through its own authorized slot `todo-9-health` in
 * patches/installed-patches.json (Todo 3 authorized it; never inside gateRepair, never by editing
 * the installed bundle).
 *
 * Slot base: the todo-8-quota slot target (the current chain head); splice seams:
 *   - async #J spawn lease line
 *     `u=void 0===c?void 0:this.#N.register(e.parent_session_id,c);` -> admission check
 *     (insert-after, before the task-record allocation try-block)
 *   - @defs appended at the end of the bundle (ESM imports hoist) -> LoadedBundleSnapshot
 *     capture at init, drift check, lazy-target validator, guarded lazy import, admission helper,
 *     structured report writer, explicit export surface.
 *
 * beta.84 re-author (P3, st_01a0cb41): the registration manager is this.#N (was #A); the
 * allocation anchor's factory/builder helpers are Hv/nj and the task-seq allocator #M (were
 * $v/DO/#O); the quota chain anchor asserts the beta.84 quota names.
 *
 * This module only produces stage bytes. It never writes the installed bundle.
 */

const FRAGMENT_URL = new URL('../patches/deltas/todo-9-health.insert.js', import.meta.url);

export const HEALTH = {
  id: 'todo-9-health',
  todo: 9,
  package: 'omo-ai',
  relativePath: 'plugin/extensions/omo-task.js',
  baseBuild: 'todo-8-quota slot target (beta.85 stage base e8a3f30b + gateRepair rebase + Todo 6 A1 ledger + Todo 8 quota routing)',
  method: 'anchored in-package delta at the loader/admission seams plus the senpi chunk-graph identity surface: LoadedBundleSnapshot captured at module init (entries + transitively referenced chunks incl. lazy import() targets, bytes only, never imported), drift check re-hashing every member, admission-time deployment-identity check in async #J (refuse when unhealthy, unknown never healthy), import-time lazy-target validation before any import (omoBundleHealthGuardedImport), structured <stateDir>/bundle-health/last.json reports on non-healthy verdicts only. Detect-only: no repair code (Todo 10 owns reinstall + restart), no renamed-chunk planting, no eager imports. Applied by the layer, never by editing the installed bundle; never inside gateRepair.',
  methodNote: 'Todo 3 authorized this slot with the seam text "loader/admission seams plus the senpi chunk-graph identity surface". The engine exports no live chunk identity (task-1-seams.json: live-chunk-identity-export needs-upstream), so the loaded generation is captured by this delta at init as new state; the senpi exports map has no require/package.json condition, so the deployment is resolved by ancestor-node_modules probing with the package-name check, the same shape omo-ai/bin/senpi-patch.mjs uses.'
};

const BANNER_PATTERN = /^\/\/ omo:([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/;
const MARK_PREFIX = '// ==== @';
const REQUIRED_SECTIONS = ['defs', 'splice-admission'];

// Each splice: anchor text must be unique in the input body; `mode` decides how the section text
// is combined with the anchor.
const SPLICES = [
  { section: 'splice-admission', mode: 'insert-after', anchor: 'u=void 0===c?void 0:this.#N.register(e.parent_session_id,c);' }
];

// Symbols the health section introduces (they must not exist in the input body).
const HEALTH_SYMBOLS = ['omoBundleHealth', 'obhReadFileSync', 'obhReaddirSync', 'obhMkdirSync', 'obhWriteFileSync', 'obhRenameSync', 'obhRmSync', 'obhJoin', 'obhDirname', 'obhResolve', 'obhRelative', 'obhIsAbsolute', 'obhSep', 'obhCreateHash', 'obhFileURLToPath'];
// Strings that must exist in the spliced body.
const HEALTH_REQUIRED = [
  'omoBundleHealthAdmission(this.#E.store,e.parent_session_id)',
  'omoBundleHealthGate.refuse',
  'var omoBundleHealthStartup = omoBundleHealthCapture();',
  'omoBundleHealthGuardedImport',
  'omo/bundle-health/snapshot/v1',
  'omo/bundle-health/report/v1',
  'OMO_BUNDLE_HEALTH_MODE',
  '"import" === missingKind',
  'new Map()'
];
// The admission splice must keep the record-allocation try-block intact (anchor stays unique).
const ALLOCATION_ANCHOR = 'try{let r=Hv({...nj({spec:e,plan:t,name:"",executionMode:l,taskSeq:this.#M.next(e.parent_session_id)}),';
// The quota splice must still be present in the input (chain order: gateRepair -> quota -> health).
const QUOTA_ANCHOR = 'omoQuotaAdmit(this.#E.store,t,this.#O,d.task_id';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const base64url = bytes => createHash('sha256').update(bytes).digest('base64url');

export function readHealthFragment() {
  const text = readFileSync(FRAGMENT_URL, 'utf8');
  const lines = text.split('\n');
  const sections = new Map();
  let current = null;
  for (const line of lines) {
    if (line.startsWith(MARK_PREFIX)) {
      current = line.slice(MARK_PREFIX.length).trim();
      sections.set(current, []);
      continue;
    }
    if (current !== null) sections.get(current).push(line);
  }
  for (const name of REQUIRED_SECTIONS) {
    if (!sections.has(name)) throw new Error('HEALTH_FRAGMENT_SECTION_MISSING ' + name);
  }
  const out = {};
  for (const [name, body] of sections) out[name] = body.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  for (const name of REQUIRED_SECTIONS) {
    if ((out[name] ?? '').trim() === '') throw new Error('HEALTH_FRAGMENT_SECTION_EMPTY ' + name);
  }
  return { sections: out, fragmentPath: fileURLToPath(FRAGMENT_URL), fragmentSha256: digest(text) };
}

// Static imports added by the defs must be node: builtins only (no eager provider/chunk import).
// Line comments are stripped first so the documented reference shapes cannot be mistaken for code.
export function assertNoEagerImports(defs) {
  const code = defs.replace(/^\s*\/\/.*$/gm, '');
  const specifiers = [...code.matchAll(/from\s*["']([^"']+)["']/g)].map(match => match[1]);
  const foreign = specifiers.filter(specifier => !specifier.startsWith('node:'));
  if (foreign.length > 0) throw new Error('HEALTH_EAGER_FOREIGN_IMPORT ' + foreign.join(','));
  const dynamic = [...code.matchAll(/import\s*\(/g)];
  if (dynamic.length !== 1) throw new Error('HEALTH_DYNAMIC_IMPORT_COUNT ' + dynamic.length);
  const guarded = code.indexOf('omoBundleHealthGuardedImport');
  const dynamicAt = code.search(/import\s*\(/);
  if (dynamicAt < 0 || guarded < 0 || dynamicAt < guarded) throw new Error('HEALTH_DYNAMIC_IMPORT_NOT_GUARDED');
  return { staticImports: specifiers.length, foreignStaticImports: 0, dynamicImports: 1 };
}

export function applyBundleHealth(baseText, options = {}) {
  const { sections, fragmentPath, fragmentSha256 } = readHealthFragment();
  const newline = baseText.indexOf('\n');
  if (newline < 0) throw new Error('HEALTH_BANNER_MISSING');
  const banner = baseText.slice(0, newline);
  const match = BANNER_PATTERN.exec(banner);
  if (match === null) throw new Error('HEALTH_BANNER_UNSUPPORTED');
  const body = baseText.slice(newline + 1);
  const inputSha256 = digest(baseText);
  if (options.expectedBaseSha256 !== undefined && inputSha256 !== options.expectedBaseSha256) {
    throw new Error('HEALTH_BASE_HASH_MISMATCH ' + inputSha256 + ' != ' + options.expectedBaseSha256);
  }
  for (const splice of SPLICES) {
    const first = body.indexOf(splice.anchor);
    if (first < 0) throw new Error('HEALTH_ANCHOR_MISSING ' + splice.section);
    if (body.indexOf(splice.anchor, first + 1) !== -1) throw new Error('HEALTH_ANCHOR_NOT_UNIQUE ' + splice.section);
  }
  if (!body.includes(ALLOCATION_ANCHOR)) throw new Error('HEALTH_ALLOCATION_ANCHOR_MISSING');
  if (!body.includes(QUOTA_ANCHOR)) throw new Error('HEALTH_QUOTA_CHAIN_MISSING');
  for (const symbol of HEALTH_SYMBOLS) if (body.includes(symbol)) throw new Error('HEALTH_SYMBOL_COLLISION ' + symbol);
  assertNoEagerImports(sections.defs);
  let spliced = body;
  const applied = [];
  for (const splice of SPLICES) {
    const sectionText = sections[splice.section];
    const at = spliced.indexOf(splice.anchor);
    if (at < 0) throw new Error('HEALTH_ANCHOR_LOST ' + splice.section);
    const replacement = splice.mode === 'insert-after' ? splice.anchor + '\n' + sectionText : sectionText + '\n' + splice.anchor;
    spliced = spliced.slice(0, at) + replacement + spliced.slice(at + splice.anchor.length);
    applied.push({ section: splice.section, mode: splice.mode, anchor: splice.anchor, bytes: Buffer.byteLength(sectionText, 'utf8') });
  }
  const appended = spliced + (sections.defs.endsWith('\n') ? sections.defs.slice(0, -1) : sections.defs);
  for (const marker of HEALTH_REQUIRED) if (!appended.includes(marker)) throw new Error('HEALTH_REQUIRED_MISSING ' + marker);
  if (!appended.includes(ALLOCATION_ANCHOR)) throw new Error('HEALTH_ALLOCATION_ANCHOR_CHANGED');
  if (!appended.includes(QUOTA_ANCHOR)) throw new Error('HEALTH_QUOTA_CHAIN_CHANGED');
  const refreshed = '// omo:' + match[1] + ':' + base64url(Buffer.from(appended, 'utf8'));
  const text = refreshed + '\n' + appended;
  const refreshedMatch = BANNER_PATTERN.exec(refreshed);
  if (refreshedMatch === null || refreshedMatch[2] !== base64url(Buffer.from(text.slice(text.indexOf('\n') + 1), 'utf8'))) {
    throw new Error('HEALTH_BANNER_REFRESH_FAILED');
  }
  return {
    text,
    meta: {
      fragmentPath,
      fragmentSha256,
      inputSha256,
      sourceDigestPreserved: match[1],
      bodyDigestBefore: match[2],
      bodyDigestAfter: refreshedMatch[2],
      appendedBytes: Buffer.byteLength(sections.defs, 'utf8'),
      splices: applied,
      eagerImportAudit: assertNoEagerImports(sections.defs)
    }
  };
}
