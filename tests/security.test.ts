/**
 * Security tests.
 *
 * Conversation text, provider payloads and model replies all arrive from
 * outside the extension. These check that none of them can become code, and
 * that a malformed one is rejected rather than half-applied.
 */

import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { normalizeClaudeConversation } from '../src/adapters/claude/normalize';
import { freezeConversation } from '../src/model/conversation';
import {
  parseAdapterResult,
  parseBackgroundRequest,
  parseIdentity,
  parsePanelRequest,
  parseSourceConversation,
} from '../src/model/messages';
import { createWorkingState } from '../src/operations/working';
import { generateCleaned, renderMarkdown } from '../src/operations/transcript';
import { parseModelJson, validateTopicProposal } from '../src/ai/schema';
import { chatgptUnsafeContent } from './fixtures/chatgpt';
import { claudeUnsafeContent } from './fixtures/claude';

describe('unsafe conversation content is carried as text', () => {
  it('keeps markup in a ChatGPT turn as literal characters', () => {
    const c = normalizeChatGptConversation(chatgptUnsafeContent, {
      url: 'https://chatgpt.com/c/x',
      method: 'test',
    });

    // Preserved exactly — this is the user's conversation, not markup we run.
    expect(c.turns[0]?.originalText).toContain('<script>alert("xss")</script>');
    expect(c.turns[0]?.originalText).toContain('onerror=');
    // It is a string, so there is nothing to execute.
    expect(typeof c.turns[0]?.originalText).toBe('string');
  });

  it('keeps markup in a Claude turn as literal characters', () => {
    const c = normalizeClaudeConversation(claudeUnsafeContent, {
      url: 'https://claude.ai/chat/x',
      method: 'test',
    });
    expect(c.turns[0]?.originalText).toContain('<script>');
    expect(typeof c.turns[0]?.originalText).toBe('string');
  });

  it('does not let conversation text change the transcript structure', () => {
    const state = createWorkingState(
      freezeConversation(
        normalizeChatGptConversation(chatgptUnsafeContent, {
          url: 'https://chatgpt.com/c/x',
          method: 'test',
        }),
      ),
    );
    const text = renderMarkdown(generateCleaned(state));

    // Exactly two speaker labels: the content did not inject a third.
    expect(text.match(/\*\*(User|Assistant):\*\*/g)).toHaveLength(2);
    expect(text).toContain('<script>alert("xss")</script>');
  });
});

