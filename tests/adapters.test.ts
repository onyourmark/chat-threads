/**
 * Adapter selection and the URL rules each adapter owns.
 *
 * These run in Node with no `document`, which also checks that an adapter
 * degrades sensibly when it is used outside a page.
 */

import { describe, expect, it } from 'vitest';
import { ChatGptAdapter } from '../src/adapters/chatgpt';
import { ClaudeAdapter } from '../src/adapters/claude';
import { adapterForUrl, providerForUrl, providerLabel } from '../src/adapters/registry';
import { conversationIdFromUrl as chatgptId } from '../src/adapters/chatgpt/api';
import { conversationIdFromUrl as claudeId } from '../src/adapters/claude/api';
import { activeBranch } from '../src/adapters/branch';

describe('choosing an adapter', () => {
  it('recognizes ChatGPT', () => {
    for (const url of [
      'https://chatgpt.com/c/abc-123',
      'https://chatgpt.com/',
      'https://chat.openai.com/c/abc-123',
      'https://www.chatgpt.com/c/abc-123',
    ]) {
      expect(providerForUrl(url)).toBe('chatgpt');
    }
  });

  it('recognizes Claude', () => {
    for (const url of ['https://claude.ai/chat/abc-123', 'https://claude.ai/']) {
      expect(providerForUrl(url)).toBe('claude');
    }
  });

  it('does not claim sites it does not support', () => {
    for (const url of [
      'https://example.com/',
      'https://chatgpt.com.evil.example/c/1',
      'https://notclaude.ai/chat/1',
      'https://gemini.google.com/',
      'not a url',
      '',
    ]) {
      expect(providerForUrl(url)).toBeNull();
      expect(adapterForUrl(url)).toBeNull();
    }
  });

  it('gives each provider a display name', () => {
    expect(providerLabel('chatgpt')).toBe('ChatGPT');
    expect(providerLabel('claude')).toBe('Claude');
  });
});

describe('finding the conversation id in a URL', () => {
  it('reads a ChatGPT conversation id', () => {
    expect(chatgptId('https://chatgpt.com/c/6f1a2b3c-1111-2222-3333-444455556666')).toBe(
      '6f1a2b3c-1111-2222-3333-444455556666',
    );
    expect(chatgptId('https://chatgpt.com/c/abc12345?model=x')).toBe('abc12345');
  });

  it('returns nothing for a page that is not a conversation', () => {
    expect(chatgptId('https://chatgpt.com/')).toBeUndefined();
    expect(chatgptId('https://chatgpt.com/gpts')).toBeUndefined();
    expect(chatgptId('nonsense')).toBeUndefined();
  });

  it('reads a Claude conversation id', () => {
    expect(claudeId('https://claude.ai/chat/6f1a2b3c-1111-2222-3333-444455556666')).toBe(
      '6f1a2b3c-1111-2222-3333-444455556666',
    );
  });

  it('returns nothing for a Claude page that is not a conversation', () => {
    expect(claudeId('https://claude.ai/')).toBeUndefined();
    expect(claudeId('https://claude.ai/projects/x')).toBeUndefined();
  });
});

describe('reporting failures usefully', () => {
  it('says the page is unsupported', async () => {
    const result = await new ChatGptAdapter().loadConversation('https://example.com');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unsupported-page');
    expect(result.adapter).toBe('chatgpt');
  });

  it('says there is no conversation open', async () => {
    const result = await new ClaudeAdapter().loadConversation('https://claude.ai/');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-conversation');
    expect(result.message).toMatch(/No active conversation found/i);
  });

  it('returns no identity when no conversation is open', () => {
    expect(new ChatGptAdapter().getConversationIdentity('https://chatgpt.com/')).toBeNull();
    expect(new ClaudeAdapter().getConversationIdentity('https://example.com')).toBeNull();
  });

  it('has no retrieval status before anything is loaded', () => {
    expect(new ChatGptAdapter().getRetrievalStatus()).toBeNull();
  });
});

describe('active branch reconstruction', () => {
  const nodes = new Map([
    ['a', { id: 'a', parentId: null }],
    ['b', { id: 'b', parentId: 'a' }],
    ['c', { id: 'c', parentId: 'b' }],
    ['other', { id: 'other', parentId: 'a' }],
  ]);

  it('walks from the displayed leaf back to the root, oldest first', () => {
    const result = activeBranch(nodes, 'c');
    expect(result.path.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(result.reliable).toBe(true);
  });

  it('leaves other branches out', () => {
    expect(activeBranch(nodes, 'c').path.map((n) => n.id)).not.toContain('other');
  });

  it('reports when the leaf is unknown instead of guessing', () => {
    const missing = activeBranch(nodes, undefined);
    expect(missing.path).toEqual([]);
    expect(missing.reliable).toBe(false);
    expect(missing.warning).toMatch(/which branch/i);

    const wrong = activeBranch(nodes, 'nope');
    expect(wrong.reliable).toBe(false);
    expect(wrong.warning).toMatch(/currently showing/i);
  });

  it('stops on a loop rather than running forever', () => {
    const looped = new Map([
      ['x', { id: 'x', parentId: 'y' }],
      ['y', { id: 'y', parentId: 'x' }],
    ]);
    const result = activeBranch(looped, 'x');
    expect(result.reliable).toBe(false);
    expect(result.warning).toMatch(/loop/i);
  });

  it('reports a gap when a parent is missing', () => {
    const gapped = new Map([['z', { id: 'z', parentId: 'missing' }]]);
    const result = activeBranch(gapped, 'z');
    expect(result.reliable).toBe(false);
    expect(result.warning).toMatch(/not included/i);
  });
});
