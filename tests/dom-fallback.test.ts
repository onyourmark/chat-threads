/**
 * @vitest-environment jsdom
 *
 * The DOM fallback only runs when structured retrieval has already failed.
 * What matters is that it never claims to be complete.
 */

import { describe, expect, it } from 'vitest';
import { extractChatGptDom } from '../src/adapters/chatgpt/dom';
import { extractClaudeDom } from '../src/adapters/claude/dom';

function documentFrom(html: string): Document {
  const doc = document.implementation.createHTMLDocument('Test');
  doc.body.innerHTML = html;
  return doc;
}

describe('ChatGPT DOM fallback', () => {
  const html = `
    <article data-message-author-role="user" data-message-id="m1">
      What should I call this?
    </article>
    <article data-message-author-role="assistant" data-message-id="m2">
      Chat Threads works well.
    </article>
    <div>Some unrelated page furniture</div>
  `;

  it('reads the turns that are on the page', () => {
    const c = extractChatGptDom(documentFrom(html), 'https://chatgpt.com/c/x', 'x');

    expect(c.turns).toHaveLength(2);
    expect(c.turns[0]?.role).toBe('user');
    expect(c.turns[0]?.originalText).toBe('What should I call this?');
    expect(c.turns[1]?.role).toBe('assistant');
    expect(c.turns[0]?.providerMessageId).toBe('m1');
  });

  it('always reports the result as incomplete', () => {
    const c = extractChatGptDom(documentFrom(html), 'https://chatgpt.com/c/x');

    expect(c.retrieval.completeness).toBe('partial');
    expect(c.retrieval.method).toBe('dom');
    expect(c.retrieval.warnings.join(' ')).toMatch(/had not rendered yet/i);
  });

  it('ignores elements that are not turns', () => {
    const c = extractChatGptDom(
      documentFrom('<div data-message-author-role="tool">tool output</div>'),
      'https://chatgpt.com/c/x',
    );
    expect(c.turns).toHaveLength(0);
  });
});

describe('Claude DOM fallback', () => {
  const html = `
    <div data-testid="user-message">Order this reading list.</div>
    <div class="font-claude-message">Start with the shortest.</div>
  `;

  it('reads the turns that are on the page', () => {
    const c = extractClaudeDom(documentFrom(html), 'https://claude.ai/chat/x', 'x');

    expect(c.turns).toHaveLength(2);
    expect(c.turns[0]?.role).toBe('user');
    expect(c.turns[1]?.role).toBe('assistant');
    expect(c.turns[1]?.originalText).toBe('Start with the shortest.');
  });

  it('always reports the result as incomplete', () => {
    const c = extractClaudeDom(documentFrom(html), 'https://claude.ai/chat/x');
    expect(c.retrieval.completeness).toBe('partial');
  });

  it('returns nothing rather than guessing when the markup is unfamiliar', () => {
    const c = extractClaudeDom(
      documentFrom('<div class="totally-new-class">Hello</div>'),
      'https://claude.ai/chat/x',
    );
    expect(c.turns).toHaveLength(0);
  });
});

/**
 * Branch metadata lives in the provider's conversation payload, which is
 * exactly what this fallback could not load. "We did not find a branch" would
 * be a claim about something never looked at.
 */
describe('branch information after a DOM fallback', () => {
  it('says it could not be determined, not that there is none', () => {
    const chatgpt = extractChatGptDom(
      documentFrom(
        '<article data-message-author-role="user" data-message-id="m1">Hi</article>',
      ),
      'https://chatgpt.com/c/abc',
    );
    expect(chatgpt.branches.status).toBe('indeterminate');
    expect(chatgpt.branches.points).toEqual([]);
    expect(chatgpt.branches.detail).toMatch(/read from the page/i);

    const claude = extractClaudeDom(
      documentFrom('<div class="font-claude-message">Hello.</div>'),
      'https://claude.ai/chat/x',
    );
    expect(claude.branches.status).toBe('indeterminate');
  });
});
