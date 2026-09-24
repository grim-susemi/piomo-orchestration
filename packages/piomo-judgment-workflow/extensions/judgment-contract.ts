// Trusted consumer binding for the patched native explicit-task recipe, not a routing policy.
import type { DerivedAdmission, NativeRecipeConsumer } from './judgment-recipe.ts';
export type { CertificateId, AdmissionId, RecipeCertificate, DerivedAdmission, NativeRecipeConsumer } from './judgment-recipe.ts';
declare const requestBrand: unique symbol;
declare const receiptBrand: unique symbol;
declare const taskBrand: unique symbol;
export type RequestId = string & { readonly [requestBrand]: true };
export type ReceiptId = string & { readonly [receiptBrand]: true };
export type TaskId = string & { readonly [taskBrand]: true };
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type TaskArguments = {
  readonly prompt: string;
  readonly name?: string;
  readonly category?: string;
  readonly subagent_type?: string;
  readonly model?: string;
  readonly description?: string;
  readonly task_summary?: string;
  readonly run_in_background?: boolean;
  readonly load_skills?: readonly string[];
};
export type ReviewInput = {
  readonly input: JsonValue;
  readonly artifacts: readonly string[];
  readonly reviewer_scope: string;
  readonly evidence_refs: readonly string[];
  readonly reviewTask: TaskArguments;
  readonly protectedTask: TaskArguments;
};
export type BoundRequest = ReviewInput & {
  readonly request_id: RequestId;
  readonly revision: number;
  readonly input_digest: string;
  readonly protected_digest: string;
};
export type NativeReceipt = {
  readonly receipt_id: ReceiptId;
  readonly request_id: RequestId;
  readonly revision: number;
  readonly task_id: TaskId;
  readonly run_epoch: number;
  readonly round_id: string;
  readonly result_revision: number;
  readonly result_digest: string;
  readonly parent_session_id: string;
  readonly root_session_id: string;
  readonly child_session_id: string;
  readonly invocation_id: string;
  readonly input_digest: string;
  readonly protected_digest: string;
  readonly reviewer_scope: string;
  readonly evidence_refs: readonly string[];
  readonly artifact_bindings: readonly { readonly path: string; readonly realpath: string; readonly digest: string }[];
  readonly status: 'completed';
  readonly decision: 'approve' | 'reject';
  readonly blockers: readonly string[];
  readonly actual: { readonly provider: string; readonly model: string; readonly api: string; readonly reasoning: string; readonly stop_reason: 'stop'; readonly prompt_digest: string };
};
export interface NativeReceiptConsumer {
  readonly capability: 'native-task-receipt-v1-in-process';
  readonly prepare: (input: ReviewInput) => BoundRequest;
  readonly revise: (id: RequestId, input: ReviewInput) => BoundRequest;
  readonly read: (task: TaskId, epoch: number) => NativeReceipt | undefined;
  readonly subscribe: (listener: (receipt: NativeReceipt) => void) => () => void;
  readonly recipe?: NativeRecipeConsumer;
  readonly setAdmission: (admit: (receipt: NativeReceipt | DerivedAdmission, signal: AbortSignal | undefined) => Promise<boolean>) => void;
}
export class JudgmentContractRefusal extends Error {
  readonly code = 'NATIVE_RECEIPT_REQUIRED';
  constructor() { super('NATIVE_RECEIPT_REQUIRED'); this.name = 'JudgmentContractRefusal'; }
}
// Obtain this consumer only through J.createTaskComponent({onJudgmentConsumer}) or
// J.bindTaskJudgment on the actual native task tool. This module cannot issue receipts.
export function createJudgmentContract(consumer: NativeReceiptConsumer) {
  if (consumer.capability !== 'native-task-receipt-v1-in-process') throw new JudgmentContractRefusal();
  return Object.freeze({
    prepare: consumer.prepare,
    revise: consumer.revise,
    read: consumer.read,
    subscribe: consumer.subscribe,
    setAdmission: consumer.setAdmission,
    reviewArguments(request: BoundRequest) {
      return { ...request.reviewTask, judgment: { mode: 'review', request_id: request.request_id, revision: request.revision } };
    },
    protectedArguments(request: BoundRequest, receipt: NativeReceipt) {
      const current = consumer.read(receipt.task_id, receipt.run_epoch);
      if (!current || current.receipt_id !== receipt.receipt_id || current.request_id !== request.request_id || current.revision !== request.revision || current.input_digest !== request.input_digest || current.protected_digest !== request.protected_digest || current.decision !== 'approve' || current.blockers.length !== 0) throw new JudgmentContractRefusal();
      return { ...request.protectedTask, judgment: { mode: 'protected', request_id: current.request_id, revision: current.revision, receipt_id: current.receipt_id, task_id: current.task_id, run_epoch: current.run_epoch } };
    },
  });
}
