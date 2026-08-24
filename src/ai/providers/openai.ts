/**
 * Topic analysis through the OpenAI Chat Completions API.
 *
 * Raw `fetch` for the same reason as the Anthropic analyzer: one optional
 * feature does not justify an SDK bundle inside a side panel.
 *
 * This file does one thing — send a prompt and hand back the reply as text.
 * What to ask, how many times to ask it for a long conversation, and how to
 * read the answer all live above it, in `run.ts`, so the behaviour is the same
 * whichever provider the user chose.
 *
 * The key is supplied by the user, sent only to api.openai.com, and only when
 * the user presses Find Topics and confirms.
 */

import { BaseAnalyzer } from '../analyzer';
import { describeHttpFailure, readErrorBody } from './errors';
import type { AnalyzeOptions, ModelRequest, ModelResult } from '../types';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const PROVIDER = 'OpenAI';

export class OpenAiAnalyzer extends BaseAnalyzer {
  readonly id = 'openai';
  readonly label = PROVIDER;
  readonly endpointOrigin = 'https://api.openai.com';

  /**
   * A true private field, not TypeScript's `private`, which is only a
   * compile-time marker: the key must not be enumerable or serializable, so
   * that logging or stringifying an analyzer can never reveal it.
   */
  readonly #apiKey: string;
  readonly #model: string;

  constructor(apiKey: string, model: string) {
    super();
    this.#apiKey = apiKey;
    this.#model = model;
  }

  async complete(
    request: ModelRequest,
    options: AnalyzeOptions = {},
  ): Promise<ModelResult> {
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: options.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.#model,
          // JSON mode is supported far more widely than per-model schema
          // enforcement, and the reply is validated upstream regardless.
          // No output cap is sent: Chat Completions has renamed that field
          // once already, and naming the wrong one is a rejected request.
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      });
    } catch {
      if (options.signal?.aborted) {
        return { ok: false, errors: ['The request was cancelled.'] };
      }
      return {
        ok: false,
        errors: [
          'Could not reach the OpenAI API. Check your connection and try again.',
        ],
      };
    }

    if (!res.ok) {
      const body = await readErrorBody(res);
      return {
        ok: false,
        errors: [describeHttpFailure(PROVIDER, res.status, body)],
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, errors: ['The OpenAI API reply was not readable.'] };
    }

    if (readFinishReason(body) === 'length') {
      return {
        ok: false,
        errors: [
          'The model ran out of room before finishing its reply. Try again, or exclude some turns.',
        ],
      };
    }

    const text = readText(body);
    if (!text) {
      return { ok: false, errors: ['The OpenAI API returned no text.'] };
    }

    return { ok: true, text };
  }
}

function firstChoice(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  return typeof first === 'object' && first !== null
    ? (first as Record<string, unknown>)
    : null;
}

function readFinishReason(body: unknown): string | null {
  const choice = firstChoice(body);
  const reason = choice?.finish_reason;
  return typeof reason === 'string' ? reason : null;
}

function readText(body: unknown): string {
  const choice = firstChoice(body);
  const message = choice?.message;
  if (typeof message !== 'object' || message === null) return '';
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}
