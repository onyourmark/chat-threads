/**
 * Topic analysis through the OpenAI Chat Completions API.
 *
 * Raw `fetch` for the same reason as the Anthropic analyzer: one optional
 * request does not justify an SDK bundle inside a side panel.
 *
 * The key is supplied by the user, sent only to api.openai.com, and only when
 * the user presses Find Topics and confirms.
 */

import { parseModelJson, validateTopicProposal } from '../schema';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt';
import type {
  AnalysisInput,
  AnalyzeOptions,
  AnalyzerResult,
  TopicAnalyzer,
} from '../types';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export class OpenAiAnalyzer implements TopicAnalyzer {
  readonly id = 'openai';
  readonly label = 'OpenAI';
  readonly endpointOrigin = 'https://api.openai.com';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

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
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          // JSON mode is supported far more widely than per-model schema
          // enforcement, and the reply is validated here regardless.
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(input) },
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
      return { ok: false, errors: [describeHttpError(res.status)] };
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
          'The model ran out of room before finishing. Try again, or split a very long conversation by hand.',
        ],
      };
    }

    const text = readText(body);
    if (!text) {
      return { ok: false, errors: ['The OpenAI API returned no text.'] };
    }

    const parsed = parseModelJson(text);
    if (parsed === null) {
      return { ok: false, errors: ['The model did not return usable JSON.'] };
    }

    return validateTopicProposal(
      parsed,
      input.turns.map((t) => t.number),
    );
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

function describeHttpError(status: number): string {
  if (status === 401 || status === 403) {
    return 'The OpenAI API rejected that key.';
  }
  if (status === 429) {
    return 'The OpenAI API is rate limiting this key, or the account is out of quota.';
  }
  if (status === 400 || status === 404) {
    return 'The OpenAI API rejected the request. Check the model name.';
  }
  if (status >= 500) {
    return 'The OpenAI API had a problem. Try again shortly.';
  }
  return `The OpenAI API returned an error (${status}).`;
}
