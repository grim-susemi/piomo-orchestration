# piomo-judgment-workflow

Private helper package for trusted native application composition. No automatic extension factories or runtime dependencies. It does not change live settings or install a host.

Import `createWorkflowComposition` from `piomo-judgment-workflow/workflow-composition`. Supply the actual same-module K consumer obtained through `bindTaskJudgment` / `getTaskReceiptConsumer`, native parent context and task execution, trusted experts, request-applicable skill catalog with ALL mandatory obligations, native skill loader, allowed roots and reviewer scopes. Never supply caller-loaded flags or reconstructed receipt JSON.

Preparation owns immutable snapshots indexed by native request and current revision. The composition installs the sole awaited admission callback, validating skill reads and T8 routing; K independently rechecks and consumes authorization at launch. Optional trusted prepareAdmission work is awaited between current-preparation checks; its errors propagate, never approve. The native child adapter must await lookup with actual SDK session/native run epoch/read tool-result bytes before accepting completion. Missing or untranslated obligations refuse. No private wiki adapter is supplied.

Recipe reuse requires an authentic explicitly pre-reviewed native receipt, its native certificate and exact current preparation/snapshot identities. New preparation is not equivalent. Authority is same-session, confined to cwd, one-use, quota-reserved and nonpersistent. Process/RPC protected recipes are unsupported and must refuse, not fall back to inprocess. Ordinary RPC/member lifecycles are distinct from protected authority. Output is advisory; there is no global text/billing gate, child policy inheritance or second activeTools-writer support.

An unchanged review continuation requires fresh epoch lookup and remains advisory until a fresh routing correction/review. Every continuation reserves one of the same three advisory launches; a failed attempt is not refunded. For corrections, revise prepares fresh bodies before native review and drops old lookup authority. Protected task_send is unsupported; dispatch a fresh exact protected request. After every related session closes, remove only directories containing the request-owned snapshot paths returned by snapshotDirectories().

T10 integration verification is separate from independent confirmation and from model intelligence/cost measurement. Core Muse/GPT orchestration and local residual remain separate artifacts; native images, QA, evidence and skill snapshots are not shipped here.
