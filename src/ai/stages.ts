/**
 * The three steps a long conversation is analysed in.
 *
 * A long conversation cannot be sent in one request, and cutting it into
 * independent pieces is not an answer either: each piece would name its own
 * topics, and the user would be handed "Chrome extension publishing",
 * "Web Store submission" and "Chrome Store setup" as three separate things
 * when they are plainly one. So the work is done in three passes, and the
 * middle one exists entirely to prevent that.
 *
 *   1. Discovery  — each section says what topics appear in it. Names only,
 *                   no assignments: a section's answer is a few hundred
 *                   characters, not a rewritten conversation.
 *   2. Merge      — one request reconciles every section's list into a single
 *                   canonical set of topics for the whole conversation.
 *   3. Classify   — each section is read again, this time with the canonical
 *                   list, and places its own turns into it.
 *
 * Each step has its own schema and its own validator, because reusing the
 * final `TopicProposal` shape for the intermediate steps would ask the model
 * for output it has no way to produce — a section cannot assign turns it has
 * not been shown, and the merge step is not shown any turns at all.
 *
 * Everything a model returns here is untrusted text. It is parsed, checked and
 * clamped before it can affect anything, exactly as in `schema.ts`.
 */

import {
  cleanText,
  MAX_PROPOSED_TOPICS,
  SHARED_TOPIC,
  type ProposedAssignment,
  type ProposedTopic,
} from './schema';
import {
  NAMED_TOPIC_RULES,
  renderContextTurns,
  renderTurns,
} from './prompt';
import type { AnalysisInput } from './types';
import type { AnalysisSection } from './plan';
import {
  BUILT_IN_TOPIC_MODEL_ID,
  BUILT_IN_TOPIC_RULES,
} from '../model/default-topic';

/** The most topics one section may report. Merged down again afterwards. */
export const MAX_SECTION_TOPICS = 8;

const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;

// ------------------------------------------------------------- schemas -----

/**
 * A bare list of topics. Used by both the discovery and the merge step, whose
 * outputs have the same shape and different meanings.
 *
 * Restricted to the subset both providers accept for strict structured output:
 * every object closes with `additionalProperties: false` and lists every
 * property in `required`. Counts and lengths are enforced by the validators
 * below, which have to check them anyway.
 */
export const TOPIC_LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics'],
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
  },
} as const;

