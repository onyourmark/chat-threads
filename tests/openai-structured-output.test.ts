/**
 * What the OpenAI client actually puts on the wire.
 *
 * The defect that lost the first live run was invisible from above: `run.ts`
 * supplied a schema for every stage, the type said the provider took one, and
 * the provider dropped it. Nothing in the analysis tests could see that,
 * because the mock analyzer never looked at `request.schema` either.
 *
 * So these tests assert the request body itself, against a stubbed `fetch`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiAnalyzer } from '../src/ai/providers/openai';
import { TOPIC_PROPOSAL_SCHEMA } from '../src/ai/schema';
import {
  SECTION_ASSIGNMENTS_SCHEMA,
  TOPIC_LIST_SCHEMA,
} from '../src/ai/stages';
import type { AnalysisStage, ModelRequest } from '../src/ai/types';

const KEY = ['sk', 'test', '0123456789abcdef0123456789abcdef'].join('-');

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

/** Replies in order; the last one repeats once exhausted. */
function stubFetch(
  replies: Array<{ status?: number; body?: unknown }>,
): Captured[] {
  const captured: Captured[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const reply = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => reply.body ?? {},
    } as unknown as Response;
  });
  return captured;
}

const OK_REPLY = {
  choices: [
    { finish_reason: 'stop', message: { content: '{"topics":[]}' } },
  ],
};

function request(
  stage: AnalysisStage,
  schema: unknown,
  schemaName?: string,
): ModelRequest {
  return {
    stage,
    system: 'system',
    user: 'user',
    schema,
    ...(schemaName ? { schemaName } : {}),
    maxOutputTokens: 2000,
  };
}

function responseFormat(c: Captured): Record<string, unknown> {
  return c.body.response_format as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

// ------------------------------------------------- the schema is on the wire

describe('a supplied schema reaches OpenAI', () => {
  it('sends the Chat Completions json_schema form, strict', async () => {
    const captured = stubFetch([{ body: OK_REPLY }]);
    await new OpenAiAnalyzer(KEY, 'gpt-4o-mini').complete(
      request('merge', TOPIC_LIST_SCHEMA, 'chat_threads_merged_topics'),
    );

    const format = responseFormat(captured[0]!);
    expect(format.type).toBe('json_schema');

    // The nesting matters: Chat Completions takes a `json_schema` object.
    // The Responses API flattens these fields, and sending that shape here
    // is a rejected request.
    const json = format.json_schema as Record<string, unknown>;
    expect(json).toBeDefined();
    expect(json.name).toBe('chat_threads_merged_topics');
    expect(json.strict).toBe(true);
    expect(json.schema).toEqual(TOPIC_LIST_SCHEMA);
  });

  it('never falls back to bare JSON mode while a schema is supplied', async () => {
    const captured = stubFetch([{ body: OK_REPLY }]);
    await new OpenAiAnalyzer(KEY, 'gpt-4o-mini').complete(
      request('single', TOPIC_PROPOSAL_SCHEMA),
    );

    expect(responseFormat(captured[0]!).type).not.toBe('json_object');
  });

  it('names every stage stably, within OpenAI\'s allowed characters', async () => {
    const stages: Array<[AnalysisStage, unknown]> = [
      ['single', TOPIC_PROPOSAL_SCHEMA],
      ['discover', TOPIC_LIST_SCHEMA],
      ['merge', TOPIC_LIST_SCHEMA],
      ['classify', SECTION_ASSIGNMENTS_SCHEMA],
    ];
    const names = new Set<string>();

    for (const [stage, schema] of stages) {
      const captured = stubFetch([{ body: OK_REPLY }]);
      await new OpenAiAnalyzer(KEY, 'gpt-4o-mini').complete(
        request(stage, schema),
      );
      const json = responseFormat(captured[0]!).json_schema as Record<
        string,
        unknown
      >;
      const name = json.name as string;
      expect(name, stage).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(json.schema, stage).toEqual(schema);
      names.add(name);
      vi.unstubAllGlobals();
    }

    // One name per stage, so a reply can be traced to its contract.
    expect(names.size).toBe(4);
  });

  it('refuses a supplied name that OpenAI would reject, and uses its own', async () => {
    const captured = stubFetch([{ body: OK_REPLY }]);
    await new OpenAiAnalyzer(KEY, 'gpt-4o-mini').complete(
      request('discover', TOPIC_LIST_SCHEMA, 'not a valid name!'),
    );

    const json = responseFormat(captured[0]!).json_schema as Record<
      string,
      unknown
    >;
    expect(json.name).toBe('chat_threads_section_topics');
  });

  it('still uses plain JSON mode when no schema was asked for', async () => {
    const captured = stubFetch([{ body: OK_REPLY }]);
    await new OpenAiAnalyzer(KEY, 'gpt-4o-mini').complete({
      stage: 'single',
      system: 's',
      user: 'u',
      maxOutputTokens: 100,
    });

    expect(responseFormat(captured[0]!)).toEqual({ type: 'json_object' });
  });
});

// --------------------------------------------- schemas are strict-compatible

describe('every schema meets strict mode\'s rules', () => {
  /** Walk an object schema and check what strict mode requires of it. */
  function check(schema: unknown, path = 'root'): void {
    if (typeof schema !== 'object' || schema === null) return;
    const s = schema as Record<string, unknown>;

    if (s.type === 'object') {
      expect(s.additionalProperties, `${path}: additionalProperties`).toBe(
        false,
      );
      const properties = (s.properties ?? {}) as Record<string, unknown>;
      const required = (s.required ?? []) as string[];
      // Every property must be required — strict mode has no optionals.
      expect([...Object.keys(properties)].sort(), `${path}: required`).toEqual(
        [...required].sort(),
      );
      for (const [key, value] of Object.entries(properties)) {
        check(value, `${path}.${key}`);
      }
    }
    if (s.type === 'array') check(s.items, `${path}[]`);
  }

  it('every property is required and every object is closed', () => {
    check(TOPIC_PROPOSAL_SCHEMA, 'topic_proposal');
    check(TOPIC_LIST_SCHEMA, 'topic_list');
    check(SECTION_ASSIGNMENTS_SCHEMA, 'section_assignments');
  });

  it('uses no keyword outside the supported subset', () => {
    const allowed = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'description',
      'enum',
    ]);
    const walk = (schema: unknown, path: string): void => {
      if (typeof schema !== 'object' || schema === null) return;
      for (const [key, value] of Object.entries(
        schema as Record<string, unknown>,
      )) {
        expect(allowed.has(key), `${path}: ${key}`).toBe(true);
        if (key === 'properties') {
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            walk(v, `${path}.${k}`);
          }
        } else if (key === 'items') {
          walk(value, `${path}[]`);
        }
      }
    };
    walk(TOPIC_PROPOSAL_SCHEMA, 'topic_proposal');
    walk(TOPIC_LIST_SCHEMA, 'topic_list');
    walk(SECTION_ASSIGNMENTS_SCHEMA, 'section_assignments');
  });
});

