/** The Claude provider adapter. */

import { fail, type ProviderAdapter } from '../types';
import type {
  AdapterResult,
  ConversationIdentity,
  RetrievalStatus,
} from '../../model/types';
import { freezeConversation } from '../../model/conversation';
import {
  ClaudeRetrievalError,
  conversationIdFromUrl,
  fetchConversation,
  getOrganizationId,
} from './api';
import { ClaudeFormatError, normalizeClaudeConversation } from './normalize';
import { extractClaudeDom } from './dom';

const HOSTS = new Set(['claude.ai']);

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const;
  readonly label = 'Claude';

  private status: RetrievalStatus | null = null;

  canHandle(url: string): boolean {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return HOSTS.has(host);
    } catch {
      return false;
    }
  }

  getConversationIdentity(url: string): ConversationIdentity | null {
    if (!this.canHandle(url)) return null;
    const conversationId = conversationIdFromUrl(url);
    if (!conversationId) return null;
    const title =
      typeof document !== 'undefined'
        ? document.title.replace(/\s*[|\-–]\s*Claude\s*$/i, '').trim()
        : undefined;
    return { provider: 'claude', conversationId, title: title || undefined, url };
  }

  getRetrievalStatus(): RetrievalStatus | null {
    return this.status;
  }

  async loadConversation(url: string): Promise<AdapterResult> {
    this.status = null;
    if (!this.canHandle(url)) {
      return fail('claude', 'unsupported-page', 'This is not a Claude page.');
    }

    const conversationId = conversationIdFromUrl(url);
    if (!conversationId) {
      return fail(
        'claude',
        'no-conversation',
        'No active conversation found. Open a saved Claude conversation and try again.',
      );
    }

    const origin = new URL(url).origin;

    try {
      const organizationId = await getOrganizationId(origin);
      const payload = await fetchConversation(
        origin,
        organizationId,
        conversationId,
      );
      const conversation = normalizeClaudeConversation(payload, {
        url,
        method: 'provider-api',
      });
      this.status = conversation.retrieval;
      return { ok: true, conversation: freezeConversation(conversation) };
    } catch (err) {
      const fallback = this.tryDom(url, conversationId, err);
      if (fallback) return fallback;

      if (err instanceof ClaudeRetrievalError) {
        return fail('claude', err.code, err.message, {
          adapterFile: 'src/adapters/claude/api.ts',
          httpStatus: err.status ?? 0,
        });
      }
      if (err instanceof ClaudeFormatError) {
        return fail('claude', 'provider-format-changed', err.message, {
          adapterFile: 'src/adapters/claude/normalize.ts',
          detail: err.detail,
        });
      }
      return fail(
        'claude',
        'unknown',
        'Chat Threads could not retrieve this conversation.',
        { adapterFile: 'src/adapters/claude/index.ts' },
      );
    }
  }

  private tryDom(
    url: string,
    conversationId: string,
    cause: unknown,
  ): AdapterResult | null {
    if (typeof document === 'undefined') return null;
    try {
      const conversation = extractClaudeDom(document, url, conversationId);
      if (conversation.turns.length === 0) return null;
      const reason =
        cause instanceof Error ? cause.message : 'Retrieval failed.';
      const withReason = {
        ...conversation,
        retrieval: {
          ...conversation.retrieval,
          warnings: [...conversation.retrieval.warnings, reason],
        },
      };
      this.status = withReason.retrieval;
      return { ok: true, conversation: freezeConversation(withReason) };
    } catch {
      return null;
    }
  }
}
