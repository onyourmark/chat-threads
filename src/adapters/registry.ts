/**
 * Adapter registry.
 *
 * The one place that knows which providers exist. Supporting another site
 * means writing an adapter and adding it to this list — nothing else in the
 * application changes.
 */

import { ChatGptAdapter } from './chatgpt';
import { ClaudeAdapter } from './claude';
import type { ProviderAdapter } from './types';
import type { ProviderId } from '../model/types';

export const adapters: ProviderAdapter[] = [
  new ChatGptAdapter(),
  new ClaudeAdapter(),
];

export function adapterForUrl(url: string): ProviderAdapter | null {
  return adapters.find((a) => a.canHandle(url)) ?? null;
}

export function providerForUrl(url: string): ProviderId | null {
  return adapterForUrl(url)?.id ?? null;
}

/**
 * Which provider and which conversation a URL refers to, without touching the
 * page. Used by the side panel to keep one tab's work apart from another's.
 */
export function identityFromUrl(
  url: string,
): { provider: ProviderId; conversationId?: string } | null {
  const adapter = adapterForUrl(url);
  if (!adapter) return null;
  return {
    provider: adapter.id,
    conversationId: adapter.conversationIdFromUrl(url),
  };
}

/** Display name for a provider id, for use in the side panel. */
export function providerLabel(id: ProviderId): string {
  return adapters.find((a) => a.id === id)?.label ?? id;
}
