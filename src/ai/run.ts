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
 * Three properties are load-bearing throughout:
 *
 * - **Every retained turn is accounted for, once.** Sections are disjoint and
 *   contiguous, they carry the original sequence numbers unchanged, and the
 *   final assembled proposal is put through the same `validateTopicProposal`
 *   a single-pass run uses. A turn no model placed comes back as `unplaced`,
 *   which the panel already knows how to show — it never silently vanishes.
 * - **Cancelling stops everything.** The signal is checked before every call
 *   and passed into every call, so a cancelled run makes no further requests
 *   and returns a cancellation rather than a half-finished proposal.
 * - **One bad reply does not throw away the run.** The first live run over a
 *   876-turn conversation completed fifteen section requests and then lost all
 *   of them because the merge step answered with valid JSON under a property
 *   name of its own choosing. Structured Outputs is the real fix; the bounded
 *   repair below is the belt to its braces, and is capped hard enough that it
 *   can never turn into a runaway bill.
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
import { describeShape, shapeSummary, type StageLocation } from './diagnostics';
import {
  buildClassifyPrompt,
  buildDiscoveryPrompt,
  buildMergePrompt,
  buildRepairPrompt,
  CLASSIFY_SYSTEM_PROMPT,
  DISCOVERY_SYSTEM_PROMPT,
  MAX_SECTION_TOPICS,
  MERGE_SYSTEM_PROMPT,
  REPAIR_SYSTEM_PROMPT,
  SECTION_ASSIGNMENTS_SCHEMA,
  TOPIC_LIST_SCHEMA,
  validateSectionAssignments,
  validateTopicList,
  type SectionTopics,
} from './stages';
import { MAX_PROPOSED_TOPICS } from './schema';
import type {
  AnalysisInput,
  AnalysisStage,
  AnalyzeOptions,
  AnalyzerResult,
  ModelRequest,
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

/**
 * How many structural repairs one whole run may make.
 *
 * Small on purpose. A repair is for the odd reply that came back under the
 * wrong property name; if several replies are shaped wrongly the model is not
 * honouring the contract and paying to ask each one again is waste, not
 * resilience. This is what keeps the worst case a number the panel can quote
 * honestly before the user presses the button.
 */
export const MAX_REPAIRS_PER_RUN = 4;

/**
 * The largest previous reply worth sending back for reformatting.
 *
 * A repair rewrites the model's own answer, which for these stages is a short
 * list. Something far larger is not a mis-named property, it is a different
 * failure, and re-sending it would cost more than the section is worth.
 */
const MAX_REPAIR_INPUT_CHARS = 20_000;

const CANCELLED: AnalyzerResult = {
  ok: false,
  errors: ['The request was cancelled.'],
};

export interface RunOptions extends AnalyzeOptions, PlanOptions {
  /** Overridden by the tests; never by the UI. */
  maxRepairs?: number;
}

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

  const budget: RepairBudget = {
    left: options.maxRepairs ?? MAX_REPAIRS_PER_RUN,
  };

  if (plan.mode === 'single') {
    options.onProgress?.({ phase: 'single' });
    return singlePass(analyzer, input, options, budget);
  }

  return sectionedPasses(analyzer, input, plan, options, budget);
}

// ------------------------------------------------- asking, and checking ----

/** How many repairs the whole run has left. Shared by every stage. */
interface RepairBudget {
  left: number;
}

type Checked<T> =
  | { ok: true; value: T }
  /** The request itself failed. Fatal wherever it happens. */
  | { ok: false; fatal: true; errors: string[] }
  /** A reply arrived and could not be used. The caller decides what that costs. */
  | { ok: false; fatal: false; reason: string };

interface AskOptions<T> {
  analyzer: TopicAnalyzer;
  request: ModelRequest;
  /** The top-level array the stage requires, e.g. `topics`. */
  expectedProperty: string;
  /** Parse and check one reply. */
  check: (raw: unknown) => { ok: true; value: T } | { ok: false; errors: string[] };
  where: StageLocation;
  options: RunOptions;
  budget: RepairBudget;
}

