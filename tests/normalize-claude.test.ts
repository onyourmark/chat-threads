import { describe, expect, it } from 'vitest';
import {
  ClaudeFormatError,
  normalizeClaudeConversation,
} from '../src/adapters/claude/normalize';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import {
  claudeBranched,
  claudeEmpty,
  claudeMalformed,
  claudeNoLeaf,
  claudeRich,
  claudeShort,
  claudeUnknownBlock,
} from './fixtures/claude';
import { chatgptShort } from './fixtures/chatgpt';

const options = { url: 'https://claude.ai/chat/claude-conv-short', method: 'test' };

describe('Claude normalization', () => {
  it('produces the common representation', () => {
    const c = normalizeClaudeConversation(claudeShort, options);

    expect(c.provider).toBe('claude');
    expect(c.conversationId).toBe('claude-conv-short');
    expect(c.title).toBe('Sorting out a reading list');
    expect(c.turns).toHaveLength(4);
    expect(c.retrieval.completeness).toBe('complete');
  });

  it('preserves turn order and maps senders to roles', () => {
    const c = normalizeClaudeConversation(claudeShort, options);

    expect(c.turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(c.turns.map((t) => t.sequence)).toEqual([0, 1, 2, 3]);
    expect(c.turns[0]?.originalText).toContain('reading list by difficulty');
  });

  it('treats the sentinel root parent as the start of the conversation', () => {
    const c = normalizeClaudeConversation(claudeShort, options);

    // A gap in the history would have produced a warning; there is none.
    expect(c.retrieval.warnings).toEqual([]);
    expect(c.turns).toHaveLength(4);
  });

  it('follows only the branch the page is showing', () => {
    const c = normalizeClaudeConversation(claudeBranched, options);
    const all = c.turns.map((t) => t.originalText).join('\n');

    expect(all).not.toContain('DISCARDED BRANCH');
    expect(all).toContain('Second answer, the one on screen.');
    expect(c.turns).toHaveLength(3);
  });

  it('keeps Markdown and code blocks intact', () => {
    const c = normalizeClaudeConversation(claudeRich, options);
    const assistant = c.turns.find((t) => t.originalText.includes('```ts'));

    expect(assistant?.originalText).toContain('interface Turn {');
    expect(assistant?.originalText).toContain('Edit a **copy**');
  });

  it('does not truncate a very long prompt', () => {
    const c = normalizeClaudeConversation(claudeRich, options);

    expect(c.turns[0]?.originalText.length).toBeGreaterThan(2000);
    expect(c.turns[0]?.originalText).toContain('Take them one at a time.');
  });

  it('does not collect thinking blocks or tool calls', () => {
    const c = normalizeClaudeConversation(claudeRich, options);
    const all = c.turns.map((t) => t.originalText).join('\n');

    expect(all).not.toContain('INTERNAL REASONING');
    expect(all).not.toContain('artifacts');
  });

  it('records attachments and pasted files', () => {
    const c = normalizeClaudeConversation(claudeRich, options);

    expect(c.turns[0]?.attachments[0]).toMatchObject({
      name: 'notes.md',
      mimeType: 'text/markdown',
      sizeBytes: 2048,
    });
    const withImage = c.turns.find((t) =>
      t.attachments.some((a) => a.name === 'screenshot.png'),
    );
    expect(withImage).toBeDefined();
  });

  it('reads timestamps', () => {
    const c = normalizeClaudeConversation(claudeShort, options);
    expect(c.turns[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('warns instead of guessing when the leaf pointer is missing', () => {
    const c = normalizeClaudeConversation(claudeNoLeaf, options);

    expect(c.retrieval.completeness).toBe('unverified');
    expect(c.retrieval.warnings.join(' ')).toMatch(/did not say which reply/i);
    expect(c.turns).toHaveLength(2);
  });

  it('keeps visible text when a block type is unrecognized, and says so', () => {
    const c = normalizeClaudeConversation(claudeUnknownBlock, options);

    expect(c.turns[1]?.originalText).toBe('Visible answer.');
    expect(c.retrieval.completeness).toBe('unverified');
    expect(c.retrieval.warnings.join(' ')).toContain('holographic_projection');
  });

  it('rejects a payload that is not a conversation', () => {
    expect(() => normalizeClaudeConversation(claudeMalformed, options)).toThrow(
      ClaudeFormatError,
    );
    expect(() => normalizeClaudeConversation(claudeEmpty, options)).toThrow(
      ClaudeFormatError,
    );
    expect(() => normalizeClaudeConversation('nope', options)).toThrow(
      ClaudeFormatError,
    );
  });
});

describe('both providers produce the same shape', () => {
  it('yields turns with identical fields regardless of provider', () => {
    const a = normalizeChatGptConversation(chatgptShort, {
      url: 'https://chatgpt.com/c/x',
      method: 'test',
    });
    const b = normalizeClaudeConversation(claudeShort, options);

    const fields = (o: object) => Object.keys(o).sort();
    expect(fields(a.turns[0] as object)).toEqual(fields(b.turns[0] as object));
    expect(fields(a.retrieval)).toEqual(fields(b.retrieval));

    // The only field that reveals where a conversation came from.
    expect(a.turns[0]?.provider).toBe('chatgpt');
    expect(b.turns[0]?.provider).toBe('claude');
  });
});
