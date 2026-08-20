/**
 * The provider adapter contract.
 *
 * An adapter is the only place that may know how a specific provider stores a
 * conversation. It takes the page it is running in and returns the common
 * representation, or a described failure. Nothing else in Chat Threads imports
 * anything from `adapters/chatgpt` or `adapters/claude`.
 *
 * When a provider changes its internals, exactly one adapter breaks, and its
 * failure names itself so the report says which file to repair.
 */

import type {
  AdapterResult,
  ConversationIdentity,
  ProviderId,
  RetrievalStatus,
} from '../model/types';

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Human-readable provider name, shown in the side panel. */
  readonly label: string;

  /** True when this adapter handles the given page URL. */
  canHandle(url: string): boolean;

  /**
   * The provider's conversation id, from the URL alone.
   *
   * Separate from `getConversationIdentity` because the side panel needs this
   * without touching the page: it has no access to the document, and needs to
   * tell one conversation from another to keep their sessions apart.
   */
  conversationIdFromUrl(url: string): string | undefined;

  /**
   * Identify the conversation currently open, without retrieving it.
   * Returns `null` when the page is the provider's site but no conversation
   * is open (e.g. a brand-new empty chat).
   */
  getConversationIdentity(url: string): ConversationIdentity | null;

  /**
   * Retrieve and normalize the active branch of the current conversation.
   * Must run inside a content script on the provider's own origin, so that
   * requests ride the user's existing session and never need a stored token.
   */
  loadConversation(url: string): Promise<AdapterResult>;

  /** The status of the most recent `loadConversation` call. */
  getRetrievalStatus(): RetrievalStatus | null;
}

/** Convenience builder so every adapter reports failures the same way. */
export function fail(
  adapter: ProviderId,
  code: Extract<AdapterResult, { ok: false }>['code'],
  message: string,
  diagnostics?: Record<string, string | number | boolean>,
): Extract<AdapterResult, { ok: false }> {
  return { ok: false, adapter, code, message, diagnostics };
}