// ------------------------------------------------------ model compatibility

describe('a model that cannot take a schema', () => {
  const REFUSAL = {
    status: 400,
    body: {
      error: {
        message:
          "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.",
        type: 'invalid_request_error',
        param: 'response_format',
        code: 'unsupported_value',
      },
    },
  };

  it('falls back to JSON mode once, and succeeds', async () => {
    const captured = stubFetch([REFUSAL, { body: OK_REPLY }]);
    const result = await new OpenAiAnalyzer(KEY, 'some-older-model').complete(
      request('merge', TOPIC_LIST_SCHEMA),
    );

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(2);
    expect(responseFormat(captured[0]!).type).toBe('json_schema');
    expect(responseFormat(captured[1]!)).toEqual({ type: 'json_object' });
    // The prompt is unchanged; only the format differs.
    expect(captured[1]!.body.messages).toEqual(captured[0]!.body.messages);
  });

  it('remembers, so the rest of the run costs nothing extra', async () => {
    const captured = stubFetch([REFUSAL, { body: OK_REPLY }]);
    const analyzer = new OpenAiAnalyzer(KEY, 'some-older-model');

    await analyzer.complete(request('discover', TOPIC_LIST_SCHEMA));
    expect(captured).toHaveLength(2);
    expect(analyzer.usesStructuredOutput).toBe(false);

    // Three more stage requests: three more calls, none of them wasted.
    await analyzer.complete(request('discover', TOPIC_LIST_SCHEMA));
    await analyzer.complete(request('merge', TOPIC_LIST_SCHEMA));
    await analyzer.complete(request('classify', SECTION_ASSIGNMENTS_SCHEMA));

    expect(captured).toHaveLength(5);
    for (const c of captured.slice(1)) {
      expect(responseFormat(c)).toEqual({ type: 'json_object' });
    }
  });

  it('does not retry anything else', async () => {
    const noRetry: Array<[string, { status: number; body: unknown }]> = [
      ['a rejected key', { status: 401, body: { error: { code: 'invalid_api_key', message: 'bad key' } } }],
      ['a spent quota', { status: 429, body: { error: { code: 'insufficient_quota', message: 'quota' } } }],
      ['a rate limit', { status: 429, body: { error: { code: 'rate_limit_exceeded', message: 'slow down' } } }],
      ['a server fault', { status: 500, body: { error: { message: 'oops' } } }],
      [
        'a request too large',
        {
          status: 400,
          body: {
            error: {
              code: 'context_length_exceeded',
              message: "This model's maximum context length is 128000 tokens.",
            },
          },
        },
      ],
      [
        'an ordinary bad request',
        { status: 400, body: { error: { message: 'Unrecognised argument: banana', type: 'invalid_request_error' } } },
      ],
    ];

    for (const [name, reply] of noRetry) {
      const captured = stubFetch([reply, { body: OK_REPLY }]);
      const result = await new OpenAiAnalyzer(KEY, 'gpt-4o-mini').complete(
        request('merge', TOPIC_LIST_SCHEMA),
      );

      expect(result.ok, name).toBe(false);
      // Exactly one attempt: repeating any of these costs money and fails
      // the same way.
      expect(captured, name).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it('does not retry after the run has been cancelled', async () => {
    const controller = new AbortController();
    const captured = stubFetch([REFUSAL, { body: OK_REPLY }]);
    controller.abort();

    const result = await new OpenAiAnalyzer(KEY, 'older').complete(
      request('merge', TOPIC_LIST_SCHEMA),
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['The request was cancelled.']);
    expect(captured).toHaveLength(1);
  });

  it('keeps the key out of the fallback path too', async () => {
    const captured = stubFetch([
      { status: 400, body: { error: { message: `response_format json_schema is not supported. key ${KEY}`, code: 'unsupported_value' } } },
      { body: OK_REPLY },
    ]);
    const result = await new OpenAiAnalyzer(KEY, 'older').complete(
      request('merge', TOPIC_LIST_SCHEMA),
    );

    expect(result.ok).toBe(true);
    for (const c of captured) {
      expect(JSON.stringify(c.body)).not.toContain(KEY);
    }
  });
});