describe('messages crossing an extension boundary are validated', () => {
  it('accepts only the known request types', () => {
    expect(parsePanelRequest({ type: 'ct:ping' })).toEqual({ type: 'ct:ping' });
    expect(parsePanelRequest({ type: 'ct:load' })).toEqual({ type: 'ct:load' });

    for (const bad of [
      null,
      'ct:load',
      42,
      [],
      { type: 'ct:evil' },
      { type: 123 },
      {},
      { notAType: 'ct:load' },
    ]) {
      expect(parsePanelRequest(bad)).toBeNull();
    }
  });

  it('accepts only the known background request types', () => {
    expect(parseBackgroundRequest({ type: 'bg:get-active-tab' })).toEqual({
      type: 'bg:get-active-tab',
    });
    expect(parseBackgroundRequest({ type: 'bg:anything-else' })).toBeNull();
    expect(parseBackgroundRequest(undefined)).toBeNull();
  });

  it('rejects an adapter result that is not one', () => {
    for (const bad of [
      null,
      'ok',
      { ok: 'yes' },
      { ok: true },
      { ok: true, conversation: null },
      { ok: true, conversation: { provider: 'evil', url: 'x', turns: [] } },
      { ok: false },
      { ok: false, adapter: 'evil', code: 'network', message: 'x' },
    ]) {
      expect(parseAdapterResult(bad)).toBeNull();
    }
  });

  it('does not carry unexpected fields through a boundary', () => {
    const result = parseAdapterResult({
      ok: true,
      conversation: {
        provider: 'chatgpt',
        url: 'https://chatgpt.com/c/x',
        turns: [
          {
            id: 't0',
            role: 'user',
            originalText: 'hello',
            // Fields an attacker might hope to smuggle through.
            __proto__: { polluted: true },
            onload: 'alert(1)',
            extraFunction: 'not a function anyway',
          },
        ],
        retrieval: { completeness: 'complete', method: 'x', detail: 'y', warnings: [] },
      },
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    const turn = result.conversation.turns[0]!;
    expect(Object.keys(turn).sort()).toEqual(
      [
        'assignment',
        'assignmentOverridden',
        'attachments',
        'edited',
        'id',
        'included',
        'originalText',
        'parentMessageId',
        'provider',
        'providerConversationId',
        'providerMessageId',
        'role',
        'sequence',
        'timestamp',
        'uncertain',
        'workingText',
      ].sort(),
    );
    expect((turn as unknown as Record<string, unknown>).onload).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops malformed turns rather than accepting them', () => {
    const conversation = parseSourceConversation({
      provider: 'claude',
      url: 'https://claude.ai/chat/x',
      turns: [
        { id: 'a', role: 'user', originalText: 'kept' },
        { id: 'b', role: 'wizard', originalText: 'bad role' },
        { id: 'c', originalText: 'no role' },
        'not an object',
        null,
      ],
      retrieval: { completeness: 'complete', method: 'x', detail: '', warnings: [] },
    });

    expect(conversation?.turns).toHaveLength(1);
    expect(conversation?.turns[0]?.originalText).toBe('kept');
  });

  it('falls back to a safe completeness rather than trusting a made-up one', () => {
    const conversation = parseSourceConversation({
      provider: 'chatgpt',
      url: 'https://chatgpt.com/c/x',
      turns: [],
      retrieval: {
        completeness: 'definitely-complete-trust-me',
        method: 'x',
        detail: '',
        warnings: [],
      },
    });
    expect(conversation?.retrieval.completeness).toBe('unverified');
  });

  it('rejects an identity for an unknown provider', () => {
    expect(parseIdentity({ provider: 'chatgpt', url: 'https://x' })).toEqual({
      provider: 'chatgpt',
      conversationId: undefined,
      title: undefined,
      url: 'https://x',
    });
    expect(parseIdentity({ provider: 'evil.com', url: 'https://x' })).toBeNull();
    expect(parseIdentity({ provider: 'chatgpt' })).toBeNull();
  });
});

describe('malformed model output cannot execute or corrupt state', () => {
  it('never evaluates the reply', () => {
    // A reply that would be dangerous under eval is simply not JSON.
    expect(parseModelJson('globalThis.pwned = true')).toBeNull();
    expect((globalThis as Record<string, unknown>).pwned).toBeUndefined();
  });

  it('rejects JSON that does not match the contract', () => {
    const attempts = [
      '{"topics":"not an array","assignments":[]}',
      '{"topics":[],"assignments":[]}',
      '{"assignments":[{"turn":0,"topic":"t1"}]}',
      '{"topics":[{"id":"t1","name":"A"}]}',
      'null',
      '[]',
    ];

    for (const attempt of attempts) {
      const parsed = parseModelJson(attempt);
      const result = validateTopicProposal(parsed, [0, 1]);
      expect(result.ok).toBe(false);
    }
  });

  it('ignores prototype pollution attempts in a proposal', () => {
    const parsed = parseModelJson(
      '{"topics":[{"id":"t1","name":"A"}],"assignments":[{"turn":0,"topic":"t1"}],"__proto__":{"polluted":true}}',
    );
    const result = validateTopicProposal(parsed, [0]);

    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not treat a topic name as markup', () => {
    const parsed = parseModelJson(
      '{"topics":[{"id":"t1","name":"<img src=x onerror=alert(1)>"}],"assignments":[{"turn":0,"topic":"t1"}]}',
    );
    const result = validateTopicProposal(parsed, [0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Kept as text; the panel renders it through React, never as HTML.
    expect(result.proposal.topics[0]?.name).toBe('<img src=x onerror=alert(1)>');
    expect(typeof result.proposal.topics[0]?.name).toBe('string');
  });

  it('caps how long a topic name can be', () => {
    const parsed = parseModelJson(
      JSON.stringify({
        topics: [{ id: 't1', name: 'A'.repeat(5000) }],
        assignments: [{ turn: 0, topic: 't1' }],
      }),
    );
    const result = validateTopicProposal(parsed, [0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.topics[0]!.name.length).toBeLessThanOrEqual(80);
  });
});

describe('the source object cannot be written to', () => {
  it('throws on an attempt to modify a retrieved turn', () => {
    const source = freezeConversation(
      normalizeChatGptConversation(chatgptUnsafeContent, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    );

    expect(() => {
      (source.turns as unknown as unknown[]).push({});
    }).toThrow();
    expect(() => {
      (source.retrieval as { method: string }).method = 'tampered';
    }).toThrow();
  });
});
