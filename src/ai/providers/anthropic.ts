/**
 * Topic analysis through the Anthropic Messages API.
 *
 * Called with raw `fetch` rather than the Anthropic SDK on purpose: this is a
 * browser extension where one optional feature makes a bounded number of
 * requests, and pulling an SDK bundle into the side panel for that would be
 * the largest dependency in the project. The request shape below follows the
 * documented Messages API.
 *
 * This file does one thing — send a prompt and hand back the reply as text.
 * What to ask, and how a conversation too long for one request is divided, are
 * decided above it in `run.ts` and shared with the OpenAI client.
 *
 * The key is supplied by the user, sent only to api.anthropic.com, and only
 * when the user presses Find Topics and confirms.
 */

import { BaseAnalyzer } from '../analyzer';
import { describeHttpFailure, readErrorBody } from './errors';
import type { AnalyzeOptions, ModelRequest, ModelResult } from '../types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const PROVIDER = 'Anthropic';

export class AnthropicAnalyzer extends BaseAnalyzer {
  readonly id = 'anthropic';
  readonly label = PROVIDER;
  readonly endpointOrigin = 'https://api.anthropic.com';

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
          'x-api-key': this.#apiKey,
          'anthropic-version': API_VERSION,
          // Required for requests that originate in a browser context.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.#model,
          max_tokens: request.maxOutputTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          output_config: {
            // Classification, not open-ended reasoning: keep it cheap.
            effort: 'low',
            ...(request.schema
              ? { format: { type: 'json_schema', schema: request.schema } }
              : {}),
          },
        }),
      });
    } catch {
      if (options.signal?.aborted) {
        return { ok: false, errors: ['The request was cancelled.'] };
      }
      return {
        ok: false,
        errors: [
          'Could not reach the Anthropic API. Check your connection and try again.',
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
      return {
        ok: false,
        errors: ['The Anthropic API reply was not readable.'],
      };
    }

    const stopReason = readStopReason(body);
    if (stopReason === 'refusal') {
      return {
        ok: false,
        errors: ['The model declined to analyse this conversation.'],
      };
    }
    if (stopReason === 'max_tokens') {
      return {
        ok: false,
        errors: [
          'The model ran out of room before finishing its reply. Try again, or exclude some turns.',
        ],
      };
    }

    const text = readText(body);
    if (!text) {
      return { ok: false, errors: ['The Anthropic API returned no text.'] };
    }

    return { ok: true, text };
  }
}

function readStopReason(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const reason = (body as Record<string, unknown>).stop_reason;
  return typeof reason === 'string' ? reason : null;
}

/** Concatenate the text blocks of a Messages API response. */
function readText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const content = (body as Record<string, unknown>).content;
  if (!Array.isArray(content)) return '';
  const pieces: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') pieces.push(b.text);
  }
  return pieces.join('');
}
