import { createJudgmentContract } from './judgment-contract.ts';
import { createRecipeRouting } from './judgment-recipe.ts';
import type { CertificateId, DerivedAdmission, NativeRecipeConsumer } from './judgment-recipe.ts';
import type { BoundRequest, NativeReceipt, NativeReceiptConsumer, RequestId, ReviewInput, TaskId } from './judgment-contract.ts';

export type RoutingContext = { readonly sessionManager: { getSessionId(): string } };
export type JudgmentNeed = {
  readonly kind: 'information' | 'new-design' | 'conflict' | 'insufficient-evidence' | 'mandatory-judgment' | 'recipe';
  readonly domain: string;
  readonly minimumAdvisories: number;
  readonly independentVerification: boolean;
};
export type Expert = { readonly id: string; readonly role: 'primary' | 'verifier'; readonly domains: readonly string[]; readonly category: string };
export type AdvisorySlot = 'primary' | 'correction' | 'verifier';
export class RoutingRefusal extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'RoutingRefusal'; }
}
function requirePolicy(value: unknown, code: string): asserts value { if (!value) throw new RoutingRefusal(code); }

// Classification is a trusted main responsibility, not an expert/approval claim.
export function classifyJudgment(need: JudgmentNeed, experts: readonly Expert[]) {
  if (need.kind === 'information') return { kind: 'information' } as const;
  if (need.kind === 'recipe') return { kind: 'recipe-blocked' } as const;
  requirePolicy(['new-design', 'conflict', 'insufficient-evidence', 'mandatory-judgment'].includes(need.kind), 'INVALID_JUDGMENT_KIND');
  const expert = experts.find(row => row.role === 'primary' && row.domains.includes(need.domain));
  requirePolicy(expert, 'SUITABLE_EXPERT_REQUIRED');
  return { kind: 'expert', expertId: expert.id } as const;
}

type Phase = 'unresolved' | 'reviewing' | 'ready' | 'submitted' | 'stopped';
type History = { slot: AdvisorySlot; expertId: string; request: BoundRequest; taskId: TaskId | undefined; receipt: NativeReceipt | undefined; outcome: string };
type State = {
  request: BoundRequest; input: ReviewInput; need: JudgmentNeed; primary: Expert; verifier: Expert | undefined;
  phase: Phase; launches: number; history: History[]; pending: History | undefined;
  primaryReceipt: NativeReceipt | undefined; verifierReceipt: NativeReceipt | undefined; blockers: string[];
};
export type JudgmentRoutingOptions = {
  readonly consumer: NativeReceiptConsumer;
  readonly recipe?: NativeRecipeConsumer;
  // These are ports from trusted native application registration, never user-supplied identity flags.
  readonly context: RoutingContext;
  readonly experts: readonly Expert[];
  readonly executeTask: (args: unknown) => Promise<unknown>;
  readonly validateCurrent?: (input: ReviewInput) => readonly string[];
};
function launchedTask(output: unknown): TaskId {
  requirePolicy(output && typeof output === 'object' && 'details' in output, 'NATIVE_DISPATCH_FAILED');
  const details = output.details;
  requirePolicy(details && typeof details === 'object' && 'status' in details && ['running', 'pending'].includes(String(details.status)) && 'task_id' in details && typeof details.task_id === 'string', 'NATIVE_DISPATCH_FAILED');
  return details.task_id as TaskId;
}

