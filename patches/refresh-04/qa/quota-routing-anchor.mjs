import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * todo-8-quota anchor transform - harness-diagnostics-improve Todo 8.
 *
 * Splices the hard-cap quota routing policy + observability (patches/deltas/todo-8-quota.insert.js)
 * into plugin/extensions/omo-task.js *after* the slot-4 gateRepair splice. The delta lands through
 * its own authorized slot `todo-8-quota` in patches/installed-patches.json (Todo 3 authorized it;
 * never inside gateRepair, never by editing the installed bundle).
 *
 * Slot base: the gateRepair slot target (beta.84 base 8ec571ac + Todo 3 gate repair
 * + Todo 6 A1 plan-touch ledger). Splice seams (task-1-seams.json anchors, re-derived on
 * beta.84 by P3 st_01a0cb41):
 *   - spawn admission call `g=wj(...)` in async #J   -> quota admission wrapper + terminal no-route
 *   - the `let p,f,m,h=...` line right before it       -> async shared-probe barrier
 *   - async #Z guard tail (replay guard untouched)    -> runtime quota observation + chain prune
 *   - RP normalized-event append                      -> quota event observation
 *
 * This module only produces stage bytes. It never writes the installed bundle.
 */

const FRAGMENT_URL = new URL('../patches/deltas/todo-8-quota.insert.js', import.meta.url);

export const QUOTA = {
  id: 'todo-8-quota',
  todo: 8,
  package: 'omo-ai',
  relativePath: 'plugin/extensions/omo-task.js',
  baseBuild: 'gateRepair slot target (beta.85 stage base e8a3f30b + gateRepair rebase + Todo 6 A1 ledger)',
  method: 'anchored in-package delta into plugin/extensions/omo-task.js at the Todo 1 fallback/retry seams (T:2 admission wj @468197/@490362, #Z guard @502452-502645, event observer RP/OP @480905-481941 on the beta.81 map; re-anchored on the beta.84 base by P3 st_01a0cb41): quota policy freeze, strict structured 402+insufficient_quota classification, per-key exhaustion persisted under <stateDir>/quota-routing/keys.json, approved-capable-unvisited fallback selection with the existing workpool lane lease as reservation, one shared probe per unknown key, and observability events. Applied by the layer, never by editing the installed bundle; never inside gateRepair.',
  methodNote: 'Todo 3 pre-authorized this slot with a method text copied from the Todo 6 gate/resolver seams (vu 177000-178561, jg 261419+); quota routing has no gate/resolver seam, so the method recorded here is the corrected seam set and the correction is recorded as a ledger decision (quota-slot-method-correction).'
};