/**
 * Send one stage request, check the answer, and repair it once if the only
 * thing wrong was its shape.
 *
 * The repair asks the model to reformat *its own previous reply*, so it costs
 * one small request and sends no conversation text a second time. It is not
 * attempted for a reply that was not JSON at all, for a transport failure, or
 * once the run's repair budget is spent — each of those is a different problem
 * and asking again would not fix any of them.
 */
async function ask<T>({
  analyzer,
  request,
  expectedProperty,
  check,
  where,
  options,
  budget,
}: AskOptions<T>): Promise<Checked<T>> {
  if (options.signal?.aborted) {
    return { ok: false, fatal: true, errors: ['The request was cancelled.'] };
  }

  const reply = await analyzer.complete(request, options);
  if (!reply.ok) return { ok: false, fatal: true, errors: reply.errors };

  const parsed = parseModelJson(reply.text);
  if (parsed === null) {
    return {
      ok: false,
      fatal: false,
      reason: 'the reply was not usable JSON',
    };
  }

  const first = check(parsed);
  if (first.ok) return { ok: true, value: first.value };

  // Structural, and repairable. Say what shape actually arrived — property
  // names only, never values, so this is safe to show and to paste into a
  // bug report.
  const shape = describeShape(parsed, expectedProperty);
  const reason = shapeSummary(shape, expectedProperty);

  const repairable =
    budget.left > 0 &&
    !shape.expectedPresent &&
    reply.text.length <= MAX_REPAIR_INPUT_CHARS &&
    request.schema !== undefined;

  if (!repairable || options.signal?.aborted) {
    return { ok: false, fatal: false, reason };
  }

  budget.left -= 1;
  options.onProgress?.({ phase: 'repair', where: where.stage });

  const repaired = await analyzer.complete(
    {
      stage: request.stage,
      system: REPAIR_SYSTEM_PROMPT,
      user: buildRepairPrompt(request.schema, expectedProperty, reply.text),
      schema: request.schema,
      schemaName: request.schemaName,
      maxOutputTokens: request.maxOutputTokens,
    },
    options,
  );
  if (!repaired.ok) {
    return { ok: false, fatal: true, errors: repaired.errors };
  }

  const reparsed = parseModelJson(repaired.text);
  if (reparsed === null) {
    return { ok: false, fatal: false, reason };
  }
  const second = check(reparsed);
  if (second.ok) return { ok: true, value: second.value };

  return {
    ok: false,
    fatal: false,
    reason: `${reason}, and the same after being asked again`,
  };
}

// ------------------------------------------------------------ one pass -----

async function singlePass(
  analyzer: TopicAnalyzer,
  input: AnalysisInput,
  options: RunOptions,
  budget: RepairBudget,
): Promise<AnalyzerResult> {
  const numbers = input.turns.map((t) => t.number);
  const reserved = reservedTopicIds(input);

  const result = await ask({
    analyzer,
    request: {
      stage: 'single',
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
      schema: TOPIC_PROPOSAL_SCHEMA,
      schemaName: 'chat_threads_topic_proposal',
      maxOutputTokens: OUTPUT_TOKENS.single,
    },
    expectedProperty: 'topics',
    check: (raw) => {
      const v = validateTopicProposal(raw, numbers, reserved);
      return v.ok
        ? ({ ok: true, value: v.proposal } as const)
        : ({ ok: false, errors: v.errors } as const);
    },
    where: { stage: 'analysis' },
    options,
    budget,
  });

  if (result.ok) return { ok: true, proposal: result.value };
  if (result.fatal) return { ok: false, errors: result.errors };
  return { ok: false, errors: [capitalise(result.reason)] };
}

// ------------------------------------------------------- several passes ----

