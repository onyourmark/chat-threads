/** The ChatGPT provider adapter. */

import { fail, type ProviderAdapter } from '../types';
import type {
  AdapterResult,
  ConversationIdentity,
  RetrievalStatus,
} from '../../model/types';
import { freezeConversation } from '../../model/conversation';
import {
  ChatGptRetrievalError,
  conversationIdFromUrl,
  fetchConversation,
} from './api';
import { ChatGptFormatError, normalizeChatGptConversation } from './normalize';
import { extractChatGptDom } from './dom';

const HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

export class ChatGptAdapter implements ProviderAdapter {
  readonly id = 'chatgpt' as const;
  readonly label = 'ChatGPT';

  private status: RetrievalStatus | null = null;

  canHandle(url: string): boolean {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return HOSTS.has(host);
    } catch {
      return false;
    }
  }

  conversationIdFromUrl(url: string): string | undefined {
    return this.canHandle(url) ? conversationIdFromUrl(url) : undefined;
  }

  getConversationIdentity(url: string): ConversationIdentity | null {
    if (!this.canHandle(url)) return null;
    const conversationId = conversationIdFromUrl(url);
    if (!conversationId) return null;
    const title =
      typeof document !== 'undefined'
        ? document.title.replace(/\s*[|\-–]\s*ChatGPT\s*$/i, '').trim()
        : undefined;
    return { provider: 'chatgpt', conversationId, title: title || undefined, url };
  }

  getRetrievalStatus(): RetrievalStatus | null {
    return this.status;
  }

  async loadConversation(url: string): Promise<AdapterResult> {
    this.status = null;
    if (!this.canHandle(url)) {
      return fail('chatgpt', 'unsupported-page', 'This is not a ChatGPT page.');
    }

    const conversationId = conversationIdFromUrl(url);
    if (!conversationId) {
      return fail(
        'chatgpt',
        'no-conversation',
        'No active conversation found. Open a saved ChatGPT conversation and try again.',
      );
    }

    const origin = new URL(url).origin;

    try {
      const payload = await fetchConversation(origin, conversationId);
      const conversation = normalizeChatGptConversation(payload, {
        url,
        method: 'provider-api',
      });
      this.status = conversation.retrieval;
      return { ok: true, conversation: freezeConversation(conversation) };
    } catch (err) {
      const fallback = this.tryDom(url, conversationId, err);
      if (fallback) return fallback;

      if (err instanceof ChatGptRetrievalError) {
        return fail('chatgpt', err.code, err.message, {
          adapterFile: 'src/adapters/chatgpt/api.ts',
          httpStatus: err.status ?? 0,
        });
      }
      if (err instanceof ChatGptFormatError) {
        return fail('chatgpt', 'provider-format-changed', err.message, {
          adapterFile: 'src/adapters/chatgpt/normalize.ts',
          detail: err.detail,
        });
      }
      return fail(
        'chatgpt',
        'unknown',
        'Chat Threads could not retrieve this conversation.',
        { adapterFile: 'src/adapters/chatgpt/index.ts' },
      );
    }
  }

  /**
   * Last resort: read what the page has rendered. Returned only when it
   * actually found turns, and always flagged `partial` so the side panel
   * tells the user the transcript may be missing material.
   */
  private tryDom(
    url: string,
    conversationId: string,
    cause: unknown,
  ): AdapterResult | null {
    if (typeof document === 'undefined') return null;
    try {
      const conversation = extractChatGptDom(document, url, conversationId);
      if (conversation.turns.length === 0) return null;
      const reason =
        cause instanceof Error ? cause.message : 'Retrieval failed.';
      const warnings = [...conversation.retrieval.warnings, reason];
      const withReason = {
        ...conversation,
        retrieval: { ...conversation.retrieval, warnings },
      };
      this.status = withReason.retrieval;
      return { ok: true, conversation: freezeConversation(withReason) };
    } catch {
      return null;
    }
  }
}