const MARK_PREFIX = '// ==== @';
const BANNER_PATTERN = /^\/\/ omo:([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/;
const REQUIRED_SECTIONS = ['defs', 'splice-spawn-barrier', 'splice-spawn-admit', 'splice-k-prune', 'splice-rp-observe'];

// Each splice: anchor text must be unique in the input body; `mode` decides how the section
// text is combined with the anchor.
const SPLICES = [
  { section: 'splice-spawn-barrier', mode: 'insert-before', anchor: 'let p,f,m,h=u??this.#N.register(e.parent_session_id,void 0,d.task_id),' },
  { section: 'splice-spawn-admit', mode: 'replace', anchor: 'g=wj(t,this.#O,d.task_id,d.notification.run_epoch),{plan:v,lease:y}=g;' },
  { section: 'splice-k-prune', mode: 'insert-before', anchor: 'let t=this.#W(e.taskId),n=t?.fallback_models?.[0],r=this.#R.get(e.taskId);' },
  { section: 'splice-rp-observe', mode: 'replace', anchor: 'void 0!==r&&e.appendEvent(t,r)}' }
];

// Symbols the quota policy introduces (they must not exist in the input body).
const QUOTA_SYMBOLS = ['omoQuota', 'oqReadFileSync', 'oqWriteFileSync', 'oqMkdirSync', 'oqRenameSync', 'oqRmSync', 'oqStatSync', 'oqJoin', 'oqDirname', 'oqCreateHash'];
// Strings that must exist in the spliced body.
const QUOTA_REQUIRED = [
  'omoQuotaAdmissionBarrier(this.#E.store,t,d.task_id)',
  'omoQuotaAdmit(this.#E.store,t,this.#O,d.task_id,d.notification.run_epoch)',
  'omoQuotaNoRouteResult(this.#E.store,{taskId:d.task_id',
  'omoQuotaObserveRuntimeFailure(this.#E.store,this.#W(e.taskId),e.outcome?.failure)',
  'omoQuotaObserveEvent(e,t,n,r)',
  'omo/quota-routing/keys/v1',
  '"insufficient_quota" === code'
];
// The #K guard expression must stay byte-identical: the replay guard is preserved, never edited.
const K_GUARD = 'if(this.workpools.ownsTask(e.taskId))return!1;if("error"!==e.outcome.status||!0===e.outcome.killed||"child-turn-failed"!==e.outcome.failure.kind&&"child-prompt-failed"!==e.outcome.failure.kind||(e.runStats?.tool_calls??0)>0)return!1;';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const base64url = bytes => createHash('sha256').update(bytes).digest('base64url');

export function readQuotaFragment() {
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
    if (!sections.has(name)) throw new Error('QUOTA_FRAGMENT_SECTION_MISSING ' + name);
  }
  const out = {};
  for (const [name, body] of sections) out[name] = body.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  for (const name of REQUIRED_SECTIONS) {
    if ((out[name] ?? '').trim() === '') throw new Error('QUOTA_FRAGMENT_SECTION_EMPTY ' + name);
  }
  return { sections: out, fragmentPath: fileURLToPath(FRAGMENT_URL), fragmentSha256: digest(text) };
}

export function applyQuotaRouting(baseText, options = {}) {
  const { sections, fragmentPath, fragmentSha256 } = readQuotaFragment();
  const newline = baseText.indexOf('\n');
  if (newline < 0) throw new Error('QUOTA_BANNER_MISSING');
  const banner = baseText.slice(0, newline);
  const match = BANNER_PATTERN.exec(banner);
  if (match === null) throw new Error('QUOTA_BANNER_UNSUPPORTED');
  const body = baseText.slice(newline + 1);
  const inputSha256 = digest(baseText);
  if (options.expectedBaseSha256 !== undefined && inputSha256 !== options.expectedBaseSha256) {
    throw new Error('QUOTA_BASE_HASH_MISMATCH ' + inputSha256 + ' != ' + options.expectedBaseSha256);
  }
  for (const splice of SPLICES) {
    const first = body.indexOf(splice.anchor);
    if (first < 0) throw new Error('QUOTA_ANCHOR_MISSING ' + splice.section);
    if (body.indexOf(splice.anchor, first + 1) !== -1) throw new Error('QUOTA_ANCHOR_NOT_UNIQUE ' + splice.section);
  }
  if (!body.includes(K_GUARD)) throw new Error('QUOTA_K_GUARD_MISSING');
  for (const symbol of QUOTA_SYMBOLS) if (body.includes(symbol)) throw new Error('QUOTA_SYMBOL_COLLISION ' + symbol);
  let spliced = body;
  const applied = [];
  for (const splice of SPLICES) {
    const sectionText = sections[splice.section];
    const replacement = splice.mode === 'replace' ? sectionText : sectionText + '\n' + splice.anchor;
    if (splice.mode === 'replace' && sectionText === splice.anchor) throw new Error('QUOTA_SECTION_NOT_A_REPLACEMENT ' + splice.section);
    const at = spliced.indexOf(splice.anchor);
    if (at < 0) throw new Error('QUOTA_ANCHOR_LOST ' + splice.section);
    spliced = spliced.slice(0, at) + replacement + spliced.slice(at + splice.anchor.length);
    applied.push({ section: splice.section, mode: splice.mode, anchor: splice.anchor, bytes: Buffer.byteLength(replacement, 'utf8') });
  }
  const appended = spliced + (sections.defs.endsWith('\n') ? sections.defs.slice(0, -1) : sections.defs);
  for (const marker of QUOTA_REQUIRED) if (!appended.includes(marker)) throw new Error('QUOTA_REQUIRED_MISSING ' + marker);
  if (!appended.includes(K_GUARD)) throw new Error('QUOTA_K_GUARD_CHANGED');
  const guardAt = baseText.indexOf(K_GUARD);
  if (guardAt < 0) throw new Error('QUOTA_K_GUARD_MISSING_INPUT');
  const refreshed = '// omo:' + match[1] + ':' + base64url(Buffer.from(appended, 'utf8'));
  const text = refreshed + '\n' + appended;
  const refreshedMatch = BANNER_PATTERN.exec(refreshed);
  if (refreshedMatch === null || refreshedMatch[2] !== base64url(Buffer.from(text.slice(text.indexOf('\n') + 1), 'utf8'))) {
    throw new Error('QUOTA_BANNER_REFRESH_FAILED');
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
      kGuardPreservedSha256: digest(K_GUARD)
    }
  };
}
