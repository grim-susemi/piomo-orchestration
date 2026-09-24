import type { BoundRequest, NativeReceipt, RequestId, ReviewInput } from './judgment-contract.ts';

declare const certificateBrand: unique symbol;
declare const admissionBrand: unique symbol;
export type CertificateId = string & { readonly [certificateBrand]: true };
export type AdmissionId = string & { readonly [admissionBrand]: true };
export type RecipeCertificate = {
  readonly kind: 'recipe-certificate'; readonly certificate_id: CertificateId;
  readonly capability: 'native-exact-recipe-v1-in-process'; readonly contract_digest: string;
  readonly source_receipt: NativeReceipt; readonly match_digest: string; readonly max_derivations: number;
};
export type DerivedAdmission = {
  readonly kind: 'recipe-derived'; readonly admission_id: AdmissionId; readonly certificate_id: CertificateId;
  readonly capability: 'native-exact-recipe-v1-in-process'; readonly contract_digest: string;
  readonly request_id: RequestId; readonly revision: number; readonly parent_session_id: string;
  readonly input_digest: string; readonly protected_digest: string; readonly reviewer_scope: string;
  readonly evidence_refs: readonly string[]; readonly artifact_bindings: NativeReceipt['artifact_bindings'];
  readonly source_receipt: NativeReceipt; readonly ordinal: number;
};
export interface NativeRecipeConsumer {
  readonly capability: 'native-exact-recipe-v1-in-process';
  readonly certificate: (receipt: NativeReceipt['receipt_id']) => RecipeCertificate;
  readonly derive: (certificate: CertificateId, request: RequestId, revision: number) => DerivedAdmission;
  readonly readAdmission: (id: AdmissionId) => DerivedAdmission;
  readonly revoke: (id: CertificateId) => void;
}
export class RecipeRoutingRefusal extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'RecipeRoutingRefusal'; this.code = code; }
}
// Private routing state is deliberately mutable; native state remains sole authorization authority.
export function createRecipeRouting(options: {
  readonly recipe: NativeRecipeConsumer | undefined;
  readonly prepare: (input: ReviewInput) => BoundRequest;
  readonly validate: (input: ReviewInput) => void;
  readonly execute: (args: unknown) => Promise<unknown>;
}) {
  const states = new Map<RequestId, { readonly request: BoundRequest; readonly admission: DerivedAdmission; submitted: boolean }>();
  function capability() {
    if (options.recipe?.capability !== 'native-exact-recipe-v1-in-process') throw new RecipeRoutingRefusal('NATIVE_RECIPE_REUSE_AUTHORITY_REQUIRED');
    return options.recipe;
  }
  return Object.freeze({
    prepare(certificate: CertificateId, input: ReviewInput) {
      options.validate(input);
      const recipe = capability(), request = options.prepare(input);
      const admission = recipe.derive(certificate, request.request_id, request.revision);
      states.set(request.request_id, { request, admission, submitted: false });
      return Object.freeze({ request, admission });
    },
    async dispatch(id: RequestId) {
      const state = states.get(id);
      if (!state || state.submitted) throw new RecipeRoutingRefusal('UNKNOWN_OR_SUBMITTED_RECIPE');
      options.validate(state.request);
      if (capability().readAdmission(state.admission.admission_id) !== state.admission) throw new RecipeRoutingRefusal('NATIVE_ADMISSION_REQUIRED');
      state.submitted = true;
      return options.execute({ ...state.request.protectedTask, judgment: { mode: 'recipe-derived', request_id: id, revision: state.request.revision, admission_id: state.admission.admission_id } });
    },
    admit(admission: DerivedAdmission, signal: AbortSignal | undefined) {
      const state = states.get(admission.request_id);
      if (signal?.aborted || !state?.submitted || state.admission !== admission || state.request.revision !== admission.revision) return false;
      options.validate(state.request);
      return capability().readAdmission(admission.admission_id) === admission;
    },
    revoke(id: CertificateId) { capability().revoke(id); },
  });
}
