/**
 * Claude DOM fallback.
 *
 * Used only when structured retrieval fails. Long conversations are
 * virtualized, so this sees only what is mounted; the result is always
 * reported as `partial`.
 */

import { buildTurns, type RawTurnInput } from '../../model/conversation';
import type { Role, SourceConversation } from '../../model/types';

/**
 * Selectors for a user and an assistant turn, most specific first. Claude's
 * markup changes fairly often, so several generations are tried.
 */
const USER_SELECTORS = [
  '[data-testid="user-message"]',
  '.font-user-message',
];
const ASSISTANT_SELECTORS = [
  '[data-testid="assistant-message"]',
  '.font-claude-message',
  '.font-claude-response',
];

export function extractClaudeDom(
  doc: Document,
  url: string,
  conversationId?: string,
): SourceConversation {
  const selector = [...USER_SELECTORS, ...ASSISTANT_SELECTORS].join(', ');
  const nodes = Array.from(doc.querySelectorAll(selector)) as HTMLElement[];

  const raw: RawTurnInput[] = [];
  for (const el of nodes) {
    const role = roleOf(el);
    if (!role) continue;
    const text = readText(el);
    if (!text) continue;
    raw.push({ role, text });
  }

  const title = doc.title?.replace(/\s*[|\-–]\s*Claude\s*$/i, '').trim();

  return {
    provider: 'claude',
    conversationId,
    title: title || undefined,
    url,
    turns: buildTurns('claude', conversationId, raw),
    retrieval: {
      completeness: 'partial',
      method: 'dom',
      detail:
        'Read from the page itself because Claude’s conversation data could not be loaded. Only the part of the conversation the page had rendered is included.',
      warnings: [
        'Turns that Claude had not rendered yet are missing. Scroll through the whole conversation and load again, or reload the page.',
      ],
    },
  };
}

function matchesAny(el: HTMLElement, selectors: string[]): boolean {
  return selectors.some((s) => {
    try {
      return el.matches(s);
    } catch {
      return false;
    }
  });
}

function roleOf(el: HTMLElement): Role | null {
  if (matchesAny(el, USER_SELECTORS)) return 'user';
  if (matchesAny(el, ASSISTANT_SELECTORS)) return 'assistant';
  return null;
}

function readText(el: HTMLElement): string {
  const raw =
    typeof el.innerText === 'string' && el.innerText.length > 0
      ? el.innerText
      : (el.textContent ?? '');
  return raw.replace(/\u00a0/g, ' ').trim();
}