/** Assignments for one section, against a topic list decided elsewhere. */
export const SECTION_ASSIGNMENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['turn', 'topic', 'uncertain'],
        properties: {
          turn: { type: 'integer', description: 'The turn number given to you.' },
          topic: {
            type: 'string',
            description:
              'A topic id from the list you were given, or "shared" when the turn belongs to every topic.',
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

// ------------------------------------------------------------- prompts -----

export const DISCOVERY_SYSTEM_PROMPT = [
  'You are reading one section of a long chat conversation and naming the distinct topics that appear in it.',
  '',
  'Rules:',
  '- Name only topics that are actually present in this section. If the whole section is about one thing, return one topic.',
  '- Name each topic in a few plain words a person would recognise, e.g. "Browser extension design" or "Travel plans".',
  '- Give each topic a short id such as "t1", unique within your reply.',
  '- Describe each topic in one short sentence.',
  `- Return at most ${MAX_SECTION_TOPICS} topics.`,
  '- Do not assign turns to topics. Do not rewrite, summarise, translate or quote the conversation. Only name its topics.',
  '- Reply with JSON matching the schema and nothing else.',
].join('\n');

export const MERGE_SYSTEM_PROMPT = [
  'You are merging topic lists taken from consecutive sections of one long chat conversation into a single set of topics for the whole conversation.',
  '',
  'Rules:',
  '- Merge entries that mean the same thing, even when they were named differently. "Chrome extension publishing", "Web Store submission" and "Chrome Store setup" are one topic, not three.',
  '- Keep genuinely different subjects apart. Do not collapse the conversation into one topic just because the sections overlap.',
  '- Choose the clearest name for each merged topic. Do not invent a topic no section reported.',
  '- Give each merged topic a new short id such as "c1", unique within your reply.',
  '- Order them roughly as they first appear in the conversation.',
  `- Return at most ${MAX_PROPOSED_TOPICS} topics.`,
  '- Reply with JSON matching the schema and nothing else.',
].join('\n');

export const CLASSIFY_SYSTEM_PROMPT = [
  'You are sorting the turns of one section of a long chat conversation into topics that have already been chosen for the whole conversation.',
  '',
  'Rules:',
  '- Use only the topic ids you are given, or "shared". Never invent a topic id.',
  '- Assign every turn in this section to exactly one topic id, or to "shared".',
  '- Use "shared" only for turns that genuinely belong with every topic, such as an opening greeting or a general instruction that applies throughout.',
  '- Keep a question and its answer in the same topic.',
  '- When a turn could belong to two topics, put it with the one it moves forward, and set "uncertain" to true. Do not use "shared" for a turn that belongs to two topics out of fifteen — "shared" means it belongs with all of them.',
  '- Turns marked "context only" are shown as background. Do not assign them.',
  '- Set "uncertain" to true whenever you are not confident, rather than guessing quietly.',
  '- Do not rewrite, summarise, translate, or comment on the conversation. Only classify it.',
  '- Reply with JSON matching the schema and nothing else.',
].join('\n');

function titleLines(input: AnalysisInput): string[] {
  return input.title ? [`Conversation title: ${input.title}`, ''] : [];
}

function hasBuiltIn(input: AnalysisInput): boolean {
  return input.existingTopics.some((t) => t.id === BUILT_IN_TOPIC_MODEL_ID);
}

/** Topics the person named themselves, as opposed to the built-in one. */
function namedTopics(input: AnalysisInput) {
  return input.existingTopics.filter((t) => t.id !== BUILT_IN_TOPIC_MODEL_ID);
}

/**
 * Tell a stage that some topics are already decided.
 *
 * Discovery and merge are both asked for *new* topics, so an existing one must
 * be kept out of their lists — but a topic the user named still has to be
 * mentioned, or the merge step will happily invent a synonym for it and the
 * final pass will have two names for one subject.
 */
function reservedTopicLines(input: AnalysisInput): string[] {
  const lines: string[] = [];
  if (hasBuiltIn(input)) {
    lines.push(
      `A topic with the id "${BUILT_IN_TOPIC_MODEL_ID}" already exists for turns spent cursing at, arguing with, or venting at the assistant. It is handled separately — do not list it, and do not name a topic of your own for it.`,
      '',
    );
  }
  const named = namedTopics(input);
  if (named.length > 0) {
    lines.push(
      'These topics were named by the person before they asked you. They already exist and are handled separately: do not list them, and do not name a topic of your own that means the same thing.',
    );
    for (const topic of named) {
      const description = topic.description ? ` — ${topic.description}` : '';
      lines.push(`- ${topic.name}${description}`);
    }
    lines.push('');
  }
  return lines;
}

/** Pass 1: what is this section about? */
export function buildDiscoveryPrompt(
  input: AnalysisInput,
  section: AnalysisSection,
  sections: number,
): string {
  const lines: string[] = [...titleLines(input)];
  lines.push(
    `This is section ${section.index} of ${sections} of one conversation, in order.`,
    '',
    'Return JSON matching this schema:',
    JSON.stringify(TOPIC_LIST_SCHEMA),
    '',
  );

  lines.push(...reservedTopicLines(input));

  lines.push('Here are the turns in this section.', '');
  const context = renderContextTurns(section.context);
  if (context) lines.push(context);
  lines.push(renderTurns(section.turns));

  return lines.join('\n');
}

/** One section's answer to pass 1, as pass 2 is shown it. */
export interface SectionTopics {
  section: number;
  topics: ProposedTopic[];
}

/** Pass 2: one list of topics for the whole conversation. */
export function buildMergePrompt(
  input: AnalysisInput,
  found: readonly SectionTopics[],
  sections: number,
): string {
  const lines: string[] = [...titleLines(input)];
  lines.push(
    `The conversation was read in ${sections} sections. These are the topics each section reported, in order.`,
    '',
    'Return JSON matching this schema:',
    JSON.stringify(TOPIC_LIST_SCHEMA),
    '',
  );

  lines.push(...reservedTopicLines(input));

  for (const entry of found) {
    lines.push(`Section ${entry.section}:`);
    if (entry.topics.length === 0) {
      lines.push('- (nothing reported)');
    }
    for (const topic of entry.topics) {
      const description = topic.description ? ` — ${topic.description}` : '';
      lines.push(`- ${topic.name}${description}`);
    }
    lines.push('');
  }

  lines.push(
    'Merge these into one set of topics for the whole conversation.',
  );

  return lines.join('\n');
}

/** Pass 3: place this section's turns into the canonical topics. */
export function buildClassifyPrompt(
  input: AnalysisInput,
  section: AnalysisSection,
  sections: number,
  canonical: readonly ProposedTopic[],
): string {
  const lines: string[] = [...titleLines(input)];
  lines.push(
    `This is section ${section.index} of ${sections} of one conversation, in order.`,
    '',
    'Return JSON matching this schema:',
    JSON.stringify(SECTION_ASSIGNMENTS_SCHEMA),
    '',
    'These are the topics of the whole conversation. Use these ids and no others.',
  );

  for (const topic of canonical) {
    const description = topic.description ? ` — ${topic.description}` : '';
    lines.push(`- id "${topic.id}": ${topic.name}${description}`);
  }
  for (const topic of input.existingTopics) {
    const description = topic.description ? ` — ${topic.description}` : '';
    lines.push(`- id "${topic.id}": ${topic.name}${description}`);
  }
  lines.push('- id "shared": belongs with every topic.', '');

  if (hasBuiltIn(input)) {
    lines.push(BUILT_IN_TOPIC_RULES, '');
  }
  if (namedTopics(input).length > 0) {
    lines.push(NAMED_TOPIC_RULES, '');
  }

  lines.push(
    'Here are the turns in this section. Use the number shown for each one, and assign every one of them.',
    '',
  );
  const context = renderContextTurns(section.context);
  if (context) lines.push(context);
  lines.push(renderTurns(section.turns));

  return lines.join('\n');
}

/**
 * Ask a model to put its own last answer into the required shape.
 *
 * Used at most once per request, and only when the reply was valid JSON whose
 * structure did not match. It deliberately does not resend the conversation:
 * the information is already in the model's previous reply, so the repair is a
 * reformat, not a re-analysis. That keeps it cheap and keeps conversation text
 * off the wire a second time.
 */
export function buildRepairPrompt(
  schema: unknown,
  expectedProperty: string,
  previousReply: string,
): string {
  return [
    'Your previous reply was valid JSON but did not match the required shape.',
    '',
    `It must be a JSON object with a top-level "${expectedProperty}" array. Do not rename that property. Do not wrap it in another object.`,
    '',
    'Required schema:',
    JSON.stringify(schema),
    '',
    'Your previous reply:',
    previousReply,
    '',
    `Return the same information as JSON matching the schema, with the array under "${expectedProperty}", and nothing else.`,
  ].join('\n');
}

export const REPAIR_SYSTEM_PROMPT = [
  'You convert a JSON value into the exact shape a schema requires.',
  '',
  'Rules:',
  '- Keep the information that is already there. Do not invent entries and do not drop any.',
  '- Use exactly the property names the schema gives.',
  '- Reply with JSON matching the schema and nothing else.',
].join('\n');

// ---------------------------------------------------------- validators -----

export type TopicListResult =
  | { ok: true; topics: ProposedTopic[] }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface TopicListOptions {
  /** Anything above this is a rejection, not a silent truncation. */
  max: number;
  /** Ids the model must not claim, such as the built-in topic's. */
  forbiddenIds?: readonly string[];
  /** True when returning nothing is a legitimate answer. */
  allowEmpty?: boolean;
}

/**
 * Check a bare topic list from the discovery or merge step.
 *
 * Entries that are unusable are dropped rather than failing the whole reply —
 * one malformed topic out of six should not cost the user a request — but an
 * over-long list, a duplicate id, or a claim on a reserved id is a rejection,
 * because each of those would change the meaning of the result rather than
 * just lose part of it.
 */
export function validateTopicList(
  raw: unknown,
  options: TopicListOptions,
): TopicListResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['The model did not return a JSON object.'] };
  }
  if (!Array.isArray(raw.topics)) {
    return { ok: false, errors: ['The reply had no "topics" list.'] };
  }

  const rawTopics = raw.topics as unknown[];
  if (rawTopics.length > options.max) {
    return {
      ok: false,
      errors: [`The model returned more than ${options.max} topics.`],
    };
  }

  const forbidden = new Set([SHARED_TOPIC, ...(options.forbiddenIds ?? [])]);
  const seen = new Set<string>();
  const topics: ProposedTopic[] = [];

  for (const t of rawTopics) {
    if (!isRecord(t)) continue;
    const id = typeof t.id === 'string' ? cleanText(t.id, 64) : '';
    const name = typeof t.name === 'string' ? cleanText(t.name, MAX_NAME) : '';
    if (!id || !name) continue;
    if (forbidden.has(id)) {
      return {
        ok: false,
        errors: [`A topic used the reserved id "${id}".`],
      };
    }
    if (seen.has(id)) {
      return { ok: false, errors: [`Two topics used the id "${id}".`] };
    }
    seen.add(id);
    const description =
      typeof t.description === 'string'
        ? cleanText(t.description, MAX_DESCRIPTION)
        : undefined;
    topics.push(description ? { id, name, description } : { id, name });
  }

  if (topics.length === 0 && options.allowEmpty !== true) {
    return { ok: false, errors: ['The model returned no usable topics.'] };
  }

  return { ok: true, topics };
}

