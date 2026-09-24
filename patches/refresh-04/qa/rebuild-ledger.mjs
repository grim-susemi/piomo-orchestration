// rebuild-ledger.mjs — beta.88 lane re-author (plan .omo/plans/omo-beta88-install.md todo 3, task st_01a0cfd3)
//
// Lane re-author of the canonical qa/rebuild-ledger.mjs (banked sha256 98f6aad17d39a343d2e9a5fd89696ad50d710d7d880920f53a32cb5af4c1328f;
// the canonical repo file is NOT touched by this task — it stays byte-identical to its banked sha).
// This lane copy is materialized under .omo/ulw/build/stage-beta88/target/lane/qa/ so that every
// write this run performs stays inside the task's sanctioned roots:
//   - .omo/ulw/build/stage-beta88/target/**   (chain outputs, lane toolchain, lane ledger artifacts)
//   - .omo/evidence/beta88-install/task-3/**  (pins.json, this run's evidence)
// The write surface is enforced in-process (see W()); there is no repo/patches write, no stage base
// rewrite, no live read-as-provenance, no stage-beta85/86 write.
//
// What it does (the M3 re-pin the beta86 lane deferred, executed on the staged-88 base 77b6747d…3562):
//   1. version guard on the staged pristine root (VERSION_DRIFT before ANY write; OMO_REBUILD_PRISTINE
//      is the drift-probe seam and points this guard at another tree, e.g. the live beta.85 install);
//   2. staged-base identity cross-check against stage-beta88/STAGE.json (task-2 record);
//   3. re-derivation of the four transforms (gateRepair -> todo-8-quota -> todo-9-health -> todo-7-retry)
//      via the lane copies of the qa anchor scripts (gate-repair-anchor re-pinned to the staged-88 base);
//   4. chain-pin regeneration: pins.json is written from the observed digests on first run; on every
//      later run it is validated against the re-derived chain (never hand-edited, never carried over);
//   5. materialization of stage target/omo-ai + target/intermediates + target/base (real copies, no
//      symlinks) and the lane ledger/lock/diffs under target/ledger/;
//   6. landing syntax gate (node --check on the chain-tail bytes) and semantic diff assertions.
//
// senpi: NOT staged on this lane (task-2 decision; senpi engine staging is the later senpi lane).
// The 88-declared dep is read from the staged package.json and recorded; no senpi tree is
// materialized and the two senpi retired-pair bases are deferred to the senpi staging lane.
// Legacy-1 (directive.md) stays capture-only and is out of this lane's scope (captures live on the
// beta.86 lane; reading beta.86 is allowed but this lane records it as deferred rather than copying).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dirname, resolve, basename, posix, sep } from 'node:path';
import { applyGateRepair, GATE_REPAIR } from './gate-repair-anchor.mjs';
import { applyQuotaRouting, QUOTA } from './quota-routing-anchor.mjs';
import { applyBundleHealth, HEALTH } from './bundle-health-anchor.mjs';
import { applyRetryBudget, RETRY_BUDGET } from './retry-budget-anchor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// walk up to the project root (.omo/ulw/build exists there)
let X = HERE;
for (let i = 0; i < 12 && !existsSync(posix.join(X, '.omo/ulw/build')); i += 1) X = resolve(X, '..');
if (!existsSync(posix.join(X, '.omo/ulw/build'))) throw new Error('PROJECT_ROOT_NOT_FOUND from ' + HERE);