async function sectionedPasses(
  analyzer: TopicAnalyzer,
  input: AnalysisInput,
  plan: AnalysisPlan,
  options: RunOptions,
  budget: RepairBudget,
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

    const result = await ask({
      analyzer,
      request: {
        stage: 'discover',
        system: DISCOVERY_SYSTEM_PROMPT,
        user: buildDiscoveryPrompt(input, section, count),
        schema: TOPIC_LIST_SCHEMA,
        schemaName: 'chat_threads_section_topics',
        maxOutputTokens: OUTPUT_TOKENS.discover,
      },
      expectedProperty: 'topics',
      check: (raw) => {
        const v = validateTopicList(raw, {
          max: MAX_SECTION_TOPICS,
          forbiddenIds: reserved,
          allowEmpty: true,
        });
        return v.ok
          ? ({ ok: true, value: v.topics } as const)
          : ({ ok: false, errors: v.errors } as const);
      },
      where: { stage: 'reading', section: section.index, sections: count },
      options,
      budget,
    });

    // A rejected request will reject the next one too. Stop rather than spend
    // the user's remaining sections finding that out one at a time.
    if (!result.ok && result.fatal) {
      return { ok: false, errors: result.errors };
    }
    if (!result.ok) {
      unreadable += 1;
      found.push({ section: section.index, topics: [] });
      continue;
    }
    found.push({ section: section.index, topics: result.value });
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

  const merged = await ask({
    analyzer,
    request: {
      stage: 'merge',
      system: MERGE_SYSTEM_PROMPT,
      user: buildMergePrompt(input, found, count),
      schema: TOPIC_LIST_SCHEMA,
      schemaName: 'chat_threads_merged_topics',
      maxOutputTokens: OUTPUT_TOKENS.merge,
    },
    expectedProperty: 'topics',
    check: (raw) => {
      const v = validateTopicList(raw, {
        max: MAX_PROPOSED_TOPICS,
        forbiddenIds: reserved,
        // Only defensible when there is somewhere else for turns to go.
        allowEmpty: reserved.length > 0,
      });
      return v.ok
        ? ({ ok: true, value: v.topics } as const)
        : ({ ok: false, errors: v.errors } as const);
    },
    where: { stage: 'reconciling' },
    options,
    budget,
  });

  if (!merged.ok) {
    return {
      ok: false,
      errors: [
        merged.fatal
          ? merged.errors[0]!
          : `The topics from each section could not be combined: ${merged.reason}. The work done on ${count} sections was not applied.`,
      ],
    };
  }

  const canonical: ProposedTopic[] = merged.value;
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

    // This section's own turns, and nothing else. Background context shown for
    // continuity belongs to a neighbour and is refused here, so overlap can
    // never turn into the same turn being filed twice.
    const own = new Set(section.turns.map((t) => t.number));

    const result = await ask({
      analyzer,
      request: {
        stage: 'classify',
        system: CLASSIFY_SYSTEM_PROMPT,
        user: buildClassifyPrompt(input, section, count, canonical),
        schema: SECTION_ASSIGNMENTS_SCHEMA,
        schemaName: 'chat_threads_section_assignments',
        maxOutputTokens: OUTPUT_TOKENS.classify,
      },
      expectedProperty: 'assignments',
      check: (raw) => {
        const v = validateSectionAssignments(raw, own, allowedTopics);
        return v.ok
          ? ({ ok: true, value: v.assignments } as const)
          : ({ ok: false, errors: v.errors } as const);
      },
      where: { stage: 'sorting', section: section.index, sections: count },
      options,
      budget,
    });

    if (!result.ok && result.fatal) {
      return { ok: false, errors: result.errors };
    }
    if (!result.ok) {
      unclassified += 1;
      continue;
    }
    assignments.push(...result.value);
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

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** Re-exported so the panel and the tests agree on what a stage is called. */
export type { AnalysisStage };
