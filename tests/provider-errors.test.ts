/**
 * What the panel says when a provider refuses.
 *
 * This file exists because of one specific wrong sentence. A real run on a
 * long conversation was refused for exceeding the model's context window, and
 * Chat Threads told the user "The OpenAI API rejected the request. Check the
 * model name." The model name was correct; every HTTP 400 had been folded into
 * one guess. The user changed the model, changed the key, and got nowhere.
 *
 * So each failure a user can actually hit is driven through the real client
 * against a stubbed `fetch`, and the resulting sentence is checked for the
 * thing that would tell them what to do next — and, in every case, for the
 * absence of their API key.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAnalyzer } from '../src/ai/providers/anthropic';
import { OpenAiAnalyzer } from '../src/ai/providers/openai';
import {
  classifyProviderError,
  readProviderError,
  redactSecrets,
  sanitizeProviderMessage,
} from '../src/ai/providers/errors';
import type { ModelRequest } from '../src/ai/types';

/**
 * A key shaped like a real one, assembled at runtime so the repository holds
 * no string matching the shape of an API key and CI's secret scan can stay
 * strict without an allowlist.
 */
const SECRET = ['sk', 'test', '0123456789abcdef0123456789abcdef'].join('-');

const REQUEST: ModelRequest = {
  stage: 'single',
  system: 'system',
  user: 'user',
  maxOutputTokens: 1000,
};

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    async () =>
      ({
        ok: status < 400,
        status,
        json: async () => body,
      }) as unknown as Response,
  );
}

async function openaiError(status: number, body: unknown): Promise<string> {
  stubFetch(status, body);
  const result = await new OpenAiAnalyzer(SECRET, 'gpt-4o-mini').complete(
    REQUEST,
  );
  if (result.ok) throw new Error('expected a failure');
  return result.errors.join(' ');
}

async function anthropicError(status: number, body: unknown): Promise<string> {
  stubFetch(status, body);
  const result = await new AnthropicAnalyzer(SECRET, 'claude-opus-5').complete(
    REQUEST,
  );
  if (result.ok) throw new Error('expected a failure');
  return result.errors.join(' ');
}

afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------------------- OpenAI ------

describe('OpenAI failures are told apart', () => {
  it('says the request was too large, not that the model name is wrong', async () => {
    const message = await openaiError(400, {
      error: {
        message:
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 214531 tokens. Please reduce the length of the messages.",
        type: 'invalid_request_error',
        code: 'context_length_exceeded',
      },
    });

    expect(message).toMatch(/too large/i);
    expect(message).not.toMatch(/check the model name/i);
  });

  it('says the model is wrong when the model really is wrong', async () => {
    const message = await openaiError(404, {
      error: {
        message: 'The model `gpt-4o-minii` does not exist',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });

    expect(message).toMatch(/model name/i);
    expect(message).not.toMatch(/too large/i);
  });

  it('says the key was rejected', async () => {
    const message = await openaiError(401, {
      error: {
        message: 'Incorrect API key provided.',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });

    expect(message).toMatch(/rejected that API key/i);
  });

  it('tells a spent quota apart from a rate limit', async () => {
    const quota = await openaiError(429, {
      error: {
        message: 'You exceeded your current quota, please check your plan and billing details.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      },
    });
    expect(quota).toMatch(/out of credit or over its quota/i);

    const limit = await openaiError(429, {
      error: {
        message: 'Rate limit reached for gpt-4o-mini.',
        type: 'requests',
        code: 'rate_limit_exceeded',
      },
    });
    expect(limit).toMatch(/rate limiting/i);
    expect(limit).not.toMatch(/quota/i);
  });

  it('says the provider had the problem, not the user', async () => {
    const message = await openaiError(500, {
      error: { message: 'The server had an error.', type: 'server_error' },
    });

    expect(message).toMatch(/problem at its end/i);
  });

  it('passes on a malformed-request complaint it cannot classify', async () => {
    const message = await openaiError(400, {
      error: {
        message: 'Unrecognised request argument supplied: banana',
        type: 'invalid_request_error',
        code: 'unknown_parameter',
      },
    });

    expect(message).toMatch(/malformed/i);
    expect(message).toContain('banana');
  });

  it('still says something useful when the body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        ({
          ok: false,
          status: 418,
          json: async () => {
            throw new Error('not json');
          },
        }) as unknown as Response,
    );

    const result = await new OpenAiAnalyzer(SECRET, 'gpt-4o-mini').complete(
      REQUEST,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('418');
  });
});

