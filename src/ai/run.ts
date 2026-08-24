/**
 * Running Find Topics: one request, or many.
 *
 * This is the only thing the side panel calls, and it sits above the providers
 * rather than inside one, so a long conversation is handled the same way
 * whether the user picked OpenAI or Anthropic. A provider's job stops at
 * "send this prompt, return the reply as text".
 *
 * Short conversations behave exactly as they did before this file existed: one
 * request, the same prompt, the same validator. The multi-pass path only runs
 * when `planAnalysis` says a single request would be too large — see `plan.ts`
 * for where that threshold comes from, and `stages.ts` for what each pass asks.
 *
 * Two properties are load-bearing throughout, and are what the tests in
 * `tests/ai-sections.test.ts` exist to hold down:
 *
 * - **Every retained turn is accounted for, once.** Sections are disjoint and
 *   contiguous, they carry the original sequence numbers unchanged, and the
 *   final assembled proposal is put through the same `validateTopicProposal`
 *   a single-pass run uses. A turn no model placed comes back as `unplaced`,
 *   which the panel already knows how to show — it never silently vanishes.
 * - **Cancelling stops everything.** The signal is checked before every call
 *   and passed into every call, so a cancelled run makes no further requests
 *   and returns a cancellation rather than a half-finished proposal.
 */

import {
  parseModelJson,
  TOPIC_PROPOSAL_SCHEMA,
  validateTopicProposal,
  type ProposedAssignment,
  type ProposedTopic,
} from './schema';
import { buildUserPrompt, reservedTopicIds, SYSTEM_PROMPT } from './prompt';
import { planAnalysis, type AnalysisPlan, type PlanOptions } from './plan';
import {
  buildClassifyPrompt,
  buildDiscoveryPrompt,
  buildMergePrompt,
  CLASSIFY_SYSTEM_PROMPT,
  DISCOVERY_SYSTEM_PROMPT,
  MAX_SECTION_TOPICS,
  MERGE_SYSTEM_PROMPT,
  SECTION_ASSIGNMENTS_SCHEMA,
  TOPIC_LIST_SCHEMA,
  validateSectionAssignments,
  validateTopicList,
  type SectionTopics,
} from './stages';
import { MAX_PROPOSED_TOPICS } from './schema';
import type {
  AnalysisInput,
  AnalyzeOptions,
  AnalyzerResult,
  TopicAnalyzer,
} from './types';

/** Reply budgets, sized to what each step actually has to say. */
const OUTPUT_TOKENS = {
  single: 16_000,
  /** A handful of names and one-line descriptions. */
  discover: 2_000,
  /** The same, once. */
  merge: 2_000,
  /** One short object per turn in a section. */
  classify: 8_000,
} as const;

const CANCELLED: AnalyzerResult = {
  ok: false,
  errors: ['The request was cancelled.'],
};

export interface RunOptions extends AnalyzeOptions, PlanOptions {}

/**
 * Analyse a conversation and return a proposal, or say why there isn't one.
 *
 * Never throws for an expected failure: a rejected request, an unreadable
 * reply and a cancellation all come back as `{ ok: false, errors }` so the
 * panel has one thing to render.
 */
export async function runTopicAnalysis(
  analyzer: TopicAnalyzer,
  input: AnalysisInput,
  options: RunOptions = {},
): Promise<AnalyzerResult> {
  if (input.turns.length === 0) {
    return { ok: false, errors: ['There are no turns to analyse.'] };
  }

  const plan = planAnalysis(input, options);

  if (plan.mode === 'too-large') {
    return {
      ok: false,
      errors: [
        `This conversation is too long to analyse automatically: it would take ${plan.sectionCount} sections and about ${plan.requests} requests. Exclude some turns, or split it into topics by hand.`,
      ],
    };
  }

  if (plan.mode === 'single') {
    options.onProgress?.({ phase: 'single' });
    return singlePass(analyzer, input, options);
  }

  return sectionedPasses(analyzer, input, plan, options);
}

// ------------------------------------------------------------ one pass -----

async function singlePass(
  analyzer: TopicAnalyzer,
  input: AnalysisInput,
  options: RunOptions,
): Promise<AnalyzerResult> {
  if (options.signal?.aborted) return CANCELLED;

  const reply = await analyzer.complete(
    {
      stage: 'single',
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      schema: TOPIC_PROPOSAL_SCHEMA,
      maxOutputTokens: OUTPUT_TOKENS.single,
    },
    options,
  );
  if (!reply.ok) return reply;

  const parsed = parseModelJson(reply.text);
  if (parsed === null) {
    return { ok: false, errors: ['The model did not return usable JSON.'] };
  }

  return validateTopicProposal(
    parsed,
    input.turns.map((t) => t.number),
    reservedTopicIds(input),
  );
}

// ------------------------------------------------------- several passes ----