export type SectionAssignmentsResult =
  | { ok: true; assignments: ProposedAssignment[]; dropped: number }
  | { ok: false; errors: string[] };

/**
 * Check one section's assignments.
 *
 * `allowedTurns` is this section's own turns and nothing else. That is what
 * makes the background context safe: a turn shown for continuity belongs to a
 * different section, so an assignment naming it is dropped here rather than
 * becoming a second, conflicting home for the same turn.
 */
export function validateSectionAssignments(
  raw: unknown,
  allowedTurns: ReadonlySet<number>,
  allowedTopics: ReadonlySet<string>,
): SectionAssignmentsResult {
  if (!isRecord(raw)) {
    return { ok: false, errors: ['The model did not return a JSON object.'] };
  }
  if (!Array.isArray(raw.assignments)) {
    return { ok: false, errors: ['The reply had no "assignments" list.'] };
  }

  const assignments: ProposedAssignment[] = [];
  const placed = new Set<number>();
  let dropped = 0;

  for (const a of raw.assignments as unknown[]) {
    if (!isRecord(a)) {
      dropped += 1;
      continue;
    }
    const turn = a.turn;
    if (typeof turn !== 'number' || !Number.isInteger(turn)) {
      dropped += 1;
      continue;
    }
    if (!allowedTurns.has(turn)) {
      dropped += 1;
      continue;
    }
    if (placed.has(turn)) {
      dropped += 1;
      continue; // first assignment wins, as in the single-pass validator
    }
    const topic = typeof a.topic === 'string' ? cleanText(a.topic, 64) : '';
    if (topic !== SHARED_TOPIC && !allowedTopics.has(topic)) {
      dropped += 1;
      continue;
    }
    placed.add(turn);
    assignments.push({ turn, topic, uncertain: a.uncertain === true });
  }

  return { ok: true, assignments, dropped };
}
