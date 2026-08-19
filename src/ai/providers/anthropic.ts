/**
 * Topic analysis through the Anthropic Messages API.
 *
 * Called with raw `fetch` rather than the Anthropic SDK on purpose: this is a
 * browser extension where one optional feature makes one request, and pulling
 * an SDK bundle into the side panel for that would be the largest dependency
 * in the project. The request shape below follows the documented Messages API.
 *
 * The key is supplied by the user, sent only to api.anthropic.com, and only
 * when the user presses Find Topics and confirms.
 */

import {
  parseModelJson,
  TOPIC_PROPOSAL_SCHEMA,
  validateTopicProposal,
} from '../schema';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt';
import type {
  AnalysisInput,
  AnalyzeOptions,
  AnalyzerResult,
  TopicAnalyzer,
} from '../types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class AnthropicAnalyzer implements TopicAnalyzer {
  readonly id = 'anthropic';
  readonly label = 'Anthropic';
  readonly endpointOrigin = 'https://api.anthropic.com';

  /**
   * A true private field, not TypeScript's `private`, which is only a
   * compile-time marker: the key must not be enumerable or serializable, so
   * that logging or stringifying an analyzer can never reveal it.
   */
  readonly #apiKey: string;
  readonly #model: string;

  constructor(apiKey: string, model: string) {
    this.#apiKey = apiKey;
    this.#model = model;
  }

  async analyze(
    input: AnalysisInput,
    options: AnalyzeOptions = {},
  ): Promise<AnalyzerResult> {
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
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
          output_config: {
            // Classification, not open-ended reasoning: keep it cheap.
            effort: 'low',
            format: { type: 'json_schema', schema: TOPIC_PROPOSAL_SCHEMA },
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
      return { ok: false, errors: [describeHttpError(res.status)] };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, errors: ['The Anthropic API reply was not readable.'] };
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
          'The model ran out of room before finishing. Try again, or split a very long conversation by hand.',
        ],
      };
    }

    const text = readText(body);
    if (!text) {
      return { ok: false, errors: ['The Anthropic API returned no text.'] };
    }

    const parsed = parseModelJson(text);
    if (parsed === null) {
      return {
        ok: false,
        errors: ['The model did not return usable JSON.'],
      };
    }

    return validateTopicProposal(
      parsed,
      input.turns.map((t) => t.number),
    );
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

function describeHttpError(status: number): string {
  if (status === 401 || status === 403) {
    return 'The Anthropic API rejected that key.';
  }
  if (status === 429) {
    return 'The Anthropic API is rate limiting this key. Wait a moment and try again.';
  }
  if (status === 400) {
    return 'The Anthropic API rejected the request. The chosen model may not support this feature.';
  }
  if (status >= 500) {
    return 'The Anthropic API had a problem. Try again shortly.';
  }
  return `The Anthropic API returned an error (${status}).`;
}