const STAGE = resolve(X, '.omo/ulw/build/stage-beta88');
const TARGET = resolve(STAGE, 'target');
const LANE = resolve(TARGET, 'lane');
// Candidate authoring may isolate newly generated pins without rewriting historical evidence.
// --reuse-base verifies the full existing target/base tree and never writes it.
const { values: args } = parseArgs({ options: { 'evidence-dir': { type: 'string' }, 'reuse-base': { type: 'boolean', default: false } } });
const EVIDENCE_ROOT = resolve(X, '.omo/evidence/beta88-install');
const EVIDENCE_DIR = args['evidence-dir'] ? resolve(args['evidence-dir']) : resolve(EVIDENCE_ROOT, 'task-3');
if (!EVIDENCE_DIR.startsWith(EVIDENCE_ROOT + sep)) throw new Error('EVIDENCE_PATH_OUTSIDE_BETA88 ' + EVIDENCE_DIR);
const EVIDENCE = resolve(EVIDENCE_DIR, 'rebuild-ledger.json');
const PINS = resolve(EVIDENCE_DIR, 'pins.json');
const CANONICAL_TOOL = resolve(X, '.omo/ulw/build/repo/qa/rebuild-ledger.mjs');

const EXPECTED_OMO_VERSION = '5.0.0-0.beta.88'; // lane target identity; cross-checked against STAGE.json
const PRISTINE_DEFAULT = resolve(STAGE, 'pristine/omo-ai/package');
const PRISTINE_OVERRIDE = process.env.OMO_REBUILD_PRISTINE;
const PRISTINE_ROOT = PRISTINE_OVERRIDE === undefined || PRISTINE_OVERRIDE === '' ? PRISTINE_DEFAULT : resolve(PRISTINE_OVERRIDE);
const OMOTASK = 'plugin/extensions/omo-task.js';
// pre-lane chain values that must NOT survive anywhere in the regenerated chain (stale-state guard)
const PRE_LANE_VALUES = ['e8a3f30b942f85de8ebde2e657d148b5488d518517c9e6e5b9c0faa98bd591be', '1fe05b07219804abf3f9d0d09b1bf57a533ce6e9c01315791d87b0965f2dbea2', '2b1e919651a7d28121e82f2fbddcda65cb28c491b14881de63645b4ef6239c02', '028c6c93a26a85b0e9368302ff9f13a95563260ae660506ec8832a9b223d3dd3', 'aa573b4230df73487fdc44a6722570a6651715398cf4ce292389ffedf756b2ec', '742105315ecf69763fdfccf4250befcb4fdfd3e0b0b30e68f3034add32a4ab83'];

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = p => digest(readFileSync(p));
const read = p => readFileSync(p);
const fwd = v => v.split('\\').join('/');
const count = (hay, needle) => { let n = 0, f = 0; for (;;) { const i = hay.indexOf(needle, f); if (i < 0) return n; n++; f = i + needle.length; } };

// write confinement: every mutating path must live under stage-beta88/target or evidence task-3
function W(p) {
  const f = resolve(p);
  const ok = f.startsWith(TARGET + sep) || f === TARGET || f.startsWith(EVIDENCE_DIR + sep) || f === EVIDENCE_DIR;
  if (!ok) throw new Error('WRITE_CONFINEMENT_VIOLATION ' + f);
  return f;
}
const wWrite = (p, data) => { W(p); writeFileSync(p, data); };
const wMkdir = p => { W(resolve(p, '.')); mkdirSync(p, { recursive: true }); };
const wRm = p => { W(p); rmSync(p, { recursive: true, force: true }); };

function files(root, rel = '') {
  return readdirSync(posix.join(root, rel), { withFileTypes: true }).flatMap(e => {
    if (e.name === 'node_modules') return [];
    if (e.isSymbolicLink()) throw new Error('SOURCE_SYMLINK ' + posix.join(root, rel, e.name));
    return e.isDirectory() ? files(root, posix.join(rel, e.name)) : [posix.join(rel, e.name)];
  }).sort();
}
function copyTree(source, destination) {
  wRm(destination);
  wMkdir(dirname(destination));
  cpSync(source, destination, { recursive: true, force: true, filter: src => basename(src) !== 'node_modules' });
  files(destination); // refuse symlink-bearing copies
  return destination;
}
function runDiff(id, basePath, targetPath, semantic, also) {
  const result = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--', fwd(basePath), fwd(targetPath)],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error('DIFF_EXECUTION ' + id + ' status=' + result.status + ' ' + String(result.stderr).slice(0, 300));
  const bytes = Buffer.from(result.stdout, 'utf8');
  const text = bytes.toString('utf8');
  for (const pattern of [semantic, ...(also ?? [])]) {
    if (!pattern.test(text)) throw new Error('DIFF_SEMANTIC_MISSING ' + id + ' ' + pattern);
  }
  const path = resolve(TARGET, 'ledger/diffs', id + '.diff');
  wWrite(path, bytes);
  return { id, path: fwd(path), sha256: digest(bytes), bytes: bytes.length, status: result.status };
}

