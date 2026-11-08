/**
 * Placeholder-only reasoning: text a gateway (or omp itself) invented because
 * it had no real reasoning to send.
 *
 * This module is deliberately dependency-free so every layer of the encoder
 * stack can use it: `providers/transform-messages.ts` demotes foreign thinking
 * to prose and cannot import `utils.ts` (which imports that module back).
 */

/**
 * Non-empty `reasoning_text` shipped for a synthesized reasoning item when no
 * thinking text survived history reconstruction. DeepSeek-family Responses
 * targets (e.g. opencode-go) reject BOTH a missing reasoning item and one whose
 * `reasoning_text` is empty — "The reasoning_text in the thinking mode must be
 * passed back to the API" (#8248 covered the missing case, #10690 the empty
 * one). The item's presence plus a non-empty payload is what satisfies the
 * contract; the exact text is immaterial once the source turn's reasoning is
 * gone. Kept out of `reasoning_content="."`-territory since DeepSeek rejects the
 * bare-dot synthetic placeholder on the chat-completions path.
 */
export const SYNTHETIC_REASONING_REPLAY_PLACEHOLDER = "reasoning unavailable";

/**
 * Whether `text` is placeholder-only reasoning: omp's own
 * {@link SYNTHETIC_REASONING_REPLAY_PLACEHOLDER} or a gateway-synthesized
 * variant such as cliproxy's `[reasoning unavailable]`.
 *
 * Gateways that translate Responses requests to chat completions inject that
 * placeholder as `reasoning_content` on replayed tool-call turns that carry no
 * reasoning item. Reasoning models then echo the placeholder back as their own
 * thinking, so a placeholder is never real reasoning: it must not be displayed,
 * stored as a thinking block, or replayed to the wire.
 */
export function isSyntheticReasoningPlaceholder(text: unknown): boolean {
	if (typeof text !== "string") return false;
	const trimmed = text.trim();
	if (trimmed.length === 0) return false;
	const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1).trim() : trimmed;
	return unwrapped.toLowerCase() === SYNTHETIC_REASONING_REPLAY_PLACEHOLDER;
}

/** Read a `text` field off an unknown summary/content part. */
function partText(part: unknown): string | undefined {
	if (!part || typeof part !== "object") return undefined;
	if (!("text" in part)) return undefined;
	const text = part.text;
	return typeof text === "string" ? text : undefined;
}

/** The `text` payloads a reasoning item carries: its summary parts and its raw reasoning parts. */
function reasoningItemTexts(item: { summary?: unknown; content?: unknown }): string[] {
	const texts: string[] = [];
	if (Array.isArray(item.summary)) {
		for (const part of item.summary) {
			const text = partText(part);
			if (text !== undefined && text.trim().length > 0) texts.push(text);
		}
	}
	if (Array.isArray(item.content)) {
		for (const part of item.content) {
			if (!part || typeof part !== "object") continue;
			const type = "type" in part ? part.type : undefined;
			if (type !== "reasoning_text") continue;
			const text = partText(part);
			if (text !== undefined && text.trim().length > 0) texts.push(text);
		}
	}
	return texts;
}

/**
 * Whether a reasoning item carries no real reasoning: no opaque encrypted blob
 * and no text beyond gateway placeholders. Such an item is a wire artifact of a
 * proxy that had nothing to send, so replaying it would feed the placeholder
 * back to the model.
 */
export function isPlaceholderOnlyReasoningItem(item: {
	encrypted_content?: unknown;
	summary?: unknown;
	content?: unknown;
}): boolean {
	if (typeof item.encrypted_content === "string" && item.encrypted_content.length > 0) return false;
	const texts = reasoningItemTexts(item);
	// An item without any text carries no placeholder either: it is the
	// provider's own empty reasoning slot and stays as it is.
	if (texts.length === 0) return false;
	return texts.every(text => isSyntheticReasoningPlaceholder(text));
}

/**
 * Whether a Responses thinking signature carries the server's opaque reasoning
 * blob. Such a turn keeps its block even when the visible text is a gateway
 * placeholder: the blob is the real reasoning, the text is not.
 */
export function reasoningSignatureCarriesEncryptedReasoning(signature: string | undefined): boolean {
	if (!signature) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(signature);
	} catch {
		return false;
	}
	if (!parsed || typeof parsed !== "object") return false;
	if (!("encrypted_content" in parsed)) return false;
	const encrypted = parsed.encrypted_content;
	return typeof encrypted === "string" && encrypted.length > 0;
}
