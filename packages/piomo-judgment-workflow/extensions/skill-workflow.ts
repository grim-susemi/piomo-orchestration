import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReviewInput, NativeReceipt } from './judgment-contract.ts';

export type Obligation =
  | { readonly id: string; readonly kind: 'worker-read'; readonly path: string; readonly sha256: string }
  | { readonly id: string; readonly kind: 'constraint'; readonly key: string; readonly value: string };
export type SkillEntry = { readonly id: string; readonly path: string; readonly revision: string; readonly mandatory: readonly Obligation[] };
export type SkillSelection = { readonly ids: readonly string[]; readonly primary: string };
export type LoadedSkill = { readonly name: string; readonly location?: string; readonly content: string };
export type SkillLoader = (names: readonly string[], cwd: string) => { readonly skills?: readonly LoadedSkill[]; readonly missing: readonly string[] };
export type SkillPolicy = {
  readonly cwd: string;
  readonly allowedRoots: readonly string[];
  readonly reviewerScopes: readonly string[];
  readonly catalog: readonly SkillEntry[];
  readonly loadSkills: SkillLoader;
};
export type SkillSnapshot = { readonly id: string; readonly declaredPath: string; readonly sourcePath: string; readonly revision: string; readonly body: string; readonly bodyDigest: string; readonly snapshot: string };
export type PreparedSkills = { readonly reviewInput: ReviewInput; readonly skills: readonly SkillSnapshot[]; readonly obligations: readonly Obligation[]; readonly selection: SkillSelection };
export type SkillIssue = { readonly code: string; readonly ids: readonly string[] };
export class SkillWorkflowRefusal extends Error {
  readonly name = 'SkillWorkflowRefusal';
  readonly issues: readonly SkillIssue[];
  constructor(code: string, ids: readonly string[] = []) { super(code); this.issues = Object.freeze([{ code, ids: Object.freeze([...ids]) }]); }
}
const digest = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
const idValid = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
const hashValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inside = (root: string, file: string) => { const rel = path.relative(root, file); return rel === '' || !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function canonical(file: string): string {
  try { return fs.realpathSync(file); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new SkillWorkflowRefusal('MISSING_PATH'); throw error; }
}
function readRevision(file: string, expected: string): string {
  const bytes = fs.readFileSync(canonical(file));
  if (!hashValid(expected) || digest(bytes) !== expected) throw new SkillWorkflowRefusal('REVISION_DRIFT', [file]);
  return bytes.toString('utf8');
}
// Native task loader's body convention. Its actual result must independently agree below.
function bodyOf(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return raw;
  const closing = normalized.indexOf('\n---', 4);
  if (closing < 0) throw new SkillWorkflowRefusal('MALFORMED_BODY');
  return normalized.slice(closing + 4).replace(/^\n/, '').trim();
}
function selectionOf(value: unknown): SkillSelection {
  if (!value || typeof value !== 'object' || !('ids' in value) || !('primary' in value) || Object.keys(value).some(k => !['ids', 'primary'].includes(k)) || !Array.isArray(value.ids) || !value.ids.length || !value.ids.every(idValid) || !idValid(value.primary)) throw new SkillWorkflowRefusal('MALFORMED_SELECTION');
  const ids: string[] = value.ids;
  if (new Set(ids).size !== ids.length) throw new SkillWorkflowRefusal('DUPLICATE_SKILL', ids);
  if (!ids.includes(value.primary)) throw new SkillWorkflowRefusal('PRIMARY_CONFLICT', [value.primary]);
  return freeze({ ids: [...ids], primary: value.primary });
}
function obligationsOf(entries: readonly SkillEntry[], cwd: string): readonly Obligation[] {
  const obligations: Obligation[] = [], ids = new Set<string>(), constraints = new Map<string, string>();
  for (const entry of entries) {
    if (!Array.isArray(entry.mandatory)) throw new SkillWorkflowRefusal('MALFORMED_OBLIGATION', [entry.id]);
    for (const obligation of entry.mandatory) {
      if (!obligation || !idValid(obligation.id)) throw new SkillWorkflowRefusal('MALFORMED_OBLIGATION', [entry.id]);
      if (ids.has(obligation.id)) throw new SkillWorkflowRefusal('DUPLICATE_OBLIGATION', [obligation.id]);
      ids.add(obligation.id);
      let key: string, value: string;
      switch (obligation.kind) {
        case 'worker-read':
          if (Object.keys(obligation).some(k => !['id', 'kind', 'path', 'sha256'].includes(k)) || typeof obligation.path !== 'string' || !hashValid(obligation.sha256)) throw new SkillWorkflowRefusal('MALFORMED_OBLIGATION', [obligation.id]);
          if (!inside(cwd, path.resolve(obligation.path)) || !inside(cwd, canonical(obligation.path))) throw new SkillWorkflowRefusal('UNAUTHORIZED_LOOKUP', [obligation.id]);
          readRevision(obligation.path, obligation.sha256); key = obligation.id; value = 'read'; break;
        case 'constraint':
          if (Object.keys(obligation).some(k => !['id', 'kind', 'key', 'value'].includes(k)) || !idValid(obligation.key) || typeof obligation.value !== 'string' || !obligation.value.trim()) throw new SkillWorkflowRefusal('MALFORMED_OBLIGATION', [obligation.id]);
          key = obligation.key; value = obligation.value; break;
        default: throw new SkillWorkflowRefusal('MALFORMED_OBLIGATION', [entry.id]);
      }
      if (constraints.has(key) && constraints.get(key) !== value) throw new SkillWorkflowRefusal('OBLIGATION_CONFLICT', [...ids]);
      constraints.set(key, value); obligations.push(structuredClone(obligation));
    }
  }
  return freeze(obligations);
}
/** Trusted registration supplies catalog obligations and the actual native loader port.
 * This owns preparation, not routing, receipt issuance or setAdmission. No ambient discovery.
 */
export function createSkillWorkflow(policy: SkillPolicy) {
  const cwd = canonical(policy.cwd), roots = policy.allowedRoots.map(p => path.resolve(p));
  const catalog = structuredClone(policy.catalog), scopes = [...policy.reviewerScopes];
  const states = new WeakMap<PreparedSkills, Map<string, readonly string[]>>();
  function validate(prepared: PreparedSkills, receipt?: Pick<NativeReceipt, 'child_session_id' | 'run_epoch'>): true {
    const lookups = states.get(prepared);
    if (!lookups) throw new SkillWorkflowRefusal('UNKNOWN_PREPARATION');
    for (const skill of prepared.skills) {
      if (canonical(skill.declaredPath) !== skill.sourcePath || canonical(skill.snapshot) !== skill.snapshot) throw new SkillWorkflowRefusal('PATH_ALIAS', [skill.id]);
      readRevision(skill.sourcePath, skill.revision); readRevision(skill.snapshot, skill.revision);
    }
    for (const obligation of prepared.obligations) {
      if (obligation.kind === 'worker-read') {
        if (!inside(cwd, canonical(obligation.path))) throw new SkillWorkflowRefusal('UNAUTHORIZED_LOOKUP', [obligation.id]);
        readRevision(obligation.path, obligation.sha256);
        if (receipt && !lookups.get(JSON.stringify([receipt.child_session_id, receipt.run_epoch]))?.includes(obligation.id)) throw new SkillWorkflowRefusal('MISSING_LOOKUP', [obligation.id]);
      }
    }
    return true;
  }
  function prepare(base: ReviewInput, selection: unknown): PreparedSkills {
    const selected = selectionOf(selection);
    if (!scopes.includes(base.reviewer_scope)) throw new SkillWorkflowRefusal('UNAUTHORIZED_SCOPE');
    const omitted = [...base.reviewTask.load_skills ?? [], ...base.protectedTask.load_skills ?? []].filter(id => !selected.ids.includes(id));
    if (omitted.length) throw new SkillWorkflowRefusal('MISSING_SKILL', omitted);
    const entries: SkillEntry[] = [], identities = new Map<string, string>(), ids = new Set<string>();
    // Inspect catalog identity, but read only shortlisted bodies. Duplicate resolution is explicit.
    for (const entry of catalog) {
      if (!idValid(entry.id) || typeof entry.path !== 'string' || !hashValid(entry.revision)) throw new SkillWorkflowRefusal('MALFORMED_CATALOG');
      if (ids.has(entry.id)) throw new SkillWorkflowRefusal('DUPLICATE_SKILL', [entry.id]);
      ids.add(entry.id);
      const lexical = path.resolve(entry.path).toLowerCase();
      if (identities.has(lexical)) throw new SkillWorkflowRefusal('PATH_ALIAS', [entry.id]);
      identities.set(lexical, entry.id);
    }
    const realIdentities = new Set<string>();
    for (const id of selected.ids) {
      const entry = catalog.find(e => e.id === id);
      if (!entry) throw new SkillWorkflowRefusal('MISSING_SKILL', [id]);
      const real = canonical(entry.path);
      if (!roots.some(root => inside(root, real) && inside(canonical(root), real))) throw new SkillWorkflowRefusal('UNAUTHORIZED_PATH', [id]);
      if (realIdentities.has(real.toLowerCase())) throw new SkillWorkflowRefusal('PATH_ALIAS', [id]);
      realIdentities.add(real.toLowerCase()); entries.push(entry);
    }
    const obligations = obligationsOf(entries, cwd);
    const bodies = entries.map(entry => {
      const sourcePath = canonical(entry.path), raw = readRevision(sourcePath, entry.revision), body = bodyOf(raw);
      if (!body.trim()) throw new SkillWorkflowRefusal('MISSING_BODY', [entry.id]);
      const loaded = policy.loadSkills([entry.id], cwd), skill = loaded.skills?.[0];
      if (loaded.missing.length || loaded.skills?.length !== 1 || !skill || skill.name !== entry.id || !skill.location || canonical(skill.location) !== sourcePath || skill.content !== body) throw new SkillWorkflowRefusal('LOADER_MISMATCH', [entry.id]);
      readRevision(sourcePath, entry.revision);
      return { entry, sourcePath, raw, body };
    });
    // New request-confined, exclusive directory: no overwrite of previous revisions or symlink parent.
    const directory = fs.mkdtempSync(path.join(cwd, '.piomo-skills-'));
    const skills = bodies.map(({ entry, sourcePath, raw, body }) => {
      const snapshot = path.join(directory, entry.id + '.md'); fs.writeFileSync(snapshot, raw, { flag: 'wx' });
      return { id: entry.id, declaredPath: path.resolve(entry.path), sourcePath, revision: entry.revision, body, bodyDigest: digest(body), snapshot };
    });
    const packet = { schema: 1, primary: selected.primary, skills, obligations };
    const append = (task: ReviewInput['reviewTask']) => ({ ...task, load_skills: [], prompt: task.prompt + '\nPIOMO_SKILL_PACKET_V1\n' + JSON.stringify(packet) });
    const prepared = freeze({ selection: selected, skills, obligations, reviewInput: {
      ...structuredClone(base), input: { request: base.input, ...packet },
      artifacts: [...base.artifacts, ...skills.map(s => s.snapshot), ...obligations.flatMap(o => o.kind === 'worker-read' ? [o.path] : [])],
      evidence_refs: [...base.evidence_refs, ...skills.map(s => 'skill:' + s.id + ':' + s.revision)],
      reviewTask: append(base.reviewTask), protectedTask: append(base.protectedTask),
    } });
    states.set(prepared, new Map()); return prepared;
  }
  return Object.freeze({ prepare, validate,
    followup(previous: PreparedSkills, base: ReviewInput) { validate(previous); return prepare(base, previous.selection); },
    async lookup(prepared: PreparedSkills, worker: { readonly sessionId: string; readonly runEpoch: number; readonly read: (file: string) => Promise<string> }) {
      validate(prepared);
      if (!worker.sessionId || !Number.isSafeInteger(worker.runEpoch) || worker.runEpoch < 0) throw new SkillWorkflowRefusal('UNAUTHORIZED_WORKER');
      const completed: string[] = [];
      for (const obligation of prepared.obligations) {
        if (obligation.kind === 'worker-read') {
          const body = await worker.read(obligation.path);
          if (digest(body) !== obligation.sha256) throw new SkillWorkflowRefusal('LOOKUP_MISMATCH', [obligation.id]);
          completed.push(obligation.id);
        }
      }
      validate(prepared); states.get(prepared)?.set(JSON.stringify([worker.sessionId, worker.runEpoch]), Object.freeze(completed));
      return freeze({ child_session_id: worker.sessionId, run_epoch: worker.runEpoch, obligations: completed });
    },
  });
}
