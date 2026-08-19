/**
 * ChatGPT DOM fallback.
 *
 * Used only when the structured retrieval above fails. The page renders long
 * conversations lazily, so this can only see what is currently mounted — the
 * result is therefore always reported as `partial`, never as a complete
 * conversation. It exists so a user is not left with nothing, not as a
 * substitute for real retrieval.
 */

import { buildTurns, type RawTurnInput } from '../../model/conversation';
import type { Role, SourceConversation } from '../../model/types';

/** Read the visible transcript out of a rendered ChatGPT page. */
export function extractChatGptDom(
  doc: Document,
  url: string,
  conversationId?: string,
): SourceConversation {
  const nodes = Array.from(
    doc.querySelectorAll('[data-message-author-role]'),
  ) as HTMLElement[];

  const raw: RawTurnInput[] = [];
  for (const el of nodes) {
    const roleAttr = el.getAttribute('data-message-author-role');
    if (roleAttr !== 'user' && roleAttr !== 'assistant') continue;
    const role: Role = roleAttr;
    const text = readText(el);
    if (!text) continue;
    raw.push({
      role,
      text,
      providerMessageId: el.getAttribute('data-message-id') ?? undefined,
    });
  }

  const title = doc.title?.replace(/\s*[|\-–]\s*ChatGPT\s*$/i, '').trim();

  return {
    provider: 'chatgpt',
    conversationId,
    title: title || undefined,
    url,
    turns: buildTurns('chatgpt', conversationId, raw),
    retrieval: {
      completeness: 'partial',
      method: 'dom',
      detail:
        'Read from the page itself because ChatGPT’s conversation data could not be loaded. Only the part of the conversation the page had rendered is included.',
      warnings: [
        'Turns that ChatGPT had not rendered yet are missing. Scroll through the whole conversation and load again, or reload the page.',
      ],
    },
  };
}

/**
 * Prefer `innerText` so the browser's own layout decides line breaks; fall
 * back to `textContent` under jsdom, which does not implement `innerText`.
 */
function readText(el: HTMLElement): string {
  const raw =
    typeof el.innerText === 'string' && el.innerText.length > 0
      ? el.innerText
      : (el.textContent ?? '');
  return raw.replace(/\u00a0/g, ' ').trim();
}
