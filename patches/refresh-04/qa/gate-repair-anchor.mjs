import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Slot-4 gateRepair anchor transform.
 *
 * Rebases the recorded st_01a0887d gate repair (already-user-authorized; see
 * .omo/plans/harness-diagnostics-improve.md Todo 3 and .omo/HANDOFF-plan-gate-fix.md section 4)
 * onto the on-disk beta.84 plugin/extensions/omo-task.js body. The recorded beta.51 pair
 * (49aee3a4... -> f9ea72d4...) is two different builds of the same source after the repair,
 * not a diffable patch (common prefix 7 bytes, common suffix 24 bytes), so the rebase is
 * expressed as the prepared anchored splice in patches/deltas/slot-4-gateRepair.insert.js:
 * the repair semantics come from the st_01a0887d working tree's `git diff` of
 * skill-invocation-tracker.ts plus the untracked requested-plan-adoption.ts it calls, and the
 * built reference block from that tree's omo-task.js (f9ea72d4...).
 *
 * beta.84 re-author (P3, st_01a0cb41): base pin 8ec571ac; tracker factory mK->eY, tracker
 * wiring u=eY(n),p=RJ({, handler locals `let a=i.text,s=nY(r);` (text a, session s) and the
 * session-id extractor hK->nY. The adopted-plan touch derives its sequence from the session
 * touch map instead of the shadowed handler-local `i` (see the fragment header).
 *
 * beta.88 re-anchor (todo 3, st_01a0cfd3): base pin 77b6747d (the staged base under
 * .omo/ulw/build/stage-beta88, per task-2 STAGE.json). The +104 B beta.85 delta is the model catalog plus the banner,
 * so every recorded splice anchor and body pattern below is present byte-identical on the
 * beta.85 base and the anchor set stands unchanged; the chain pins are regenerated from these
 * staged bytes by qa/rebuild-ledger.mjs (never hand-edited).
 *
 * st_01a0d1c4 input-source fix: the engine's InputSource union is interactive|rpc|extension
 * (interactive is the host default on every send path; rpc is the RPC client's user path), so the
 * re-authored `if("user"!==i.source)return;` guard never matched a real user event and left the
 * whole spliced block inert for genuine requests. The recorded repair's semantics (reject only
 * "extension" - the programmatic-injection source; an absent source means a plain host that only
 * delivers user input) are already enforced by the base immediately before this seam, so the
 * splice adds no guard of its own and the anchor asserts that upstream guard sits right at the
 * seam before patching.
 *
 * This module only produces stage bytes. It never writes the installed bundle.
 */

const FRAGMENT_URL = new URL('../patches/deltas/slot-4-gateRepair.insert.js', import.meta.url);

export const GATE_REPAIR = {
  id: 'slot-4-gateRepair',
  todo: 3,
  package: 'omo-ai',
  relativePath: 'plugin/extensions/omo-task.js',
  baseSha256: '77b6747d35aa92e8618e4fe011dac36eddbfd4fe6edfbb2ad39ceb0639f63562',
  baseBuild: 'omo-ai 5.0.0-0.beta.88 (staged base under .omo/ulw/build/stage-beta88, byte-equal to its pristine copy per task-2 STAGE.json)',
  method: 'anchored in-package splice at the recorded beta.51 repair seams, re-expressed for the beta.84 plan-touch tracker (eY); applied by the layer, never by editing the installed bundle. Todo 6 extends the same slot with the A1 plan-touch ledger plus descendant-union artifact view (new persisted state, no consumer change, no resolver change). The task-6b rework closes both engine-boundary gaps without new engine hooks: child touches are captured from the task engine child stream (engine.onStoreMutation fires at child-record save, manager.subscribeChild taps the live child handle, and the child tool_execution_start/end pair is filtered with the same read/write/edit/apply_patch rule and isError rule as the extension recorder), and process-mode records recover their missing child_session_id from the engine child session directory before the descendant fixpoint.',
  references: [
    { role: 'repair-source-diff', path: 'C:/Users/USER/tmp/piomo-plan-gate-st01a0887d/packages/omo-senpi/src/components/task/skill-invocation-tracker.ts', sha256: '1aca980054ec3154f0927487fedead23ae8f8aeab6cfd12520ed1007258d2810' },
    { role: 'repair-source-new-file', path: 'C:/Users/USER/tmp/piomo-plan-gate-st01a0887d/packages/omo-senpi/src/components/task/requested-plan-adoption.ts', sha256: '4220f9de150459fd110b83049eafdcbdbe73f2869659e5b2c3f84796e8c6029b' },
    { role: 'repair-built-reference', path: 'C:/Users/USER/tmp/piomo-plan-gate-st01a0887d/packages/omo-senpi/plugin/extensions/omo-task.js', sha256: 'f9ea72d46c1393fd3c383d2d6646d036a1aeac8454f87c794c13f7c233c4aef2' },
    { role: 'repair-e2e-script', path: 'C:/Users/USER/tmp/piomo-plan-gate-st01a0887d/packages/omo-senpi/scripts/qa/existing-plan-gate-e2e.mjs', sha256: '97ddecdbd098cd20efc4f01c03f6f0362306b4e6be2d597d8d9e94fa0601432e' },
    { role: 'strip-quoted-regions-source', path: 'C:/Users/USER/tmp/piomo-plan-gate-st01a0887d/packages/omo-senpi/src/components/skill-pointers/strip-quoted-regions.ts', sha256: '411a7e7339520a678786bd8122983ebd3b7c1c2e6ec6add90100483cd57153d3' },
    { role: 'beta51-repair-built', path: 'C:/Users/USER/orca/projects/기타 작업/.omo/tmp/rebase-beta81/old-target-omo-task.js', sha256: 'f9ea72d46c1393fd3c383d2d6646d036a1aeac8454f87c794c13f7c233c4aef2' },
    { role: 'beta51-upstream', path: 'C:/Users/USER/orca/projects/기타 작업/.omo/tmp/rebase-beta81/old-base-omo-task.js', sha256: '49aee3a42dc390e2fe44144aee6ac2b6b9774490b6320ee7b22243a597c1aeab' }
  ]
};

export const BANNER_PATTERN = /^\/\/ omo:([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/;
const MARK_BLOCK = '// ==== @insert-block\n';
const MARK_DEFS = '// ==== @append-defs\n';
const ANCHOR_MK = 'function eY(e){let ';
const MK_A1_HEAD = 'function eY(e,omoA1Ctx){let omoGateRepairPi=e,omoA1State=omoA1CreateState(omoA1Ctx),';
const ANCHOR_HANDLER = 'let a=i.text,s=nY(r);';
// The upstream guard the recorded repair ports (AGENT_MANUFACTURABLE_INPUT_SOURCE): the base already
// rejects programmatic extension input immediately before the handler anchor, so the spliced block
// runs for interactive/rpc/absent sources only. The splice must never add a source guard of its own.
const UPSTREAM_INPUT_GUARD = 'if("extension"===i.source)return;';
const ANCHOR_WIRING = 'u=eY(n),p=RJ({';
const WIRING_A1 = 'u=eY(n,{manager:l.manager,engine:l}),p=RJ({';
const ANCHOR_STATEFOR = '{stateFor:e=>({hasInvoked:n=>t.get(e)?.has(n)??!1,hasUserRequested:t=>n.get(e)?.has(t)??!1,hasPlanArtifact:()=>(r.get(e)?.size??0)>0,planArtifactReferences:()=>{let t=r.get(e);return void 0===t?[]:[...t.entries()].map(([e,t])=>({path:e,count:t.count,lastTouchedAt:t.lastTouchedAt})).sort((e,t)=>t.count-e.count||t.lastTouchedAt-e.lastTouchedAt)}})}';
const STATEFOR_A1 = '{stateFor:e=>{let omoA1Cache;const omoA1Merged=()=>{if(void 0===omoA1Cache)omoA1Cache=omoA1ArtifactEntries(omoA1State,e,r);return omoA1Cache};return{hasInvoked:n=>"ulw-execute"===n?omoGateRepairExecuteBlocked(omoA1State,e):!!t.get(e)?.has(n),hasUserRequested:t=>"ulw-plan"===t?!!omoGateRepairRead(omoA1State,e)?.requestAtMs:!!n.get(e)?.has(t),hasPlanArtifact:()=>omoA1Merged().length>0,planArtifactReferences:()=>omoA1Merged()}}}';
// Execute-read persistence belongs exclusively to the staged final-effect lifecycle.
// The native tool_result tracker remains an artifact/in-memory observer, never an epoch owner.
const ANCHOR_SKILL_RETURN = 'return o(t,s,r),void o(n,s,r)';
const SKILL_RETURN = 'return o(t,s,r),o(n,s,r),void omoGateRepairSave(omoA1State,s,n.get(s)?.has("ulw-plan")??!1,t.get(s)?.has("ulw-execute")??!1)';
const ANCHOR_INPUT_END = '&&o(n,s,"ulw-plan")}),e.on("session_shutdown"';
const INPUT_END = '&&o(n,s,"ulw-plan"),omoGateRepairSave(omoA1State,s,n.get(s)?.has("ulw-plan")??!1,t.get(s)?.has("ulw-execute")??!1)}),e.on("session_shutdown"';
const ANCHOR_SHUTDOWN = ',e.on("session_shutdown",(e,i)=>{let o=nY(i);void 0!==o&&(t.delete(o),n.delete(o),r.delete(o))})';
const SHUTDOWN_A1 = ',e.on("input_disposition",(e,t)=>omoGateRepairDisposition(omoA1State,nY(t),e)),omoA1Listen(e,omoA1State,r)' + ANCHOR_SHUTDOWN;
// Symbols the A1 ledger section introduces (they must not exist in the base body).
const A1_SYMBOLS = ['omoA1', 'ogRMkdirSync', 'ogRWriteFileSync', 'ogRRenameSync', 'ogRRmSync', 'ogRDirname', 'ogRCreateHash'];
// Strings that must exist in the spliced body.
const A1_REQUIRED = ['omoA1CreateState(omoA1Ctx)', 'omoA1ArtifactEntries(omoA1State,e,r)', 'omoA1Listen(e,omoA1State,r)', 'u=eY(n,{manager:l.manager,engine:l})', 'plan-touches', 'pi.on("tool_effect_before"', 'pi.on("tool_effect_settled"'];
// Regex literals that the fragment's strip arrays must match byte-for-byte in the beta.84 body.
const BODY_PATTERNS = [
  '/<skill\\s+name="([^"]+)"/gi',
  '/<ultrawork-mode>[\\s\\S]*?<\\/ultrawork-mode>/gi',
  '/<system-reminder>[\\s\\S]*?<\\/system-reminder>/gi',
  '/<skill\\s+name="[^"]*"[\\s\\S]*?<\\/skill>/gi',
  '/<skill\\s+name="[^"]*"[\\s\\S]*$/i'
];

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const base64url = bytes => createHash('sha256').update(bytes).digest('base64url');

export function readGateRepairFragment() {
  const text = readFileSync(FRAGMENT_URL, 'utf8');
  const bi = text.indexOf(MARK_BLOCK);
  const di = text.indexOf(MARK_DEFS);
  if (bi < 0 || di < 0 || di < bi) throw new Error('GATE_REPAIR_FRAGMENT_MALFORMED');
  const block = text.slice(bi + MARK_BLOCK.length, di);
  const defs = text.slice(di + MARK_DEFS.length);
  if (block.trim() === '' || defs.trim() === '') throw new Error('GATE_REPAIR_FRAGMENT_EMPTY');
  return { block, defs, fragmentPath: fileURLToPath(FRAGMENT_URL), fragmentSha256: digest(text) };
}

export function applyGateRepair(baseText) {
  const { block, defs, fragmentPath, fragmentSha256 } = readGateRepairFragment();
  const newline = baseText.indexOf('\n');
  if (newline < 0) throw new Error('GATE_REPAIR_BANNER_MISSING');
  const banner = baseText.slice(0, newline);
  const match = BANNER_PATTERN.exec(banner);
  if (match === null) throw new Error('GATE_REPAIR_BANNER_UNSUPPORTED');
  const body = baseText.slice(newline + 1);
  if (digest(baseText) !== GATE_REPAIR.baseSha256) throw new Error('GATE_REPAIR_BASE_HASH_MISMATCH');
  for (const [name, anchor] of [['eY', ANCHOR_MK], ['handler', ANCHOR_HANDLER], ['wiring', ANCHOR_WIRING], ['stateFor', ANCHOR_STATEFOR], ['shutdown', ANCHOR_SHUTDOWN], ['skill-return', ANCHOR_SKILL_RETURN], ['input-end', ANCHOR_INPUT_END]]) {
    const first = body.indexOf(anchor);
    if (first < 0 || body.indexOf(anchor, first + 1) !== -1) throw new Error('GATE_REPAIR_ANCHOR_NOT_UNIQUE_' + name);
  }
  for (const symbol of [...A1_SYMBOLS, 'omoGateRepair']) if (body.includes(symbol)) throw new Error('GATE_REPAIR_SYMBOL_COLLISION ' + symbol);
  if (!body.slice(0, body.indexOf(ANCHOR_HANDLER)).endsWith(UPSTREAM_INPUT_GUARD)) throw new Error('GATE_REPAIR_INPUT_SOURCE_GUARD_MISSING');
  for (const pattern of BODY_PATTERNS) if (!body.includes(pattern)) throw new Error('GATE_REPAIR_BODY_PATTERN_MISSING ' + pattern);
  const patched = body
    .replace(ANCHOR_MK, MK_A1_HEAD)
    .replace(ANCHOR_HANDLER, ANCHOR_HANDLER + block)
    .replace(ANCHOR_WIRING, WIRING_A1)
    .replace(ANCHOR_STATEFOR, STATEFOR_A1)
    .replace(ANCHOR_SKILL_RETURN, SKILL_RETURN)
    .replace(ANCHOR_INPUT_END, INPUT_END)
    .replace(ANCHOR_SHUTDOWN, SHUTDOWN_A1);
  const appended = patched + (defs.endsWith('\n') ? defs.slice(0, -1) : defs);
  if (!appended.includes('omo.plan-review-adoption')) throw new Error('GATE_REPAIR_INSERT_MISSING');
  for (const marker of A1_REQUIRED) if (!appended.includes(marker)) throw new Error('GATE_REPAIR_A1_MISSING ' + marker);
  const refreshed = '// omo:' + match[1] + ':' + base64url(Buffer.from(appended, 'utf8'));
  const text = refreshed + '\n' + appended;
  const refreshedMatch = BANNER_PATTERN.exec(refreshed);
  if (refreshedMatch === null || refreshedMatch[2] !== base64url(Buffer.from(text.slice(text.indexOf('\n') + 1), 'utf8'))) {
    throw new Error('GATE_REPAIR_BANNER_REFRESH_FAILED');
  }
  return {
    text,
    meta: {
      fragmentPath,
      fragmentSha256,
      sourceDigestPreserved: match[1],
      bodyDigestBefore: match[2],
      bodyDigestAfter: refreshedMatch[2],
      blockBytes: Buffer.byteLength(block, 'utf8'),
      appendBytes: Buffer.byteLength(defs, 'utf8'),
      insertedAfter: ANCHOR_HANDLER,
      inputSourceGuard: UPSTREAM_INPUT_GUARD + ' enforced by the base immediately before the seam; the splice adds no guard, so interactive/rpc/absent sources stay genuine user input',
      capturedPi: 'omoGateRepairPi',
      journalCallInertOnBeta84: true
    }
  };
}
