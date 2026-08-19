import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { normalizeClaudeConversation } from '../src/adapters/claude/normalize';
import { freezeConversation } from '../src/model/conversation';
import {
  createWorkingState,
  setIncluded,
  setWorkingText,
  type WorkingState,
} from '../src/operations/working';
import {
  CONTINUATION_HEADER,
  fileNameFor,
  generateCleaned,
  renderJson,
  renderMarkdown,
  renderPlainText,
} from '../src/operations/transcript';
import { chatgptRich, chatgptShort } from './fixtures/chatgpt';
import { claudeRich } from './fixtures/claude';

function loadChatGpt(fixture: unknown = chatgptShort): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(fixture, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    ),
  );
}

function loadClaude(): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeClaudeConversation(claudeRich, {
        url: 'https://claude.ai/chat/x',
        method: 'test',
      }),
    ),
  );
}

describe('transcript labels', () => {
  it('labels each message with the historical speaker', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt()));

    expect(text).toContain('**User:**');
    expect(text).toContain('**Assistant:**');
    expect(text.indexOf('**User:**')).toBeLessThan(text.indexOf('**Assistant:**'));
  });

  it('uses plain labels in text mode', () => {
    const text = renderPlainText(generateCleaned(loadChatGpt()));

    expect(text).toContain('User:');
    expect(text).toContain('Assistant:');
    expect(text).not.toContain('**User:**');
  });

  it('keeps the speakers in the right order', () => {
    const conversation = generateCleaned(loadChatGpt());
    expect(conversation.turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });
});

describe('Markdown and code blocks survive', () => {
  it('keeps a fenced code block exactly as written', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt(chatgptRich)));

    expect(text).toContain('```ts');
    expect(text).toContain('export function clean(turns: Turn[]) {');
    expect(text).toContain('  return turns.filter((t) => t.included);');
    expect(text).toContain('```');
  });

  it('keeps headings, emphasis, lists and tables', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt(chatgptRich)));

    expect(text).toContain('## Steps');
    expect(text).toContain('1. **Read** the conversation');
    expect(text).toContain('2. *Clean* it');
    expect(text).toContain('| Step | Owner |');
  });

  it('does not flatten a code block into plain prose', () => {
    const text = renderPlainText(generateCleaned(loadChatGpt(chatgptRich)));
    // Plain-text mode still preserves the source, including the fences.
    expect(text).toContain('```ts');
    expect(text).toContain('\n');
  });

  it('preserves Claude code blocks too', () => {
    const text = renderMarkdown(generateCleaned(loadClaude()));
    expect(text).toContain('```ts');
    expect(text).toContain('interface Turn {');
  });
});

describe('the continuation header', () => {
  it('is left out by default', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt()));
    expect(text).not.toContain('transcript of an earlier conversation');
  });

  it('is added on request, at the top', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt()), {
      includeHeader: true,
    });
    expect(text.startsWith(CONTINUATION_HEADER)).toBe(true);
  });

  it('can be replaced with wording the user supplies', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt()), {
      includeHeader: true,
      headerText: 'Previous chat follows.',
    });
    expect(text.startsWith('Previous chat follows.')).toBe(true);
    expect(text).not.toContain(CONTINUATION_HEADER);
  });
});

describe('attachments', () => {
  it('notes attachment names without inventing content', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt(chatgptRich)));
    expect(text).toContain('[Attached: spec.pdf]');
  });

  it('can be left out', () => {
    const text = renderMarkdown(generateCleaned(loadChatGpt(chatgptRich)), {
      includeAttachments: false,
    });
    expect(text).not.toContain('[Attached:');
  });
});

describe('the transcript reflects the working copy', () => {
  it('omits excluded turns and uses edited text', () => {
    let state = loadChatGpt();
    state = setIncluded(state, 'chatgpt-3', false);
    state = setWorkingText(state, 'chatgpt-0', 'A much shorter question.');

    const text = renderMarkdown(generateCleaned(state));
    expect(text).toContain('A much shorter question.');
    expect(text).not.toContain('trademarks');
  });

  it('invents nothing: every line comes from a turn', () => {
    const state = loadChatGpt();
    const conversation = generateCleaned(state);
    const text = renderMarkdown(conversation);

    for (const turn of conversation.turns) {
      expect(text).toContain(turn.workingText.trim());
    }
    // Labels, blank lines and turn text only.
    const stripped = conversation.turns
      .reduce((acc, t) => acc.replace(t.workingText.trim(), ''), text)
      .replace(/\*\*(User|Assistant):\*\*/g, '')
      .trim();
    expect(stripped).toBe('');
  });
});

describe('what is copied matches what is previewed', () => {
  it('renders the same string for preview and copy', () => {
    const state = loadChatGpt(chatgptRich);
    const conversation = generateCleaned(state);
    const options = { includeHeader: true };

    // The panel renders once and uses the result for both, so the guarantee
    // is that rendering is deterministic and free of side effects.
    const first = renderMarkdown(conversation, options);
    const second = renderMarkdown(conversation, options);

    expect(second).toBe(first);
    expect(renderMarkdown(generateCleaned(state), options)).toBe(first);
  });
});

describe('JSON export', () => {
  it('keeps the internal message structure', () => {
    const state = loadChatGpt(chatgptRich);
    const parsed = JSON.parse(renderJson(generateCleaned(state), state));

    expect(parsed.chatThreadsVersion).toBe(1);
    expect(parsed.source.provider).toBe('chatgpt');
    expect(Array.isArray(parsed.messages)).toBe(true);
    expect(parsed.messages[0]).toMatchObject({ sequence: 0, role: 'user' });
    expect(parsed.messages[0].text).toContain('three things at once');
  });

  it('is valid JSON even when the conversation contains quotes and braces', () => {
    const state = loadChatGpt(chatgptRich);
    expect(() =>
      JSON.parse(renderJson(generateCleaned(state), state)),
    ).not.toThrow();
  });
});

describe('file names', () => {
  it('makes a safe file name from the title', () => {
    expect(fileNameFor(generateCleaned(loadChatGpt()), 'md')).toBe(
      'cleaned-conversation.md',
    );
    expect(
      fileNameFor(
        { id: 'x', kind: 'topic', title: 'Conversation 2: GitHub / Promotion!', turns: [] },
        'txt',
      ),
    ).toBe('conversation-2-github-promotion.txt');
  });
});
