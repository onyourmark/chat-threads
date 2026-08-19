/**
 * The topic-proposal contract and its validator.
 *
 * A language model's reply is arbitrary text from outside the extension. It is
 * parsed here and nowhere else, and nothing reaches the working conversation
 * until it has passed every check below. Malformed output produces a listed
 * error, never a partially-applied proposal.
 */

/** One topic the model believes the conversation contains. */
export interface ProposedTopic {
  id: string;
  name: string;
  description?: string;
}

/** Where the model thinks one turn belongs. */
export interface ProposedAssignment {
  /** The turn's sequence number, as given to the model. */
  turn: number;
  /** A topic id from the same proposal, or the literal 'shared'. */
  topic: string;
  /** The model's own flag that it was not confident. */
  uncertain: boolean;
}

export interface TopicProposal {
  topics: ProposedTopic[];
  assignments: ProposedAssignment[];
  /** Turn numbers the model did not place. Filled in by the validator. */
  unplaced: number[];
  /** Non-fatal problems worth showing next to the proposal. */
  notes: string[];
}

export type ValidationResult =
  | { ok: true; proposal: TopicProposal }
  | { ok: false; errors: string[] };

/** The literal value a model uses to mark a turn as belonging everywhere. */
export const SHARED_TOPIC = 'shared';

const MAX_TOPICS = 12;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;

/**
 * The JSON Schema handed to the model. Kept in one place so the prompt, the
 * provider request, and the validator cannot drift apart.
 *
 * Deliberately limited to the subset both providers accept for strict
 * structured output: every object closes with `additionalProperties: false`,
 * every property is listed in `required`, and there are no count or length
 * constraints. Limits like "at most 12 topics" are enforced by
 * `validateTopicProposal` instead, which has to check them anyway — a schema
 * is a request, not a guarantee.
 */
export const TOPIC_PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics', 'assignments'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'description'],
        properties: {
          id: { type: 'string', description: 'Short unique id, e.g. "t1".' },
          name: {
            type: 'string',
            description: 'A short plain-English name for the discussion.',
          },
          description: {
            type: 'string',
            description: 'One sentence describing what this topic covers.',
          },
        },
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['turn', 'topic', 'uncertain'],
        properties: {
          turn: {
            type: 'integer',
            description: 'The turn number given to you.',
          },
          topic: {
            type: 'string',
            description:
              'A topic id from "topics", or "shared" when the turn belongs to every topic.',
          },
          uncertain: {
            type: 'boolean',
            description: 'True when you are not confident about this turn.',
          },
        },
      },
    },
  },
} as const;

/** The largest number of topics a proposal may contain. */
export const MAX_PROPOSED_TOPICS = MAX_TOPICS;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Strip control characters and clamp length.
 *
 * Topic names are rendered as text, never as HTML, so this is belt-and-braces:
 * it keeps a model from smuggling newlines or terminal escapes into a label.
 */
function cleanText(value: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/**
 * Validate a parsed model response against the contract.
 *
 * `validTurnNumbers` is the set of turns actually sent to the model; an
 * assignment naming anything else is dropped, because a hallucinated turn
 * number would otherwise silently move a real turn.
 */
export function validateTopicProposal(
  raw: unknown,
  validTurnNumbers: readonly number[],
): ValidationResult {
  const errors: string[] = [];
  const notes: string[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ['The model did not return a JSON object.'] };
  }
  if (!Array.isArray(raw.topics)) {
    errors.push('The reply had no "topics" list.');
  }
  if (!Array.isArray(raw.assignments)) {
    errors.push('The reply had no "assignments" list.');
  }
  if (errors.length > 0) return { ok: false, errors };

  const rawTopics = raw.topics as unknown[];
  const rawAssignments = raw.assignments as unknown[];

  if (rawTopics.length === 0) {
    return { ok: false, errors: ['The model proposed no topics.'] };
  }
  if (rawTopics.length > MAX_TOPICS) {
    return {
      ok: false,
      errors: [`The model proposed more than ${MAX_TOPICS} topics.`],
    };
  }

  const topics: ProposedTopic[] = [];
  const seenIds = new Set<string>();
  for (const [i, t] of rawTopics.entries()) {
    if (!isRecord(t)) {
      errors.push(`Topic ${i + 1} was not an object.`);
      continue;
    }
    const id = typeof t.id === 'string' ? cleanText(t.id, 64) : '';
    const name = typeof t.name === 'string' ? cleanText(t.name, MAX_NAME) : '';
    if (!id) {
      errors.push(`Topic ${i + 1} had no id.`);
      continue;
    }
    if (!name) {
      errors.push(`Topic ${i + 1} had no name.`);
      continue;
    }
    if (id === SHARED_TOPIC) {
      errors.push(`A topic used the reserved id "${SHARED_TOPIC}".`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`Two topics used the id "${id}".`);
      continue;
    }
    seenIds.add(id);
    const description =
      typeof t.description === 'string'
        ? cleanText(t.description, MAX_DESCRIPTION)
        : undefined;
    topics.push(description ? { id, name, description } : { id, name });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (topics.length === 0) {
    return { ok: false, errors: ['No usable topics were returned.'] };
  }

  const valid = new Set(validTurnNumbers);
  const assignments: ProposedAssignment[] = [];
  const placed = new Set<number>();
  let unknownTopicCount = 0;
  let unknownTurnCount = 0;

  for (const a of rawAssignments) {
    if (!isRecord(a)) continue;
    const turn = a.turn;
    if (typeof turn !== 'number' || !Number.isInteger(turn)) continue;
    if (!valid.has(turn)) {
      unknownTurnCount += 1;
      continue;
    }
    if (placed.has(turn)) continue; // first assignment wins
    const topic = typeof a.topic === 'string' ? cleanText(a.topic, 64) : '';
    if (topic !== SHARED_TOPIC && !seenIds.has(topic)) {
      unknownTopicCount += 1;
      continue;
    }
    placed.add(turn);
    assignments.push({ turn, topic, uncertain: a.uncertain === true });
  }

  if (assignments.length === 0) {
    return {
      ok: false,
      errors: ['The model did not place any turn into a topic.'],
    };
  }
  if (unknownTurnCount > 0) {
    notes.push(
      `${unknownTurnCount} assignment${unknownTurnCount === 1 ? '' : 's'} referred to a turn that does not exist and ${unknownTurnCount === 1 ? 'was' : 'were'} ignored.`,
    );
  }
  if (unknownTopicCount > 0) {
    notes.push(
      `${unknownTopicCount} assignment${unknownTopicCount === 1 ? '' : 's'} referred to a topic that was not proposed and ${unknownTopicCount === 1 ? 'was' : 'were'} ignored.`,
    );
  }

  const unplaced = validTurnNumbers.filter((n) => !placed.has(n));
  if (unplaced.length > 0) {
    notes.push(
      `${unplaced.length} turn${unplaced.length === 1 ? '' : 's'} ${unplaced.length === 1 ? 'was' : 'were'} left unassigned. You can place ${unplaced.length === 1 ? 'it' : 'them'} yourself.`,
    );
  }

  return {
    ok: true,
    proposal: { topics, assignments, unplaced, notes },
  };
}

/**
 * Pull a JSON object out of a model reply.
 *
 * Models sometimes wrap JSON in a fenced code block or add a sentence before
 * it. This finds the outermost object and parses it; anything else is a
 * validation failure rather than a guess.
 */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to a bracket scan.
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}
