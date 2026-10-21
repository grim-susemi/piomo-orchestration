# DRAFT (not opened) - PR for code-yeongyu/senpi

Branch: a fresh branch from upstream `main` in the fork `grim-susemi/senpi`, e.g. `fix/subscription-commit-boundary-defer-hash`.

**Title:** fix(anthropic-subscription): defer the commit-boundary hash to message_end

## Why

`captureProviderFinal` runs on every `message_update` and hashes the whole partial message
each time. The retained heap grows quadratically during long generations. The issue
draft has the measurements: a process reaches several GB within ~20 minutes, and
four in-process children kill the host.

## Change

`packages/coding-agent/src/core/extensions/builtin/anthropic-subscription/session-commit-boundary.ts`:

```diff
-export function assistantContentHash(message: AssistantMessage): string {
-	return sessionSyncDigest({
+function semanticPayload(message: AssistantMessage): unknown {
+	return {
 		role: message.role,
 		api: message.api,
 		provider: message.provider,
 		model: message.model,
 		content: message.content.map(semanticContentBlock),
-	});
+	};
+}
+
+export function assistantContentHash(message: AssistantMessage): string {
+	return sessionSyncDigest(semanticPayload(message));
 }
 ...
 export class AssistantCommitBoundary {
-	private readonly providerFinalByKey = new Map<string, string>();
+	/** Last streamed payload per key; hashed once in commit(), never per delta. */
+	private readonly providerFinalByKey = new Map<string, unknown>();

 	captureProviderFinal(key: string, message: AssistantMessage): void {
-		this.providerFinalByKey.set(key, assistantContentHash(message));
+		this.providerFinalByKey.set(key, semanticPayload(message));
 	}

 	commit(key: string, message: AssistantMessage, modelId: string): AssistantCommitOutcome {
 		const providerFinal = this.providerFinalByKey.get(key);
 		this.providerFinalByKey.delete(key);
 		if (!isResidentAssistant(message, modelId)) return "not-resident";
 		if (providerFinal === undefined) return "clean";
-		return providerFinal === assistantContentHash(message) ? "clean" : "rewritten";
+		return sessionSyncDigest(providerFinal) === assistantContentHash(message) ? "clean" : "rewritten";
 	}
```

The stored payload holds references to the block strings and the tool-call `arguments`
object of the last update. Strings are immutable. `arguments` is replaced, never
mutated, by the stream mapper (`block.arguments = parseStreamingJson(...)` and
`mapToolArguments(...)` at block stop). So the comparison sees the same values the old
per-update hash saw at the last update.

One caveat to raise in review: an extension that mutates a tool-call `arguments` object
**in place** during `message_end` would no longer be detected as `rewritten`. If that
case matters, store `structuredClone` of tool-call arguments only. They are small next
to the thinking text.

## Tests to add

- `captureProviderFinal` called N times with a growing message, then `commit` with the same message → `clean`. Then `commit` with changed text → `rewritten`. Keep the existing result-only test (no capture → `clean`).
- A cost guard: 20 captures of a 4 MB thinking block finish in a few ms. Before: about 5 ms per call. After: about 0.003 ms per call, measured with the local probe.

## Verification done locally (patched bundle, senpi 2026.10.19)

- 4 long opus `max` runs stayed at 266-296 MB, against 1.5-3.2 GB unpatched at the same elapsed time.
- The behavioral probe returns `clean` and `rewritten` as before.