// No setAdmission writer here. The serial integrator composes admit with T9 validation ONCE.
// The native issuer remains the sole receipt/epoch/one-use authority.
export function createJudgmentRouting(options: JudgmentRoutingOptions) {
  const contract = createJudgmentContract(options.consumer), owner = options.context.sessionManager, ownerId = owner.getSessionId();
  const experts: readonly Expert[] = Object.freeze(options.experts.map(row => Object.freeze({ ...row, domains: Object.freeze([...row.domains]) })));
  const states = new Map<RequestId, State>();
  const recipes = createRecipeRouting({ recipe: options.recipe, prepare: contract.prepare, validate, execute: options.executeTask });
  function context(ctx: RoutingContext) {
    requirePolicy(ctx.sessionManager === owner, 'NESTED_DISPATCH_REFUSED');
    requirePolicy(owner.getSessionId() === ownerId, 'SESSION_REPLACED');
  }
  function state(ctx: RoutingContext, id: RequestId) { context(ctx); const row = states.get(id); requirePolicy(row, 'UNKNOWN_REQUEST'); return row; }
  function validate(input: ReviewInput) {
    requirePolicy(input.evidence_refs.length > 0 && input.evidence_refs.every(ref => typeof ref === 'string' && ref.length > 0), 'MISSING_EVIDENCE');
    requirePolicy((options.validateCurrent?.(input) ?? []).length === 0, 'APPLICABILITY_CHANGED');
  }
  function nativeReceipt(receipt: NativeReceipt | undefined) {
    return receipt !== undefined && contract.read(receipt.task_id, receipt.run_epoch) === receipt && receipt.decision === 'approve' && receipt.blockers.length === 0;
  }
  function ready(row: State) {
    return nativeReceipt(row.primaryReceipt) && (!row.need.independentVerification || nativeReceipt(row.verifierReceipt)) && row.launches >= row.need.minimumAdvisories && row.blockers.length === 0;
  }
  function view(row: State) {
    return Object.freeze({ request: row.request, phase: row.phase, launches: row.launches, primaryExpert: row.primary.id, verifierExpert: row.verifier?.id,
      blockers: Object.freeze([...row.blockers]), history: Object.freeze(row.history.map(entry => Object.freeze({ ...entry }))) });
  }
  function routed(input: ReviewInput, expert: Expert, slot: AdvisorySlot, ordinal: number): ReviewInput {
    const { model: _model, subagent_type: _subagent, ...task } = input.reviewTask;
    return { ...input, reviewTask: { ...task, category: expert.category, name: `${input.reviewTask.name ?? 'judgment'}-${slot}-${ordinal}` } };
  }
  function inputSnapshot(request: BoundRequest, name: string | undefined): ReviewInput {
    return Object.freeze({ input: request.input, artifacts: request.artifacts, reviewer_scope: request.reviewer_scope, evidence_refs: request.evidence_refs,
      reviewTask: Object.freeze({ ...request.reviewTask, name: name ?? 'judgment' }), protectedTask: request.protectedTask });
  }
  function stop(row: State, code: string) { row.phase = 'stopped'; row.blockers = [...new Set([...row.blockers, code])]; }
  return Object.freeze({
    classify(need: JudgmentNeed) { return classifyJudgment(need, experts); },
    prepareRecipe(ctx: RoutingContext, certificate: CertificateId, input: ReviewInput) { context(ctx); return recipes.prepare(certificate, input); },
    async dispatchRecipe(ctx: RoutingContext, id: RequestId) { context(ctx); const output = await recipes.dispatch(id); launchedTask(output); return output; },
    revokeRecipe(ctx: RoutingContext, id: CertificateId) { context(ctx); recipes.revoke(id); },
    prepare(ctx: RoutingContext, need: JudgmentNeed, input: ReviewInput): RequestId {
      context(ctx); validate(input);
      const route = classifyJudgment(need, experts);
      requirePolicy(route.kind !== 'recipe-blocked', 'NATIVE_RECIPE_REUSE_AUTHORITY_REQUIRED');
      requirePolicy(route.kind === 'expert', 'NO_REVIEW_REQUIRED');
      requirePolicy(Number.isInteger(need.minimumAdvisories) && need.minimumAdvisories >= 1 && need.minimumAdvisories <= 3 && need.minimumAdvisories <= (need.independentVerification ? 3 : 2), 'BUDGET_SCOPE_CONFLICT');
      const primary = experts.find(expert => expert.id === route.expertId)!;
      const verifier = experts.find(expert => expert.role === 'verifier' && expert.id !== primary.id && expert.domains.includes(need.domain));
      requirePolicy(!need.independentVerification || verifier, 'INDEPENDENT_EXPERT_REQUIRED');
      const request = contract.prepare(routed(input, primary, 'primary', 1));
      // Native prepare has already deeply snapshotted all caller JSON, bodies, obligations and artifacts.
      const base = inputSnapshot(request, input.reviewTask.name);
      states.set(request.request_id, { request, input: base, need: Object.freeze({ ...need }), primary, verifier, phase: 'unresolved', launches: 0, history: [], pending: undefined, primaryReceipt: undefined, verifierReceipt: undefined, blockers: ['REVIEW_REQUIRED'] });
      return request.request_id;
    },
    async review(ctx: RoutingContext, id: RequestId, slot: AdvisorySlot) {
      const row = state(ctx, id);
      if (row.launches >= 3) { stop(row, 'ADVISORY_BUDGET_EXHAUSTED'); throw new RoutingRefusal('ADVISORY_BUDGET_EXHAUSTED'); }
      requirePolicy(row.phase !== 'submitted' && row.phase !== 'stopped', 'REQUEST_STOPPED');
      requirePolicy(!row.pending, 'REVIEW_IN_FLIGHT');
      requirePolicy(['primary', 'correction', 'verifier'].includes(slot), 'INVALID_ADVISORY_SLOT');
      requirePolicy(!row.history.some(entry => entry.slot === slot), 'ADVISORY_SLOT_USED');
      if (slot !== 'primary') requirePolicy(row.history.some(entry => entry.slot === 'primary'), 'PRIMARY_REVIEW_REQUIRED');
      if (slot === 'correction') requirePolicy(!row.history.some(entry => entry.slot === 'verifier'), 'VERIFIER_DISSENT_UNRESOLVED');
      if (slot === 'verifier') {
        requirePolicy(row.need.independentVerification && row.verifier, 'VERIFIER_NOT_REQUIRED');
        requirePolicy(nativeReceipt(row.primaryReceipt), 'UNRESOLVED_JUDGMENT');
        requirePolicy(row.need.minimumAdvisories < 3 || row.history.some(entry => entry.slot === 'correction'), 'MANDATORY_CORRECTION_REQUIRED');
      }
      validate(row.input);
      const expert = slot === 'verifier' ? row.verifier! : row.primary;
      if (row.launches > 0) row.request = contract.revise(id, routed(row.input, expert, slot, row.launches + 1));
      const pending: History = { slot, expertId: expert.id, request: row.request, taskId: undefined, receipt: undefined, outcome: 'pending' };
      row.pending = pending; row.history.push(pending); row.launches++; row.phase = 'reviewing';
      if (slot !== 'verifier') row.primaryReceipt = undefined;
      row.blockers = ['REVIEW_PENDING'];
      try {
        const output = await options.executeTask(contract.reviewArguments(row.request));
        pending.taskId = launchedTask(output);
        requirePolicy(row.pending === pending, 'STALE_REVIEW');
        return Object.freeze({ taskId: pending.taskId, request: pending.request });
      } catch (error) {
        pending.outcome = 'launch-failed';
        if (row.pending === pending) { row.pending = undefined; row.phase = 'unresolved'; row.blockers = ['NATIVE_DISPATCH_FAILED']; }
        throw error;
      }
    },
    accept(ctx: RoutingContext, id: RequestId, epoch: number) {
      const row = state(ctx, id), pending = row.pending;
      requirePolicy(pending?.taskId && Number.isInteger(epoch) && epoch >= 0, 'REVIEW_NOT_LAUNCHED');
      const receipt = contract.read(pending.taskId, epoch);
      row.pending = undefined; row.phase = 'unresolved';
      if (!receipt || receipt.request_id !== id || receipt.revision !== row.request.revision || receipt.input_digest !== row.request.input_digest || receipt.protected_digest !== row.request.protected_digest) {
        pending.outcome = 'missing-or-stale'; row.blockers = ['MISSING_OR_STALE_RECEIPT']; throw new RoutingRefusal('MISSING_OR_STALE_RECEIPT');
      }
      pending.receipt = receipt; pending.outcome = receipt.decision;
      row.blockers = [...receipt.blockers];
      if (receipt.decision !== 'approve') row.blockers.push('EXPERT_DISSENT');
      if (receipt.decision === 'approve' && row.blockers.length === 0) {
        if (pending.slot === 'verifier') row.verifierReceipt = receipt; else row.primaryReceipt = receipt;
      }
      if (ready(row)) row.phase = 'ready';
      return view(row);
    },
    revise(ctx: RoutingContext, id: RequestId, input: ReviewInput) {
      const row = state(ctx, id); validate(input);
      row.request = contract.revise(id, routed(input, row.primary, 'primary', row.launches + 1));
      row.input = inputSnapshot(row.request, input.reviewTask.name);
      row.pending = undefined; row.primaryReceipt = undefined; row.verifierReceipt = undefined;
      row.phase = 'unresolved'; row.blockers = ['REVISION_CHANGED'];
      return row.request;
    },
    invalidate(ctx: RoutingContext, id: RequestId, code: string) { stop(state(ctx, id), code); },
    snapshot(ctx: RoutingContext, id: RequestId) { return view(state(ctx, id)); },
    async dispatch(ctx: RoutingContext, id: RequestId) {
      const row = state(ctx, id); validate(row.input);
      requirePolicy(row.phase === 'ready' && ready(row), 'UNRESOLVED_JUDGMENT');
      const receipt = row.verifierReceipt ?? row.primaryReceipt!;
      const args = contract.protectedArguments(row.request, receipt);
      row.phase = 'submitted';
      try { const output = await options.executeTask(args); launchedTask(output); return output; }
      catch (error) { stop(row, 'NATIVE_DISPATCH_FAILED'); throw error; }
    },
    async admit(receipt: NativeReceipt | DerivedAdmission, signal: AbortSignal | undefined): Promise<boolean> {
      context(options.context);
      if ('kind' in receipt) return recipes.admit(receipt, signal);
      const row = states.get(receipt.request_id);
      if (!row || signal?.aborted || row.phase !== 'submitted' || row.request.revision !== receipt.revision || (row.verifierReceipt ?? row.primaryReceipt) !== receipt || !ready(row)) return false;
      validate(row.input);
      return true;
    },
  });
}
