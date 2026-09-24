import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * todo-7-retry anchor transform - harness-diagnostics-improve Todo 7.
 *
 * Splices the budget-governed retry admission plus trusted-loader fatal latch
 * (patches/deltas/todo-7-retry.insert.js) into plugin/extensions/omo-task.js *after* the
 * slot-4 gateRepair splice, the todo-8-quota splice and the todo-9-health splice. The delta
 * lands through its own authorized slot `todo-7-retry` in patches/installed-patches.json
 * (Todo 3 authorized it; never inside gateRepair, never by editing the installed bundle).
 *
 * Slot base: the todo-9-health slot target (the current chain tail). Splice seams (re-derived on
 * beta.84 by P3 st_01a0cb41):
 *   - the settings-builder knob construction `i={...maxRetries...baseDelayMs...}` (the EXISTING
 *     maxRetries plumbing, T:2 @392000-394400 in the pristine bundle) -> budget-sourced knobs
 *   - the `u=eY(...),p=RJ(...)` wiring binding in the component register body -> hook install
 *     (pi.on("tool_call")/("tool_result") = the engine's real tool dispatcher hooks)
 *   - the fallback-decision head `#ae(e,t)` (renamed from #te; same two-arg shape) -> trusted-loader
 *     fatal fast-fail. The beta.84 #te(e) is the spawn-failure finalizer and is not this seam.
 * The replay-guard bytes are asserted unchanged (the task pins the bytes that survived from the
 * 502652 guard to beta.84's #Z method).
 *
 * beta.85 re-derivation (todo 3, st_01a0ccb5): chain base e8a3f30b; the settings knob and the
 * `#ae(e,t)` decision-head seams are present byte-identical on the beta.85 pristine, and the
 * splice-install seam MOVES onto the new `u=eY(n),p=RJ(...)` wiring binding: the anchor is the
 * register-body wiring junction `,p=RJ({` (insert-before), so the install call lands between the
 * tracker factory and the plan resolver. The beta.84 anchor `u=eY(n,{manager:l.manager,engine:l})`
 * is re-created by the gateRepair A1 rewrite, so the moved splice composes byte-identically; the
 * junction anchor additionally survives a pristine (non-instrumented) wiring. Chain pins are
 * regenerated from the staged bytes by qa/rebuild-ledger.mjs (never hand-edited).
 *
 * This module only produces stage bytes. It never writes the installed bundle.
 */

const FRAGMENT_URL = new URL('../patches/deltas/todo-7-retry.insert.js', import.meta.url);

export const RETRY_BUDGET = {
  id: 'todo-7-retry',
  todo: 7,
  package: 'omo-ai',
  relativePath: 'plugin/extensions/omo-task.js',
  baseBuild: 'todo-9-health slot target (beta.85 stage base e8a3f30b + gateRepair rebase + Todo 6 A1 ledger + Todo 8 quota routing + Todo 9 bundle health)',
  method: 'anchored in-package delta into plugin/extensions/omo-task.js at the Todo 1 retry-plumbing seam (T:2 @392000-394400: the existing maxRetries/baseDelayMs settings builder) plus the engine tool dispatcher hooks (installed at the `,p=RJ({` wiring junction of the component register body) and the fallback-decision head (beta.85 name #ae; renamed from #te with its two-arg shape intact): budget-governed retry admission as new custom-layer state (per-operation identity = tool + canonical-args digest, maxSameFailureRetries 2 -> exactly 3 executions then one terminal retry_budget_exhausted event, maxTaskRetryAttempts 8, backoff = max(Retry-After, min(4000, 250*2^(n-1))), budgetEpoch separate from run_epoch, persistence under <stateDir>/retry-budgets/, parallel-duplicate serialization, no failure reset by unrelated success) plus the trusted-loader ENOENT fatal latch (one structured retry_fatal terminal cause, no fallback replay, no silent shell-search substitution). Applied by the layer, never by editing the installed bundle; never inside gateRepair. Design A charging rule (gate-storm fix): a task retry admission is charged against maxTaskRetryAttempts only when the operation already has failures, and an engine gate rejection carrying the bracketed [GATE] retry=(retry-after-input|never-retry) marker is classified by omoRetryIsGateRejection and never counted as a failure, never charged and never closing the identity - so repeated gate refusals and repeated successful re-reads of one identity can never storm the task budget.',
  methodNote: 'engine budget seams are ABSENT (task-1-seams.json records no per-operation retry seam and no retry-admission seam), so the budget is new custom-layer state layered over the existing maxRetries plumbing exactly as the Todo 7 authorization requires. The admission seam is the engine-documented tool_call hook contract (dist/core/extensions/runner.js emitToolCall: a handler result with block:true stops execution; agent-session.js preflightToolCall throws ExecuteToolError("blocked")), which is the only real dispatcher seam a plugin layer owns; the settings knob only reaches providers that declare no retry profile, so enforcement lives in the custom layer.',
  budget: { maxSameFailureRetries: 2, maxTaskRetryAttempts: 8, baseDelayMs: 250, perAttemptCapMs: 4000, maxExecutionsPerOperation: 3 }
};

const MARK_PREFIX = '// ==== @';
const BANNER_PATTERN = /^\/\/ omo:([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/;
const REQUIRED_SECTIONS = ['defs', 'splice-settings', 'splice-install', 'splice-te-head'];

// Each splice: anchor text must be unique in the input body; `mode` decides how the section
// text is combined with the anchor.
const SPLICES = [
  { section: 'splice-settings', mode: 'replace', anchor: 'i={...void 0===n?.maxRetries?{}:{maxRetries:n.maxRetries},...void 0===n?.baseDelayMs?{}:{baseDelayMs:n.baseDelayMs}}' },
  { section: 'splice-install', mode: 'insert-before', anchor: ',p=RJ({' },
  { section: 'splice-te-head', mode: 'replace', anchor: '#ae(e,t){if(!UR.is(t)||"model_unavailable"!==t.failure.kind)return;' }
];

// Symbols the retry policy introduces (they must not exist in the input body).
const RETRY_SYMBOLS = ['omoRetry', 'ogQExistsSync2', 'ogQWriteFileSync2', 'ogQMkdirSync2', 'ogQRenameSync2', 'ogQRmSync2', 'ogQReadFileSync2', 'ogQJoin2', 'ogQDirname2', 'ogQCreateHash2'];
// Strings that must exist in the spliced body.
const RETRY_REQUIRED = [
  'i=omoRetryEngineRetryKnobs(n)',
  'omoRetryInstalled=omoRetryInstall(n,{engine:l})',
  'omoRetryLaunchFatal(this.#E.store,e.record,t)',
  'omoRetryToolCall(omoRetryState, omoRetryHookOptions(omoRetryEvent))',
  'omoRetryToolResult(omoRetryState, omoRetryHookOptions(omoRetryEvent))',
  'senpi-task/retry-budget/v1',
  'trusted_loader_enoent',
  'retry_budget_exhausted',
  'retry_fatal',
  'substitution: "refused"',
  'maxSameFailureRetries: 2, maxTaskRetryAttempts: 8, baseDelayMs: 250, perAttemptCapMs: 4000',
  'if (omoRetryOp.failures > 0) { omoRetryTask.taskRetryAttempts += 1; }',
  'omoRetryIsGateRejection',
  '{ block: true, reason: omoRetryBlockReason("retry_budget_exhausted"'
];
// The #K guard expression must stay byte-identical: the replay guard is preserved, never edited.
const REPLAY_GUARD = 'if(this.workpools.ownsTask(e.taskId))return!1;if("error"!==e.outcome.status||!0===e.outcome.killed||"child-turn-failed"!==e.outcome.failure.kind&&"child-prompt-failed"!==e.outcome.failure.kind||(e.runStats?.tool_calls??0)>0)return!1;';
// The replaced fallback-decision head must keep its original decision verbatim inside the payload.
const TE_DECISION = 'if(!UR.is(t)||"model_unavailable"!==t.failure.kind)return;';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const base64url = bytes => createHash('sha256').update(bytes).digest('base64url');

export function readRetryFragment() {
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
    if (!sections.has(name)) throw new Error('RETRY_FRAGMENT_SECTION_MISSING ' + name);
  }
  const out = {};
  for (const [name, body] of sections) out[name] = body.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  for (const name of REQUIRED_SECTIONS) {
    if ((out[name] ?? '').trim() === '') throw new Error('RETRY_FRAGMENT_SECTION_EMPTY ' + name);
  }
  return { sections: out, fragmentPath: fileURLToPath(FRAGMENT_URL), fragmentSha256: digest(text) };
}

export function applyRetryBudget(baseText, options = {}) {
  const { sections, fragmentPath, fragmentSha256 } = readRetryFragment();
  const newline = baseText.indexOf('\n');
  if (newline < 0) throw new Error('RETRY_BANNER_MISSING');
  const banner = baseText.slice(0, newline);
  const match = BANNER_PATTERN.exec(banner);
  if (match === null) throw new Error('RETRY_BANNER_UNSUPPORTED');
  const body = baseText.slice(newline + 1);
  const inputSha256 = digest(baseText);
  if (options.expectedBaseSha256 !== undefined && inputSha256 !== options.expectedBaseSha256) {
    throw new Error('RETRY_BASE_HASH_MISMATCH ' + inputSha256 + ' != ' + options.expectedBaseSha256);
  }
  for (const splice of SPLICES) {
    const first = body.indexOf(splice.anchor);
    if (first < 0) throw new Error('RETRY_ANCHOR_MISSING ' + splice.section);
    if (body.indexOf(splice.anchor, first + 1) !== -1) throw new Error('RETRY_ANCHOR_NOT_UNIQUE ' + splice.section);
  }
  if (!body.includes(REPLAY_GUARD)) throw new Error('RETRY_REPLAY_GUARD_MISSING');
  for (const symbol of RETRY_SYMBOLS) if (body.includes(symbol)) throw new Error('RETRY_SYMBOL_COLLISION ' + symbol);
  // Section payload sanity: each payload must be a real transform of its anchor.
  if (!sections['splice-settings'].startsWith('i=omoRetryEngineRetryKnobs(')) throw new Error('RETRY_SETTINGS_PAYLOAD_SHAPE');
  if (!sections['splice-install'].startsWith(',omoRetryInstalled=omoRetryInstall(')) throw new Error('RETRY_INSTALL_PAYLOAD_SHAPE');
  if (!sections['splice-te-head'].includes(TE_DECISION)) throw new Error('RETRY_TE_DECISION_NOT_PRESERVED');
  if (sections['splice-te-head'] === SPLICES[2].anchor) throw new Error('RETRY_SECTION_NOT_A_REPLACEMENT splice-te-head');
  let spliced = body;
  const applied = [];
  for (const splice of SPLICES) {
    const sectionText = sections[splice.section];
    let replacement;
    if (splice.mode === 'replace') replacement = sectionText;
    else if (splice.mode === 'append') replacement = splice.anchor + sectionText;
    else if (splice.mode === 'insert-before') replacement = sectionText + splice.anchor;
    else throw new Error('RETRY_SPLICE_MODE ' + splice.mode);
    if (splice.mode === 'replace' && sectionText === splice.anchor) throw new Error('RETRY_SECTION_NOT_A_REPLACEMENT ' + splice.section);
    const at = spliced.indexOf(splice.anchor);
    if (at < 0) throw new Error('RETRY_ANCHOR_LOST ' + splice.section);
    spliced = spliced.slice(0, at) + replacement + spliced.slice(at + splice.anchor.length);
    applied.push({ section: splice.section, mode: splice.mode, anchor: splice.anchor, bytes: Buffer.byteLength(replacement, 'utf8') });
  }
  const appended = spliced + (sections.defs.endsWith('\n') ? sections.defs.slice(0, -1) : sections.defs);
  for (const marker of RETRY_REQUIRED) if (!appended.includes(marker)) throw new Error('RETRY_REQUIRED_MISSING ' + marker);
  if (!appended.includes(REPLAY_GUARD)) throw new Error('RETRY_REPLAY_GUARD_CHANGED');
  const refreshed = '// omo:' + match[1] + ':' + base64url(Buffer.from(appended, 'utf8'));
  const text = refreshed + '\n' + appended;
  const refreshedMatch = BANNER_PATTERN.exec(refreshed);
  if (refreshedMatch === null || refreshedMatch[2] !== base64url(Buffer.from(text.slice(text.indexOf('\n') + 1), 'utf8'))) {
    throw new Error('RETRY_BANNER_REFRESH_FAILED');
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
      replayGuardPreservedSha256: digest(REPLAY_GUARD),
      budget: RETRY_BUDGET.budget
    }
  };
}
