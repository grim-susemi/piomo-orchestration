import { createJudgmentRouting, RoutingRefusal } from './judgment-routing.ts';
import type { AdvisorySlot, JudgmentNeed, JudgmentRoutingOptions } from './judgment-routing.ts';
import { createSkillWorkflow, SkillWorkflowRefusal } from './skill-workflow.ts';
import type { PreparedSkills, SkillPolicy } from './skill-workflow.ts';
import type { NativeReceipt, RequestId, ReviewInput, TaskId } from './judgment-contract.ts';

const owners = new WeakSet<object>();
type Current = { prepared: PreparedSkills; revision: number };
export type WorkflowCompositionOptions = Omit<JudgmentRoutingOptions, 'recipe' | 'validateCurrent'> & {
  readonly skillPolicy: SkillPolicy;
  readonly prepareAdmission?: (prepared: PreparedSkills, signal: AbortSignal | undefined) => Promise<void>;
};
/** Trusted application registration only. No extension factory, issuer or ambient discovery.
 * The native child adapter supplies actual SDK read results and native run identity to lookup.
 */
export function createWorkflowComposition(options: WorkflowCompositionOptions) {
  if (owners.has(options.consumer)) throw new RoutingRefusal('ADMISSION_ALREADY_OWNED');
  const workflow = createSkillWorkflow(options.skillPolicy);
  const current = new Map<RequestId, Current>(), preparations = new Set<PreparedSkills>(), reviewed = new Set<RequestId>();
  const ctx = options.context, followups = new Map<RequestId, number>();
  function checkBudget(id: RequestId) {
    if (routing.snapshot(ctx, id).launches + (followups.get(id) ?? 0) >= 3) throw new RoutingRefusal('ADVISORY_BUDGET_EXHAUSTED');
  }
  function requireCurrent(id: RequestId, revision?: number) {
    const row = current.get(id);
    if (!row || revision !== undefined && row.revision !== revision) throw new RoutingRefusal('CURRENT_PREPARATION_REQUIRED');
    workflow.validate(row.prepared);
    return row;
  }
  function validateInput(input: ReviewInput) {
    // Routing snapshots JSON and changes expert task metadata. Retain the unique snapshot
    // identities rather than reconstructing a PreparedSkills object from its serialized packet.
    const prepared = [...preparations].find(p => p.skills.every(skill => input.artifacts.includes(skill.snapshot)));
    if (!prepared) throw new RoutingRefusal('CURRENT_PREPARATION_REQUIRED');
    workflow.validate(prepared);
    return [];
  }
  const routing = createJudgmentRouting({ ...options, ...(options.consumer.recipe ? { recipe: options.consumer.recipe } : {}),
    validateCurrent: validateInput,
    executeTask: async args => {
      // Routing may revise immediately before dispatching a correction/verifier. Its current
      // native request, not a caller flag, owns this revision association.
      for (const id of reviewed) current.get(id)!.revision = routing.snapshot(ctx, id).request.revision;
      return options.executeTask(args);
    },
  });
  owners.add(options.consumer);
  options.consumer.setAdmission(async (value, signal) => {
    const row = requireCurrent(value.request_id, value.revision);
    workflow.validate(row.prepared, 'kind' in value ? value.source_receipt : value);
    await options.prepareAdmission?.(row.prepared, signal);
    if (requireCurrent(value.request_id, value.revision) !== row) throw new RoutingRefusal('PREPARATION_REPLACED');
    const admitted = await routing.admit(value, signal);
    if (requireCurrent(value.request_id, value.revision) !== row) throw new RoutingRefusal('PREPARATION_REPLACED');
    workflow.validate(row.prepared, 'kind' in value ? value.source_receipt : value);
    return admitted;
  });
  function prepareSkills(base: ReviewInput, selection: unknown) {
    const prepared = workflow.prepare(base, selection);
    preparations.add(prepared);
    const omitted = options.skillPolicy.catalog.filter(entry => entry.mandatory.length && !prepared.selection.ids.includes(entry.id));
    if (omitted.length) throw new SkillWorkflowRefusal('MISSING_MANDATORY_SKILL', omitted.map(entry => entry.id));
    workflow.validate(prepared);
    return prepared;
  }
  return Object.freeze({
    classify: routing.classify,
    prepare(need: JudgmentNeed, base: ReviewInput, selection: unknown) {
      const prepared = prepareSkills(base, selection);
      const id = routing.prepare(ctx, need, prepared.reviewInput);
      const request = routing.snapshot(ctx, id).request;
      current.set(id, { prepared, revision: request.revision });
      reviewed.add(id);
      return Object.freeze({ id, request, prepared });
    },
    snapshot(id: RequestId) { requireCurrent(id); return routing.snapshot(ctx, id); },
    prepared(id: RequestId, revision: number) { return requireCurrent(id, revision).prepared; },
    async review(id: RequestId, slot: AdvisorySlot = 'primary') {
      const row = requireCurrent(id);
      checkBudget(id);
      const output = await routing.review(ctx, id, slot);
      if (requireCurrent(id, output.request.revision) !== row) throw new RoutingRefusal('PREPARATION_REPLACED');
      return output;
    },
    async lookup(id: RequestId, revision: number, worker: Parameters<typeof workflow.lookup>[1]) {
      const row = requireCurrent(id, revision);
      const output = await workflow.lookup(row.prepared, worker);
      if (requireCurrent(id, revision) !== row) throw new RoutingRefusal('PREPARATION_REPLACED');
      return output;
    },
    accept(id: RequestId, epoch: number) {
      const row = requireCurrent(id), history = routing.snapshot(ctx, id).history, pending = history[history.length - 1];
      const receipt = pending?.taskId && options.consumer.read(pending.taskId, epoch);
      if (!receipt || receipt.revision !== row.revision) throw new RoutingRefusal('MISSING_OR_STALE_RECEIPT');
      workflow.validate(row.prepared, receipt);
      return routing.accept(ctx, id, epoch);
    },
    async dispatch(id: RequestId) { requireCurrent(id); return routing.dispatch(ctx, id); },
    revise(id: RequestId, base: ReviewInput) {
      const previous = requireCurrent(id);
      const prepared = workflow.followup(previous.prepared, base);
      preparations.add(prepared);
      const request = routing.revise(ctx, id, prepared.reviewInput);
      current.set(id, { prepared, revision: request.revision });
      return Object.freeze({ id, request, prepared });
    },
    async continueReview(id: RequestId, task: TaskId, send: (task: TaskId) => Promise<unknown>) {
      const row = requireCurrent(id), history = routing.snapshot(ctx, id).history;
      if (!history.some(entry => entry.taskId === task && entry.request.revision === row.revision)) throw new RoutingRefusal('CURRENT_REVIEW_REQUIRED');
      checkBudget(id);
      followups.set(id, (followups.get(id) ?? 0) + 1);
      // Reserve before awaiting native send; failed attempts do not refund advisory budget.
      // An unchanged review continuation is advisory. Native task_send invalidates the old
      // epoch; fresh dispatch approval requires a correction/review through routing.
      const output = await send(task);
      if (requireCurrent(id) !== row) throw new RoutingRefusal('PREPARATION_REPLACED');
      return output;
    },
    validateFollowup(id: RequestId, receipt: NativeReceipt) {
      const row = requireCurrent(id, receipt.revision);
      if (receipt.request_id !== id || options.consumer.read(receipt.task_id, receipt.run_epoch) !== receipt) throw new RoutingRefusal('MISSING_OR_STALE_RECEIPT');
      workflow.validate(row.prepared, receipt);
      return receipt;
    },
    prepareRecipe(id: RequestId, receipt: NativeReceipt) {
      const row = requireCurrent(id, receipt.revision);
      if (receipt.request_id !== id || options.consumer.read(receipt.task_id, receipt.run_epoch) !== receipt) throw new RoutingRefusal('MISSING_OR_STALE_RECEIPT');
      workflow.validate(row.prepared, receipt);
      if (!options.consumer.recipe) throw new RoutingRefusal('NATIVE_RECIPE_REUSE_AUTHORITY_REQUIRED');
      const certificate = options.consumer.recipe.certificate(receipt.receipt_id);
      const derived = routing.prepareRecipe(ctx, certificate.certificate_id, row.prepared.reviewInput);
      current.set(derived.request.request_id, { prepared: row.prepared, revision: derived.request.revision });
      return Object.freeze({ ...derived, certificate, prepared: row.prepared });
    },
    async dispatchRecipe(id: RequestId) { requireCurrent(id); return routing.dispatchRecipe(ctx, id); },
    revokeRecipe: (id: Parameters<typeof routing.revokeRecipe>[1]) => routing.revokeRecipe(ctx, id),
    // Caller closes every related native session before removing these request-owned dirs.
    snapshotDirectories() { return Object.freeze([...new Set([...preparations].flatMap(p => p.skills.map(s => s.snapshot))) ]); },
  });
}
