import { describe, expect, it } from 'vitest';
import {
  ChatGptFormatError,
  normalizeChatGptConversation,
} from '../src/adapters/chatgpt/normalize';
import {
  chatgptBranched,
  chatgptEmptyMapping,
  chatgptMalformed,
  chatgptMultimodal,
  chatgptNoCurrentNode,
  chatgptRich,
  chatgptShort,
  chatgptUnknownContentType,
} from './fixtures/chatgpt';

const options = { url: 'https://chatgpt.com/c/conv-short', method: 'test' };

describe('ChatGPT normalization', () => {
  it('produces the common representation', () => {
    const c = normalizeChatGptConversation(chatgptShort, options);

    expect(c.provider).toBe('chatgpt');
    expect(c.conversationId).toBe('conv-short');
    expect(c.title).toBe('Naming a side project');
    expect(c.turns).toHaveLength(4);
    expect(c.retrieval.completeness).toBe('complete');
  });

  it('preserves turn order and roles', () => {
    const c = normalizeChatGptConversation(chatgptShort, options);

    expect(c.turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(c.turns.map((t) => t.sequence)).toEqual([0, 1, 2, 3]);
    expect(c.turns[0]?.originalText).toContain('tidies up chat logs');
    expect(c.turns[3]?.originalText).toContain('trademarks');
  });

  it('seeds the working copy from the original text', () => {
    const c = normalizeChatGptConversation(chatgptShort, options);
    for (const turn of c.turns) {
      expect(turn.workingText).toBe(turn.originalText);
      expect(turn.edited).toBe(false);
      expect(turn.included).toBe(true);
      expect(turn.assignment).toBe('unassigned');
    }
  });

  it('leaves out the system message', () => {
    const c = normalizeChatGptConversation(chatgptShort, options);
    const all = c.turns.map((t) => t.originalText).join('\n');
    expect(all).not.toContain('You are a helpful assistant');
  });

  it('follows only the branch the page is showing', () => {
    const c = normalizeChatGptConversation(chatgptBranched, {
      ...options,
      url: 'https://chatgpt.com/c/conv-branch',
    });

    const all = c.turns.map((t) => t.originalText).join('\n');
    expect(all).not.toContain('DISCARDED BRANCH');
    expect(all).toContain('Orderly.');
    expect(c.turns).toHaveLength(3);
  });

  it('keeps Markdown and code blocks intact', () => {
    const c = normalizeChatGptConversation(chatgptRich, options);
    const assistant = c.turns.find((t) => t.originalText.includes('```ts'));

    expect(assistant).toBeDefined();
    expect(assistant?.originalText).toContain('## Steps');
    expect(assistant?.originalText).toContain('**Read**');
    expect(assistant?.originalText).toContain(
      'return turns.filter((t) => t.included);',
    );
    expect(assistant?.originalText).toContain('| Step | Owner |');
  });

  it('does not truncate a very long prompt', () => {
    const c = normalizeChatGptConversation(chatgptRich, options);
    const long = c.turns[0];

    expect(long?.role).toBe('user');
    expect(long?.originalText.length).toBeGreaterThan(2000);
    expect(long?.originalText).toContain('Please keep them separate.');
  });

  it('records attachment metadata', () => {
    const c = normalizeChatGptConversation(chatgptRich, options);
    const withFile = c.turns.find((t) => t.attachments.length > 0);

    expect(withFile?.attachments[0]).toMatchObject({
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 51_200,
    });
  });

  it('does not collect model reasoning or tool calls', () => {
    const c = normalizeChatGptConversation(chatgptRich, options);
    const all = c.turns.map((t) => t.originalText).join('\n');

    expect(all).not.toContain('INTERNAL REASONING');
    expect(all).not.toContain('print("tool call")');
  });

  it('does not collect messages ChatGPT hides from the transcript', () => {
    const c = normalizeChatGptConversation(chatgptMultimodal, options);
    const all = c.turns.map((t) => t.originalText).join('\n');

    expect(all).not.toContain('HIDDEN CONTEXT');
    expect(c.turns).toHaveLength(2);
  });

  it('keeps the text of a multimodal turn and notes the image', () => {
    const c = normalizeChatGptConversation(chatgptMultimodal, options);

    expect(c.turns[0]?.originalText).toBe('What plant is this?');
    expect(c.turns[0]?.attachments).toEqual([{ name: 'image' }]);
  });

  it('warns instead of guessing when the displayed branch is unknown', () => {
    const c = normalizeChatGptConversation(chatgptNoCurrentNode, options);

    expect(c.retrieval.completeness).not.toBe('complete');
    expect(c.retrieval.warnings.join(' ')).toMatch(/did not say which reply/i);
    expect(c.turns.length).toBeGreaterThan(0);
  });

  it('reports unknown content types rather than dropping them silently', () => {
    const c = normalizeChatGptConversation(chatgptUnknownContentType, options);

    expect(c.retrieval.completeness).toBe('unverified');
    expect(c.retrieval.warnings.join(' ')).toContain('holographic_projection');
  });

  it('rejects a payload that is not a conversation', () => {
    expect(() => normalizeChatGptConversation(chatgptMalformed, options)).toThrow(
      ChatGptFormatError,
    );
    expect(() => normalizeChatGptConversation(null, options)).toThrow(
      ChatGptFormatError,
    );
    expect(() =>
      normalizeChatGptConversation(chatgptEmptyMapping, options),
    ).toThrow(ChatGptFormatError);
  });

  it('names the problem when the format is unrecognized', () => {
    try {
      normalizeChatGptConversation(chatgptMalformed, options);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ChatGptFormatError);
      expect((err as ChatGptFormatError).detail).toBe('missing "mapping"');
    }
  });
});