function main() {
  const stamp = new Date().toISOString();
  const notes = [];

  // 1. version guard — BEFORE any write. Drift-probe seam: OMO_REBUILD_PRISTINE.
  const stagedOmoPackagePath = resolve(PRISTINE_ROOT, 'package.json');
  const stagedOmoPackage = JSON.parse(read(stagedOmoPackagePath).toString('utf8'));
  if (stagedOmoPackage.version !== EXPECTED_OMO_VERSION) {
    throw new Error('VERSION_DRIFT omo-ai ' + stagedOmoPackage.version + ' (expected ' + EXPECTED_OMO_VERSION + ') at ' + stagedOmoPackagePath);
  }
  const senpiDeclared = stagedOmoPackage.dependencies?.['@code-yeongyu/senpi'] ?? null;

  // 2. staged-base identity (task-2 record) + pristine<->base byte equality
  const stageIdentity = JSON.parse(read(resolve(STAGE, 'STAGE.json')).toString('utf8'));
  if (stageIdentity?.base?.omoAiVersion !== EXPECTED_OMO_VERSION) throw new Error('STAGE_IDENTITY_VERSION_MISMATCH ' + stageIdentity?.base?.omoAiVersion);
  const pristineTaskPath = resolve(PRISTINE_ROOT, OMOTASK);
  const pristineBytes = read(pristineTaskPath);
  const baseSha = digest(pristineBytes);
  if (baseSha !== stageIdentity.base.omoTaskSha256) throw new Error('STAGE_IDENTITY_DRIFT pristine=' + baseSha + ' recorded=' + stageIdentity.base.omoTaskSha256);
  if (pristineBytes.length !== stageIdentity.base.omoTaskBytes) throw new Error('STAGE_IDENTITY_SIZE_DRIFT ' + pristineBytes.length);
  const baseCopyPath = resolve(STAGE, 'base/omo-ai', OMOTASK);
  const baseCopySha = hashFile(baseCopyPath);
  if (baseCopySha !== baseSha) throw new Error('STAGED_BASE_COPY_DRIFT base=' + baseCopySha + ' pristine=' + baseSha);
  if (HERE !== resolve(LANE, 'qa')) throw new Error('LANE_TOOLCHAIN_PATH ' + HERE);
  notes.push('staged base (pristine) ' + baseSha + ' = ' + pristineBytes.length + ' B; stage base/omo-ai copy byte-equal (asserted)');

  if (args['reuse-base']) {
    const existingBase = resolve(TARGET, 'base/omo-ai');
    const sourceFiles = files(PRISTINE_ROOT);
    const existingFiles = files(existingBase);
    if (JSON.stringify(sourceFiles) !== JSON.stringify(existingFiles)) throw new Error('REUSE_BASE_FILE_SET_DRIFT');
    for (const file of sourceFiles) if (hashFile(resolve(PRISTINE_ROOT, file)) !== hashFile(resolve(existingBase, file))) throw new Error('REUSE_BASE_DRIFT ' + file);
  }

  // 3. re-derive the four transforms on the staged-88 base via the lane anchor copies
  const baseText = pristineBytes.toString('utf8');
  const gate = applyGateRepair(baseText);
  const gateSha = digest(Buffer.from(gate.text, 'utf8'));
  const quota = applyQuotaRouting(gate.text, { expectedBaseSha256: gateSha });
  const quotaSha = digest(Buffer.from(quota.text, 'utf8'));
  const health = applyBundleHealth(quota.text, { expectedBaseSha256: quotaSha });
  const healthSha = digest(Buffer.from(health.text, 'utf8'));
  const retry = applyRetryBudget(health.text, { expectedBaseSha256: healthSha });
  const retrySha = digest(Buffer.from(retry.text, 'utf8'));
  const observed = {
    base: { sha256: baseSha, bytes: pristineBytes.length },
    'slot-4-gateRepair': { sha256: gateSha, bytes: Buffer.byteLength(gate.text, 'utf8') },
    'todo-8-quota': { sha256: quotaSha, bytes: Buffer.byteLength(quota.text, 'utf8') },
    'todo-9-health': { sha256: healthSha, bytes: Buffer.byteLength(health.text, 'utf8') },
    'todo-7-retry': { sha256: retrySha, bytes: Buffer.byteLength(retry.text, 'utf8') }
  };
  const observedAll = [observed.base.sha256, gateSha, quotaSha, healthSha, retrySha];
  for (const v of observedAll) if (PRE_LANE_VALUES.includes(v)) throw new Error('STALE_CHAIN_VALUE_SURVIVED ' + v);
  notes.push('chain re-derived: ' + observedAll.join(' -> '));

  // 4. chain pins: regenerate on first run (never hand-edited), validate on later runs
  const pairs = [
    { slot: 'slot-4-gateRepair', baseSha256: baseSha, targetSha256: gateSha, baseBytes: pristineBytes.length, targetBytes: observed['slot-4-gateRepair'].bytes, module: 'qa/gate-repair-anchor.mjs', todo: 3 },
    { slot: 'todo-8-quota', baseSha256: gateSha, targetSha256: quotaSha, baseBytes: observed['slot-4-gateRepair'].bytes, targetBytes: observed['todo-8-quota'].bytes, module: 'qa/quota-routing-anchor.mjs', todo: 8 },
    { slot: 'todo-9-health', baseSha256: quotaSha, targetSha256: healthSha, baseBytes: observed['todo-8-quota'].bytes, targetBytes: observed['todo-9-health'].bytes, module: 'qa/bundle-health-anchor.mjs', todo: 9 },
    { slot: 'todo-7-retry', baseSha256: healthSha, targetSha256: retrySha, baseBytes: observed['todo-9-health'].bytes, targetBytes: observed['todo-7-retry'].bytes, module: 'qa/retry-budget-anchor.mjs', todo: 7 }
  ];
  let pinsRegenerated = false;
  if (!existsSync(PINS)) {
    const pins = {
      schema: 'omo-beta88-install/pins/v1',
      lane: 'beta88-install', todo: 3, task: 'st_01a0cfd3',
      generatedUtc: stamp,
      package: 'omo-ai', relativePath: OMOTASK,
      base: { sha256: baseSha, bytes: pristineBytes.length, source: fwd(baseCopyPath) + ' (== ' + fwd(pristineTaskPath) + ', asserted)' },
      chain: ['slot-4-gateRepair', 'todo-8-quota', 'todo-9-health', 'todo-7-retry'],
      pairs,
      derivedBy: 'stage-beta88/target/lane/qa/rebuild-ledger.mjs (lane re-author of qa/rebuild-ledger.mjs) via stage-beta88/target/lane/qa/{gate-repair,quota-routing,bundle-health,retry-budget}-anchor.mjs on the staged-88 base; observed digests, never hand-edited, never carried over'
    };
    wMkdir(EVIDENCE_DIR);
    wWrite(PINS, JSON.stringify(pins, null, 2) + '\n');
    pinsRegenerated = true;
    notes.push('pins.json regenerated from observed digests (4 pairs)');
  } else {
    const pins = JSON.parse(read(PINS).toString('utf8'));
    if (!Array.isArray(pins.pairs) || pins.pairs.length !== 4) throw new Error('PINS_SHAPE ' + (pins.pairs?.length));
    if (pins.base?.sha256 !== baseSha) throw new Error('PINS_DRIFT head pin=' + pins.base?.sha256 + ' observed=' + baseSha);
    const observedPairs = pairs.map(p => p.baseSha256 + '>' + p.targetSha256);
    const recordedPairs = pins.pairs.map(p => p.baseSha256 + '>' + p.targetSha256);
    for (let i = 0; i < 4; i += 1) if (recordedPairs[i] !== observedPairs[i]) throw new Error('PINS_DRIFT pair ' + i + ' recorded=' + recordedPairs[i] + ' observed=' + observedPairs[i]);
    notes.push('pins.json validated against the re-derived chain (4/4 links)');
  }

  // 5. stage materialization (real copies; symlink-free)
  const baseRoot = args['reuse-base'] ? resolve(TARGET, 'base/omo-ai') : copyTree(PRISTINE_ROOT, resolve(TARGET, 'base/omo-ai'));
  const targetRoot = copyTree(baseRoot, resolve(TARGET, 'omo-ai'));
  const intermediates = {};
  for (const slot of ['slot-4-gateRepair', 'todo-8-quota', 'todo-9-health', 'todo-7-retry']) {
    intermediates[slot] = resolve(TARGET, 'intermediates/omo-ai', slot, OMOTASK);
    wMkdir(dirname(intermediates[slot]));
  }
  wWrite(intermediates['slot-4-gateRepair'], gate.text);
  wWrite(intermediates['todo-8-quota'], quota.text);
  wWrite(intermediates['todo-9-health'], health.text);
  wWrite(intermediates['todo-7-retry'], retry.text);
  wWrite(resolve(targetRoot, OMOTASK), retry.text);
  if (hashFile(resolve(targetRoot, OMOTASK)) !== retrySha) throw new Error('TARGET_TAIL_DRIFT');
  if (hashFile(resolve(baseRoot, OMOTASK)) !== baseSha) throw new Error('TARGET_BASE_DRIFT');
  notes.push('materialized target/base, target/omo-ai (tail=' + retrySha.slice(0, 12) + ') and 4 intermediates under stage-beta88/target');

  // 6. landing syntax gate (chain-tail bytes must parse)
  const syntaxProbe = resolve(TARGET, 'ledger/scratch/retry-syntax-probe.mjs');
  wMkdir(dirname(syntaxProbe));
  wWrite(syntaxProbe, retry.text);
  const syntax = spawnSync(process.execPath, ['--check', syntaxProbe], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  wRm(syntaxProbe);
  if (syntax.status !== 0 || syntax.stderr !== '') throw new Error('RETRY_SYNTAX_CHECK_FAILED ' + String(syntax.stderr).slice(0, 400));

  // 7. slot diffs (reproducible; semantic assertions mirror the canonical lane)
  const diffDir = resolve(TARGET, 'ledger/diffs');
  wMkdir(diffDir);
  const diffs = [
    runDiff(GATE_REPAIR.id, resolve(baseRoot, OMOTASK), intermediates[GATE_REPAIR.id], /omo\.plan-review-adoption/, [/omoA1ArtifactEntries/, /u=eY\(n,\{manager:l\.manager,engine:l\}\),p=RJ\(\{/]),
    runDiff(QUOTA.id, intermediates[GATE_REPAIR.id], intermediates[QUOTA.id], /omoQuotaAdmit\(this\.#E\.store,t,this\.#O,d\.task_id/, [/omoQuotaObserveRuntimeFailure\(this\.#E\.store,this\.#W\(e\.taskId\)/, /omo\/quota-routing\/keys\/v1/, /"insufficient_quota" === code/]),
    runDiff(HEALTH.id, intermediates[QUOTA.id], intermediates[HEALTH.id], /omoBundleHealthAdmission\(this\.#E\.store/, [/var omoBundleHealthStartup = omoBundleHealthCapture\(\);/, /omo\/bundle-health\/report\/v1/, /OMO_BUNDLE_HEALTH_MODE/]),
    runDiff(RETRY_BUDGET.id, intermediates[HEALTH.id], resolve(targetRoot, OMOTASK), /omoRetryInstall\(n,\{engine:l\}\)/, [/omoRetryLaunchFatal\(this\.#E\.store,e\.record,t\)/, /i=omoRetryEngineRetryKnobs\(n\)/, /if \(omoRetryOp\.failures > 0\) \{ omoRetryTask\.taskRetryAttempts \+= 1; \}/, /omoRetryIsGateRejection/, /senpi-task\/retry-budget\/v1/, /retry_budget_exhausted/, /trusted_loader_enoent/])
  ];

  // 8. toolchain record (read-only hashes)
  const laneModules = ['gate-repair-anchor.mjs', 'quota-routing-anchor.mjs', 'bundle-health-anchor.mjs', 'retry-budget-anchor.mjs', 'rebuild-ledger.mjs'];
  const toolchain = laneModules.map(name => {
    const lanePath = resolve(LANE, 'qa', name);
    const repoPath = resolve(X, '.omo/ulw/build/repo/qa', name);
    return { name, lanePath: fwd(lanePath), laneSha256: hashFile(lanePath), repoPath: fwd(repoPath), repoSha256: existsSync(repoPath) ? hashFile(repoPath) : null,
      identicalToRepo: existsSync(repoPath) && hashFile(repoPath) === hashFile(lanePath) };
  });
  const refs = GATE_REPAIR.references.map(r => ({ role: r.role, path: r.path, sha256: r.sha256, present: existsSync(r.path), observedSha256: existsSync(r.path) ? hashFile(r.path) : null }));

  // 9. lock + ledger (deterministic; no timestamps enter either file)
  const lock = {
    schema: 'piomo-personal-modpack/stage-lock/v1',
    lane: 'beta88-install', todo: 3, task: 'st_01a0cfd3',
    stageRoot: fwd(STAGE),
    packages: [{ name: 'omo-ai', expectedVersion: EXPECTED_OMO_VERSION, baseRoot: fwd(baseRoot), targetRoot: fwd(targetRoot), baseFiles: files(baseRoot).length, targetFiles: files(targetRoot).length }],
    senpi: { name: '@code-yeongyu/senpi', declaredVersion: senpiDeclared, staged: false, note: 'senpi engine staging is the later senpi lane (task-2 decision); no senpi tree is materialized on this lane' },
    diffs: diffs.map(d => ({ id: d.id, path: d.path, sha256: d.sha256, bytes: d.bytes })),
    chain: pairs.map(p => ({ slot: p.slot, baseSha256: p.baseSha256, targetSha256: p.targetSha256 })),
    method: 'beta.88 lane: chain re-derived from the staged post-unpack base 77b6747d via the lane anchor copies; target/base materialized under stage-beta88/target; no repo patches write; no live provenance; senpi not staged'
  };
  wMkdir(dirname(resolve(TARGET, 'ledger/stage.lock.json')));
  wWrite(resolve(TARGET, 'ledger/stage.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  const lockSha256 = hashFile(resolve(TARGET, 'ledger/stage.lock.json'));

  const ledger = {
    schema: 'piomo-personal-modpack/installed-patches/v1',
    lane: 'beta88-install', todo: 3, task: 'st_01a0cfd3',
    note: '4-slot chain re-anchored and re-pinned on the staged beta.88 base (gateRepair -> quota -> health -> retry). Rebuilt by the beta.88 lane re-author of qa/rebuild-ledger.mjs; pins regenerated from observed digests (pins.json), never hand-edited. senpi retired pairs and the legacy-1 directive capture pair are deferred to the senpi staging lane (senpi not staged here).',
    ledgerSha256: '',
    lockPath: fwd(resolve(TARGET, 'ledger/stage.lock.json')), lockSha256,
    packages: [{ name: 'omo-ai', expectedVersion: EXPECTED_OMO_VERSION, baseRoot: fwd(baseRoot), targetRoot: fwd(targetRoot), baseFiles: files(baseRoot).length, targetFiles: files(targetRoot).length, changed: pairs.map(p => ({ relativePath: OMOTASK, baseSha256: p.baseSha256, targetSha256: p.targetSha256 })) }],
    deferredPairs: [
      { id: 'legacy-1-directive', package: 'omo-ai', relativePath: 'plugin/runtime/agent-toolkit/directive.md', status: 'capture-only, deferred', note: 'captures live on the beta.86 lane; this lane records the deferral, no materialization, no pin change' },
      { id: 'legacy-2-openai', package: '@code-yeongyu/senpi', relativePath: 'dist/core/extensions/builtin/compaction/openai-remote-model.js', status: 'retired pair, deferred', note: 'senpi not staged on this lane' },
      { id: 'legacy-3-speculative', package: '@code-yeongyu/senpi', relativePath: 'dist/core/extensions/builtin/compaction/speculative-summary.js', status: 'retired pair, deferred', note: 'senpi not staged on this lane' }
    ],
    gateRepair: {
      id: GATE_REPAIR.id, todo: 3, package: 'omo-ai', relativePath: OMOTASK,
      basePath: fwd(resolve(baseRoot, OMOTASK)), targetPath: fwd(intermediates[GATE_REPAIR.id]),
      baseSha256: pairs[0].baseSha256, targetSha256: pairs[0].targetSha256,
      diff: { path: diffs[0].path, sha256: diffs[0].sha256 },
      provenance: { method: GATE_REPAIR.method, transform: gate.meta, references: refs }
    },
    deltas: [
      { id: QUOTA.id, todo: 8, package: 'omo-ai', relativePath: OMOTASK, basePath: fwd(intermediates[GATE_REPAIR.id]), targetPath: fwd(intermediates[QUOTA.id]), baseSha256: pairs[1].baseSha256, targetSha256: pairs[1].targetSha256, diff: { path: diffs[1].path, sha256: diffs[1].sha256 }, provenance: { method: QUOTA.method, transform: quota.meta } },
      { id: HEALTH.id, todo: 9, package: 'omo-ai', relativePath: OMOTASK, basePath: fwd(intermediates[QUOTA.id]), targetPath: fwd(intermediates[HEALTH.id]), baseSha256: pairs[2].baseSha256, targetSha256: pairs[2].targetSha256, diff: { path: diffs[2].path, sha256: diffs[2].sha256 }, provenance: { method: HEALTH.method, transform: health.meta } },
      { id: RETRY_BUDGET.id, todo: 7, package: 'omo-ai', relativePath: OMOTASK, basePath: fwd(intermediates[HEALTH.id]), targetPath: fwd(resolve(targetRoot, OMOTASK)), baseSha256: pairs[3].baseSha256, targetSha256: pairs[3].targetSha256, diff: { path: diffs[3].path, sha256: diffs[3].sha256 }, provenance: { method: RETRY_BUDGET.method, transform: retry.meta } }
    ],
    decisions: [
      { id: 'beta88-lane-repin', question: 'the beta.88 base (900146 B) moved every beta.85 chain pin, transform seam and staged root of this lane', decision: 're-derive the four transforms on the staged-88 base via the lane anchor copies and regenerate the chain pins from the observed digests; base pin re-anchored 77b6747d (was e8a3f30b)', rationale: 'a stale pin must never land silently; the derive run records every observed digest and pins.json is written from them (never hand-edited). All 15 splice anchors verified unique on the staged-88 base before applying.' },
      { id: 'write-confinement', question: 'where this lane may write', decision: 'only .omo/ulw/build/stage-beta88/target/** and .omo/evidence/beta88-install/task-3/**; the canonical repo tool, repo/patches artifacts, the stage base/pristine/downloads trees and every frozen lane stay untouched', rationale: 'the plan todo 3 acceptance is a byte-compare proving no writes outside stage-beta88/target + the ledger tool; the lane re-author lives inside target/lane/ so even the tool write stays inside the sanctioned roots' },
      { id: 'senpi-deferred', question: 'senpi 2026.9.23-5 is declared by the 88 package but not staged', decision: 'record the declared dep, materialize no senpi tree, defer the two senpi retired pairs and the legacy-1 capture pair to the senpi staging lane', rationale: 'task-2 staged omo-ai only by design (STAGE.json); the four chain slots are all omo-ai so the re-pin is complete without senpi, and inventing senpi bytes would be worse than recording the deferral' }
    ]
  };
  const render = value => JSON.stringify({ ...ledger, ledgerSha256: value }, null, 2) + '\n';
  const maskedDigest = (bytes => digest(Buffer.from(bytes.toString('utf8').replace(/^([ \t]*"ledgerSha256"\s*:\s*)"[0-9a-f]{64}"/m, '$1""'), 'utf8')))(Buffer.from(render(''), 'utf8'));
  const ledgerPath = resolve(TARGET, 'ledger/installed-patches.json');
  wWrite(ledgerPath, render(maskedDigest));
  const onDiskDigest = (bytes => digest(Buffer.from(bytes.toString('utf8').replace(/^([ \t]*"ledgerSha256"\s*:\s*)"[0-9a-f]{64}"/m, '$1""'), 'utf8')))(read(ledgerPath));
  if (onDiskDigest !== maskedDigest) throw new Error('LEDGER_DIGEST_ROUNDTRIP ' + onDiskDigest + ' != ' + maskedDigest);

  // 10. evidence
  const evidence = {
    schema: 'omo-beta88-install/rebuild-ledger/v1', lane: 'beta88-install', todo: 3, task: 'st_01a0cfd3',
    generatedUtc: stamp,
    tool: { path: fwd(resolve(HERE, 'rebuild-ledger.mjs')), kind: 'lane re-author of qa/rebuild-ledger.mjs', canonicalSource: fwd(CANONICAL_TOOL), canonicalSourceSha256: hashFile(CANONICAL_TOOL), selfSha256: hashFile(resolve(HERE, 'rebuild-ledger.mjs')) },
    staged: { stageRoot: fwd(STAGE), pristineRoot: fwd(PRISTINE_ROOT), base: { sha256: baseSha, bytes: pristineBytes.length }, baseCopyPath: fwd(baseCopyPath), senpiDeclared, senpiStaged: false },
    chain: observed, pairs, pinsPath: fwd(PINS), pinsRegeneratedThisRun: pinsRegenerated,
    outputs: { targetRoot: fwd(targetRoot), baseRoot: fwd(baseRoot), intermediates: Object.fromEntries(Object.entries(intermediates).map(([k, v]) => [k, fwd(v)])), ledgerPath: fwd(ledgerPath), ledgerSha256: maskedDigest, lockPath: fwd(resolve(TARGET, 'ledger/stage.lock.json')), lockSha256, diffs, evidencePath: fwd(EVIDENCE) },
    landingSyntaxGate: { command: 'node --check <chain-tail bytes>', status: syntax.status, probe: 'target/ledger/scratch (removed after check)' },
    toolchain, gateRepairReferences: refs, notes,
    preLaneValuesAllAbsent: true,
    confinement: 'all writes under stage-beta88/target/** or evidence task-3/** (enforced in-process); repo/patches, stage base/pristine/downloads, live install and stages 85/86 untouched'
  };
  wMkdir(EVIDENCE_DIR);
  wWrite(EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');

  console.log(JSON.stringify({
    ok: true,
    tool: 'stage-beta88/target/lane/qa/rebuild-ledger.mjs (beta.88 lane re-author of qa/rebuild-ledger.mjs)',
    base: { path: fwd(pristineTaskPath), sha256: baseSha, bytes: pristineBytes.length, stagedBaseCopy: fwd(baseCopyPath) },
    senpiDeclared, senpiStaged: false,
    chain: { gateRepair: gateSha, quota: quotaSha, health: healthSha, retry: retrySha },
    pins: { path: fwd(PINS), pairs: 4, regeneratedThisRun: pinsRegenerated },
    target: fwd(resolve(targetRoot, OMOTASK)), tailSha256: retrySha,
    ledger: { path: fwd(ledgerPath), ledgerSha256: maskedDigest, lockSha256 },
    evidence: fwd(EVIDENCE),
    pinsSha256: hashFile(PINS)
  }, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