async function sectionedPasses(
  analyzer: TopicAnalyzer,
  input: AnalysisInput,
  plan: AnalysisPlan,
  options: RunOptions,
): Promise<AnalyzerResult> {
  const sections = plan.sections;
  const count = sections.length;
  const reserved = reservedTopicIds(input);
  const notes: string[] = [
    `This conversation was too long for one request, so it was analysed in ${count} sections.`,
  ];

  // --- Pass 1: what is each section about? ---------------------------------
  const found: SectionTopics[] = [];
  let unreadable = 0;

  for (const section of sections) {
    if (options.signal?.aborted) return CANCELLED;
    options.onProgress?.({
      phase: 'discover',
      section: section.index,
      sections: count,
    });

    const reply = await analyzer.complete(
      {
        stage: 'discover',
        system: DISCOVERY_SYSTEM_PROMPT,
        user: buildDiscoveryPrompt(input, section, count),
        schema: TOPIC_LIST_SCHEMA,
        maxOutputTokens: OUTPUT_TOKENS.discover,
      },
      options,
    );
    // A rejected request will reject the next one too. Stop rather than spend
    // the user's remaining sections finding that out one at a time.
    if (!reply.ok) return reply;

    const checked = validateTopicList(parseModelJson(reply.text), {
      max: MAX_SECTION_TOPICS,
      forbiddenIds: reserved,
      allowEmpty: true,
    });
    if (!checked.ok) {
      unreadable += 1;
      found.push({ section: section.index, topics: [] });
      continue;
    }
    found.push({ section: section.index, topics: checked.topics });
  }

  if (found.every((f) => f.topics.length === 0)) {
    return {
      ok: false,
      errors: ['No section returned a usable list of topics.'],
    };
  }
  if (unreadable > 0) {
    notes.push(
      `${unreadable} section${unreadable === 1 ? '' : 's'} did not return a readable list of topics.`,
    );
  }

  // --- Pass 2: reconcile them into one set ---------------------------------
  if (options.signal?.aborted) return CANCELLED;
  options.onProgress?.({ phase: 'merge' });

  const mergeReply = await analyzer.complete(
    {
      stage: 'merge',
      system: MERGE_SYSTEM_PROMPT,
      user: buildMergePrompt(input, found, count),
      schema: TOPIC_LIST_SCHEMA,
      maxOutputTokens: OUTPUT_TOKENS.merge,
    },
    options,
  );
  if (!mergeReply.ok) return mergeReply;

  const merged = validateTopicList(parseModelJson(mergeReply.text), {
    max: MAX_PROPOSED_TOPICS,
    forbiddenIds: reserved,
    // Only defensible when there is somewhere else for turns to go.
    allowEmpty: reserved.length > 0,
  });
  if (!merged.ok) {
    return {
      ok: false,
      errors: [
        `The topics from each section could not be combined: ${merged.errors[0] ?? 'the reply was unusable.'}`,
      ],
    };
  }

  const canonical: ProposedTopic[] = merged.topics;
  const allowedTopics = new Set<string>([
    ...canonical.map((t) => t.id),
    ...reserved,
  ]);

  // --- Pass 3: place every turn into that set ------------------------------
  const assignments: ProposedAssignment[] = [];
  let unclassified = 0;

  for (const section of sections) {
    if (options.signal?.aborted) return CANCELLED;
    options.onProgress?.({
      phase: 'classify',
      section: section.index,
      sections: count,
    });

    const reply = await analyzer.complete(
      {
        stage: 'classify',
        system: CLASSIFY_SYSTEM_PROMPT,
        user: buildClassifyPrompt(input, section, count, canonical),
        schema: SECTION_ASSIGNMENTS_SCHEMA,
        maxOutputTokens: OUTPUT_TOKENS.classify,
      },
      options,
    );
    if (!reply.ok) return reply;

    // This section's own turns, and nothing else. Background context shown for
    // continuity belongs to a neighbour and is refused here, so overlap can
    // never turn into the same turn being filed twice.
    const own = new Set(section.turns.map((t) => t.number));
    const checked = validateSectionAssignments(
      parseModelJson(reply.text),
      own,
      allowedTopics,
    );
    if (!checked.ok) {
      unclassified += 1;
      continue;
    }
    assignments.push(...checked.assignments);
  }

  if (unclassified > 0) {
    notes.push(
      `${unclassified} section${unclassified === 1 ? '' : 's'} could not be sorted, so its turns were left unassigned.`,
    );
  }

  // --- Assemble, and check it like any other proposal ----------------------
  // Deliberately the same validator the single-pass path uses: turn numbers
  // that do not exist, topics that were never proposed, duplicates and missing
  // turns are all caught in one place, whichever route produced them.
  const result = validateTopicProposal(
    { topics: canonical, assignments },
    input.turns.map((t) => t.number),
    reserved,
  );
  if (!result.ok) return result;

  return {
    ok: true,
    proposal: { ...result.proposal, notes: [...notes, ...result.proposal.notes] },
  };
}
