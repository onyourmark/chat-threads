/**
 * Where the API key goes, and where it must never go.
 *
 * The key belongs to the user and is only ever meant to reach the model
 * provider they chose. These tests drive the real provider clients against a
 * stubbed `fetch` and assert both halves: that the key reaches exactly one
 * destination, and that it appears nowhere else — not in the request body, not
 * in an error message, not in anything the panel would display.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAnalyzer } from '../src/ai/providers/anthropic';
import { OpenAiAnalyzer } from '../src/ai/providers/openai';
import { buildAnalysisInput } from '../src/ai/prompt';
import { createAnalyzer } from '../src/ai/apply';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { createWorkingState } from '../src/operations/working';
import { chatgptMixedTopics } from './fixtures/chatgpt';

/**
 * A key shaped like a real one, so a substring search through request bodies
 * and error text is meaningful.
 *
 * Assembled at runtime rather than written as a literal, so that the repository
 * contains no string matching the shape of an API key and the secret scan in CI
 * can stay strict without an allowlist.
 */
const SECRET = ['sk', 'test', '0123456789abcdef0123456789abcdef'].join('-');

interface Captured {
  url: string;
  init: RequestInit;
}

function stubFetch(response: { status?: number; body?: unknown }): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({ url: String(url), init });
    return {
      ok: (response.status ?? 200) < 400,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    } as unknown as Response;
  });
  return captured;
}

function input() {
  const state = createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    ),
  );
  return buildAnalysisInput(state);
}

const VALID_BODY_OPENAI = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          topics: [{ id: 't1', name: 'A', description: 'x' }],
          assignments: [{ turn: 0, topic: 't1', uncertain: false }],
        }),
      },
    },
  ],
};

const VALID_BODY_ANTHROPIC = {
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        topics: [{ id: 't1', name: 'A', description: 'x' }],
        assignments: [{ turn: 0, topic: 't1', uncertain: false }],
      }),
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('the key reaches exactly one destination', () => {
  it('OpenAI: only api.openai.com, only in the Authorization header', async () => {
    const captured = stubFetch({ body: VALID_BODY_OPENAI });
    await new OpenAiAnalyzer(SECRET, 'gpt-4o-mini').analyze(input());

    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(new URL(call.url).origin).toBe('https://api.openai.com');

    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    // Exactly one header carries it.
    const carrying = Object.entries(headers).filter(([, v]) =>
      String(v).includes(SECRET),
    );
    expect(carrying).toHaveLength(1);

    // And it is not in the body.
    expect(String(call.init.body)).not.toContain(SECRET);
  });

  it('Anthropic: only api.anthropic.com, only in the x-api-key header', async () => {
    const captured = stubFetch({ body: VALID_BODY_ANTHROPIC });
    await new AnthropicAnalyzer(SECRET, 'claude-opus-5').analyze(input());

    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(new URL(call.url).origin).toBe('https://api.anthropic.com');

    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(SECRET);
    expect(String(call.init.body)).not.toContain(SECRET);
  });

  it('never puts the key in the URL, where it could be logged', async () => {
    for (const analyzer of [
      new OpenAiAnalyzer(SECRET, 'gpt-4o-mini'),
      new AnthropicAnalyzer(SECRET, 'claude-opus-5'),
    ]) {
      const captured = stubFetch({ body: VALID_BODY_OPENAI });
      await analyzer.analyze(input());
      expect(captured[0]!.url).not.toContain(SECRET);
      vi.unstubAllGlobals();
    }
  });

  it('contacts nothing at all until analyze is called', async () => {
    const captured = stubFetch({ body: VALID_BODY_OPENAI });
    createAnalyzer({ providerId: 'openai', apiKey: SECRET, model: 'gpt-4o-mini' });
    buildAnalysisInput(
      createWorkingState(
        freezeConversation(
          normalizeChatGptConversation(chatgptMixedTopics, {
            url: 'https://chatgpt.com/c/x',
            method: 'test',
          }),
        ),
      ),
    );

    expect(captured).toHaveLength(0);
  });
});

describe('the key never appears in anything shown to the user', () => {
  const failures: Array<[string, number]> = [
    ['rejected key', 401],
    ['forbidden', 403],
    ['rate limited', 429],
    ['bad request', 400],
    ['server error', 500],
  ];

  for (const [name, status] of failures) {
    it(`OpenAI ${name}: the error text is key-free`, async () => {
      stubFetch({ status, body: { error: { message: `key ${SECRET} bad` } } });
      const result = await new OpenAiAnalyzer(SECRET, 'gpt-4o-mini').analyze(
        input(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.errors)).not.toContain(SECRET);
      expect(result.errors.join(' ')).not.toContain('sk-');
    });

    it(`Anthropic ${name}: the error text is key-free`, async () => {
      stubFetch({ status, body: { error: { message: `key ${SECRET} bad` } } });
      const result = await new AnthropicAnalyzer(SECRET, 'claude-opus-5').analyze(
        input(),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(JSON.stringify(result.errors)).not.toContain(SECRET);
    });
  }

  it('a network failure does not leak the key either', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error(`connect failed for ${SECRET}`);
    });

    for (const analyzer of [
      new OpenAiAnalyzer(SECRET, 'gpt-4o-mini'),
      new AnthropicAnalyzer(SECRET, 'claude-opus-5'),
    ]) {
      const result = await analyzer.analyze(input());
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(JSON.stringify(result.errors)).not.toContain(SECRET);
    }
  });

  it('an unreadable reply does not leak the key', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error(`parse failed ${SECRET}`);
      },
    }));

    const result = await new OpenAiAnalyzer(SECRET, 'gpt-4o-mini').analyze(
      input(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.errors)).not.toContain(SECRET);
  });
});

describe('the key is not part of the conversation data', () => {
  it('is absent from the payload built for the model', () => {
    const payload = JSON.stringify(input());
    expect(payload).not.toContain(SECRET);
    expect(payload).not.toContain('sk-');
  });

  it('an analyzer does not expose the key as a readable property', () => {
    const analyzer = new OpenAiAnalyzer(SECRET, 'gpt-4o-mini');
    // Nothing a caller can reach by enumerating the object.
    expect(JSON.stringify(Object.keys(analyzer))).not.toContain('apiKey');
    expect(JSON.stringify(analyzer)).not.toContain(SECRET);
  });
});