// ---------------------------------------------------------- Anthropic ------

describe('Anthropic failures are told apart', () => {
  it('says the prompt was too long', async () => {
    const message = await anthropicError(400, {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: 250000 tokens > 200000 maximum',
      },
    });

    expect(message).toMatch(/too large/i);
  });

  it('says the model is wrong', async () => {
    const message = await anthropicError(404, {
      type: 'error',
      error: {
        type: 'not_found_error',
        message: 'model: claude-nope',
      },
    });

    expect(message).toMatch(/model name/i);
  });

  it('says the key was rejected', async () => {
    const message = await anthropicError(401, {
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'invalid x-api-key',
      },
    });

    expect(message).toMatch(/rejected that API key/i);
  });

  it('says it is being rate limited', async () => {
    const message = await anthropicError(429, {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Number of requests' },
    });

    expect(message).toMatch(/rate limiting/i);
  });

  it('treats an overloaded provider as the provider\'s problem', async () => {
    const message = await anthropicError(529, {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    });

    expect(message).toMatch(/problem at its end/i);
  });
});

// ------------------------------------------------------------ secrets ------

describe('a provider error never carries the key', () => {
  const bodies: Array<[string, number, unknown]> = [
    [
      'a message quoting the key',
      401,
      { error: { message: `Incorrect API key provided: ${SECRET}.`, code: 'invalid_api_key' } },
    ],
    [
      'a malformed-request message quoting the key',
      400,
      { error: { message: `bad header authorization: Bearer ${SECRET}`, type: 'invalid_request_error' } },
    ],
    [
      'an unclassifiable message quoting the key',
      418,
      { error: { message: `teapot ${SECRET}` } },
    ],
  ];

  for (const [name, status, body] of bodies) {
    it(`OpenAI: ${name}`, async () => {
      const message = await openaiError(status, body);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('sk-');
    });

    it(`Anthropic: ${name}`, async () => {
      const message = await anthropicError(status, body);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('sk-');
    });
  }

  it('redacts key-shaped strings wherever they appear', () => {
    expect(redactSecrets(`key ${SECRET} here`)).not.toContain(SECRET);
    expect(redactSecrets('Bearer abcdefghijklmnop')).toContain('[redacted]');
    expect(redactSecrets('token a1b2c3d4e5f6g7h8i9j0k1l2m3')).toContain(
      '[redacted]',
    );
    // Ordinary words survive.
    expect(redactSecrets('context_length_exceeded')).toBe(
      'context_length_exceeded',
    );
  });

  it('flattens and clamps a provider sentence', () => {
    expect(sanitizeProviderMessage('a\n\nb\tc')).toBe('a b c');
    expect(sanitizeProviderMessage('x'.repeat(400)).length).toBeLessThanOrEqual(
      201,
    );
    expect(sanitizeProviderMessage(undefined)).toBe('');
    expect(sanitizeProviderMessage({ nested: true })).toBe('');
  });
});

// ------------------------------------------------------- classification ----

describe('classifying an error body directly', () => {
  it('reads code, type and message without trusting their shapes', () => {
    expect(readProviderError(null)).toEqual({ code: '', type: '', message: '' });
    expect(readProviderError({ error: 'a string' })).toEqual({
      code: '',
      type: '',
      message: '',
    });
    expect(readProviderError({ error: { code: 42, type: [], message: 7 } })).toEqual(
      { code: '', type: '', message: '' },
    );
  });

  it('lets the body override a coarse status code', () => {
    // A 400 that is really a context overflow.
    expect(
      classifyProviderError(400, {
        code: 'context_length_exceeded',
        type: 'invalid_request_error',
        message: '',
      }),
    ).toBe('too-large');

    // A 400 that is really a missing model.
    expect(
      classifyProviderError(400, {
        code: 'model_not_found',
        type: 'invalid_request_error',
        message: '',
      }),
    ).toBe('model');

    // A 400 with nothing else to go on.
    expect(
      classifyProviderError(400, { code: '', type: '', message: '' }),
    ).toBe('bad-request');
  });

  it('falls back on the status when there is no body at all', () => {
    const none = { code: '', type: '', message: '' };
    expect(classifyProviderError(401, none)).toBe('auth');
    expect(classifyProviderError(403, none)).toBe('auth');
    expect(classifyProviderError(404, none)).toBe('model');
    expect(classifyProviderError(429, none)).toBe('rate-limit');
    expect(classifyProviderError(503, none)).toBe('server');
    expect(classifyProviderError(418, none)).toBe('unknown');
  });
});
