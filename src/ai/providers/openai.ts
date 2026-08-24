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
 * ## Structured Outputs, and the bug that made them necessary
 *
 * This client used to send `response_format: { type: 'json_object' }` and drop
 * `request.schema` on the floor. JSON mode guarantees only that the reply
 * parses — not that it has the properties the stage asked for. On the first
 * real run over a 876-turn conversation that cost fifteen successful section
 * requests: the merge step replied with valid JSON under a key of its own
 * choosing, the validator refused it, and the whole analysis was thrown away.
 *
 * It now sends the schema, using the Chat Completions form
 * `response_format: { type: 'json_schema', json_schema: { name, strict,
 * schema } }` — note the nested `json_schema` object, which is what this
 * endpoint takes; the Responses API flattens it, and copying that shape here
 * produces a rejected request.
 *
 * The model name is a free-text box, so a model that cannot do this is
 * possible. That is handled by asking rather than by keeping a list: if OpenAI
 * rejects the request *because of the response format*, the client remembers
 * that for the rest of the run and repeats that one request in plain JSON
 * mode. One wasted request per run, once, instead of a hard-coded model table
 * that goes stale.
 *
 * The key is supplied by the user, sent only to api.openai.com, and only when
 * the user presses Find Topics and confirms.
 */

import { BaseAnalyzer } from '../analyzer';
import {
  describeHttpFailure,
  isUnsupportedResponseFormat,
  readErrorBody,
  readProviderError,
} from './errors';
import type {
  AnalysisStage,
  AnalyzeOptions,
  ModelRequest,
  ModelResult,
} from '../types';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const PROVIDER = 'OpenAI';

/**
 * Schema names, one per stage.
 *
 * Stable, so a reply can be traced to the contract it was held to, and within
 * OpenAI's `[a-zA-Z0-9_-]{1,64}`.
 */
const SCHEMA_NAMES: Record<AnalysisStage, string> = {
  single: 'chat_threads_topic_proposal',
  discover: 'chat_threads_section_topics',
  merge: 'chat_threads_merged_topics',
  classify: 'chat_threads_section_assignments',
};

/** Keep a supplied name inside what the API accepts, or fall back. */
function schemaNameFor(request: ModelRequest): string {
  const supplied = request.schemaName ?? '';
  return /^[a-zA-Z0-9_-]{1,64}$/.test(supplied)
    ? supplied
    : SCHEMA_NAMES[request.stage];
}

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

  /**
   * What this model turned out to support. `null` until the API has told us.
   *
   * Remembered for the life of the analyzer — one run — so a model that cannot
   * do Structured Outputs costs one rejected request, not one per section.
   */
  #supportsJsonSchema: boolean | null = null;

  constructor(apiKey: string, model: string) {
    super();
    this.#apiKey = apiKey;
    this.#model = model;
  }

  /** True when this request will be sent with a schema on the wire. */
  get usesStructuredOutput(): boolean {
    return this.#supportsJsonSchema !== false;
  }

  async complete(
    request: ModelRequest,
    options: AnalyzeOptions = {},
  ): Promise<ModelResult> {
    const withSchema =
      request.schema !== undefined && this.#supportsJsonSchema !== false;

    const first = await this.#send(request, withSchema, options);
    if (first.kind === 'ok') return first.result;

    // The only failure worth a second attempt: this model does not take a
    // schema. Anything else — a bad key, a spent quota, a rate limit, a
    // request too large, a server fault, a cancellation — is returned as it
    // came, because repeating it would fail the same way and cost the user
    // another request.
    if (first.kind === 'unsupported-format') {
      this.#supportsJsonSchema = false;
      if (options.signal?.aborted) {
        return { ok: false, errors: ['The request was cancelled.'] };
      }
      const second = await this.#send(request, false, options);
      return second.kind === 'ok'
        ? second.result
        : { ok: false, errors: [second.message] };
    }

    return { ok: false, errors: [first.message] };
  }

  /** One HTTP call. Separated so the format fallback can repeat exactly it. */
  async #send(
    request: ModelRequest,
    withSchema: boolean,
    options: AnalyzeOptions,
  ): Promise<
    | { kind: 'ok'; result: ModelResult }
    | { kind: 'failed'; message: string }
    | { kind: 'unsupported-format'; message: string }
  > {
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
          // No output cap is sent: Chat Completions has renamed that field
          // once already, and naming the wrong one is a rejected request.
          response_format: withSchema
            ? {
                type: 'json_schema',
                json_schema: {
                  name: schemaNameFor(request),
                  // Strict mode is what actually holds the model to the
                  // property names. Every schema in `schema.ts` and
                  // `stages.ts` is written to its rules already: objects
                  // closed with `additionalProperties: false`, and every
                  // property listed in `required`.
                  strict: true,
                  schema: request.schema,
                },
              }
            : { type: 'json_object' },
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      });
    } catch {
      if (options.signal?.aborted) {
        return {
          kind: 'ok',
          result: { ok: false, errors: ['The request was cancelled.'] },
        };
      }
      return {
        kind: 'failed',
        message:
          'Could not reach the OpenAI API. Check your connection and try again.',
      };
    }

    if (!res.ok) {
      const body = await readErrorBody(res);
      const message = describeHttpFailure(PROVIDER, res.status, body);
      // Only worth distinguishing when a schema was actually sent.
      if (
        withSchema &&
        isUnsupportedResponseFormat(res.status, readProviderError(body))
      ) {
        return { kind: 'unsupported-format', message };
      }
      return { kind: 'failed', message };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        kind: 'ok',
        result: { ok: false, errors: ['The OpenAI API reply was not readable.'] },
      };
    }

    if (readFinishReason(body) === 'length') {
      return {
        kind: 'ok',
        result: {
          ok: false,
          errors: [
            'The model ran out of room before finishing its reply. Try again, or exclude some turns.',
          ],
        },
      };
    }

    const text = readText(body);
    if (!text) {
      return {
        kind: 'ok',
        result: { ok: false, errors: ['The OpenAI API returned no text.'] },
      };
    }

    return { kind: 'ok', result: { ok: true, text } };
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
