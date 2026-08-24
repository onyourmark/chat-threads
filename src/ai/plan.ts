/**
 * Deciding how a conversation is sent: in one request, or in sections.
 *
 * The failure this exists to prevent is a real one. An 866-turn conversation
 * produced roughly 688,000 characters of retained text, which went out as a
 * single request and came back rejected — the model had no room for it. The
 * per-turn limit in `buildAnalysisInput` bounds one turn; nothing bounded the
 * total. This module does.
 *
 * ## Where the size limit comes from
 *
 * Characters are not tokens, and Chat Threads deliberately does not try to
 * count tokens: that would mean shipping a tokenizer per provider and getting
 * it wrong the day either provider changes one. Instead the budget is a
 * character budget, derived conservatively enough that the difference does not
 * matter:
 *
 * - Assume the smallest context window worth designing for is 128,000 tokens.
 *   Both defaults — `gpt-4o-mini` and `claude-opus-5` — are at least that, as
 *   is every current model either provider offers by default.
 * - Spend at most a quarter of that window on one request: 32,000 tokens. The
 *   rest is headroom for the reply, for the provider's own accounting, and for
 *   the fact that a user may type a smaller model name into the box.
 * - Assume the worst plausible density of 2 characters per token. English
 *   prose runs nearer 4, and code and JSON nearer 3; 2 covers CJK text, dense
 *   punctuation and long unbroken identifiers without needing a special case.
 *
 * 32,000 x 2 = 64,000 characters, rounded down to 60,000. Everything below —
 * the single-request threshold and the size of one section — is that number.
 *
 * The estimate counts what actually goes out: turn text, the delimiter lines
 * around each turn, and the fixed preamble (system prompt, schema, title,
 * built-in topic rules). It is not `payloadSize`, which counts only turn text
 * and exists to tell the user roughly how much of their conversation leaves
 * the machine.
 */

import type { AnalysisInput, AnalysisTurn } from './types';
import { MAX_REPAIRS_PER_RUN } from './run';
import { SYSTEM_PROMPT } from './prompt';
import { TOPIC_PROPOSAL_SCHEMA } from './schema';
import {
  BUILT_IN_TOPIC_MODEL_ID,
  BUILT_IN_TOPIC_RULES,
} from '../model/default-topic';

/** The largest request Chat Threads will build. See the note above. */
export const SAFE_REQUEST_CHARS = 60_000;

/**
 * What the delimiter and blank lines around one turn cost.
 *
 * `--- Turn 1234 — Assistant (shortened) ---` plus its newlines is about 45
 * characters; 48 rounds it up. It matters at scale: 866 turns is another
 * 41,000 characters that a text-only estimate would miss entirely.
 */
export const PER_TURN_OVERHEAD_CHARS = 48;

/**
 * Room held back inside a section's budget for the canonical topic list.
 *
 * The final pass names every topic and its description in the prompt. Twelve
 * topics at the schema's own length limits is about 4,600 characters; 6,000
 * covers that and the stage instructions around it.
 */
export const TAXONOMY_RESERVE_CHARS = 6_000;

/** A section never shrinks below this, whatever the overheads say. */
export const MIN_SECTION_CHARS = 8_000;

/**
 * The most sections one run will ever plan.
 *
 * Twenty-four sections is 49 model calls and roughly 1.2 million characters —
 * comfortably past the largest conversation observed, and still a bounded,
 * predictable bill. Beyond that Chat Threads refuses before sending anything,
 * rather than quietly making a hundred paid requests on the user's key.
 */
export const MAX_SECTIONS = 24;

/** How many turns before a section are shown to it as background. */
export const CONTEXT_TURNS = 2;

/** How much of each of those turns is shown. Enough to tell what it was. */
export const CONTEXT_TURN_CHARS = 300;

/** One contiguous run of turns, analysed as a unit. */
export interface AnalysisSection {
  /** 1-based, and shown to the user as "section 3 of 15". */
  index: number;
  /** The turns this section is responsible for. Disjoint across sections. */
  turns: AnalysisTurn[];
  /**
   * The last turns of the previous section, shortened, shown as background.
   * Never assignable: the section validator rejects an assignment naming one.
   */
  context: AnalysisTurn[];
  /** Estimated characters this section's turns contribute to a request. */
  chars: number;
}

export interface AnalysisPlan {
  /**
   * `single` sends the conversation in one request, exactly as before.
   * `sections` runs the three-pass workflow. `too-large` sends nothing.
   */
  mode: 'single' | 'sections' | 'too-large';
  /** Estimated size of one request holding the whole conversation. */
  chars: number;
  /** How many sections the conversation divides into. 1 when single. */
  sectionCount: number;
  /** How many model calls the run will make when every reply is well formed. */
  requests: number;
  /**
   * The most it could make: every normal request, plus the run's whole repair
   * budget, plus the one wasted request a model that cannot take a schema
   * costs before the client stops offering it one. Quoted to the user so the
   * number they agree to is a ceiling, not a hope.
   */
  maxRequests: number;
  /** Populated in `sections` mode only. */
  sections: AnalysisSection[];
}

export interface PlanOptions {
  /** Overridden by the tests; never by the UI. */
  safeRequestChars?: number;
  maxSections?: number;
}

/** What one turn costs in a request: its text plus its delimiter line. */
export function turnCost(turn: AnalysisTurn): number {
  return turn.text.length + PER_TURN_OVERHEAD_CHARS;
}

/**
 * Everything in a request that is not turn text.
 *
 * Measured from the real strings rather than guessed, so that editing a prompt
 * cannot silently eat into the safety margin.
 */
export function fixedOverheadChars(input: AnalysisInput): number {
  const hasBuiltIn = input.existingTopics.some(
    (t) => t.id === BUILT_IN_TOPIC_MODEL_ID,
  );
  return (
    SYSTEM_PROMPT.length +
    JSON.stringify(TOPIC_PROPOSAL_SCHEMA).length +
    (input.title?.length ?? 0) +
    (hasBuiltIn ? BUILT_IN_TOPIC_RULES.length : 0) +
    input.existingTopics.reduce(
      (n, t) => n + t.name.length + (t.description?.length ?? 0) + 24,
      0,
    ) +
    // Stage instructions, section headers, and the blank lines between them.
    400
  );
}

/** The size of the request a single-pass run would build. */
export function estimateRequestChars(input: AnalysisInput): number {
  return (
    fixedOverheadChars(input) + input.turns.reduce((n, t) => n + turnCost(t), 0)
  );
}

/**
 * Pack turns into contiguous runs that each fit the budget.
 *
 * Greedy and order-preserving: turn N is always in the same section as, or a
 * later section than, turn N-1. The one refinement is that a section will not
 * end on a user turn whose reply is the turn that did not fit — the question
 * is carried into the next section so it sits with its answer. A section that
 * would be left empty by that is never created.
 *
 * A single turn larger than the whole budget still gets its own section rather
 * than being dropped or cut further: correctness beats tidiness, and the
 * per-turn limit already makes it nearly impossible.
 */
function packTurns(
  turns: readonly AnalysisTurn[],
  budget: number,
): AnalysisTurn[][] {
  const sections: AnalysisTurn[][] = [];
  let current: AnalysisTurn[] = [];
  let size = 0;

  for (const turn of turns) {
    const cost = turnCost(turn);
    if (current.length > 0 && size + cost > budget) {
      let carried: AnalysisTurn | null = null;
      const last = current[current.length - 1]!;
      if (
        current.length > 1 &&
        last.role === 'user' &&
        turn.role === 'assistant'
      ) {
        carried = current.pop()!;
        size -= turnCost(carried);
      }
      sections.push(current);
      current = carried ? [carried] : [];
      size = carried ? turnCost(carried) : 0;
    }
    current.push(turn);
    size += cost;
  }

  if (current.length > 0) sections.push(current);
  return sections;
}

/** Shorten a turn to the length a section shows its predecessors at. */
function asContext(turn: AnalysisTurn): AnalysisTurn {
  if (turn.text.length <= CONTEXT_TURN_CHARS) return turn;
  return {
    ...turn,
    text: `${turn.text.slice(0, CONTEXT_TURN_CHARS)}…`,
    truncated: true,
  };
}

/**
 * Decide how this conversation will be sent, before anything is sent.
 *
 * Pure and synchronous, so the panel can tell the user how many requests they
 * are about to authorise, and so the awkward sizes are testable without a
 * network.
 */
export function planAnalysis(
  input: AnalysisInput,
  options: PlanOptions = {},
): AnalysisPlan {
  const safe = options.safeRequestChars ?? SAFE_REQUEST_CHARS;
  const maxSections = options.maxSections ?? MAX_SECTIONS;
  const chars = estimateRequestChars(input);

  const single: AnalysisPlan = {
    mode: 'single',
    chars,
    sectionCount: 1,
    requests: 1,
    maxRequests: 1 + MAX_REPAIRS_PER_RUN + 1,
    sections: [],
  };

  if (input.turns.length === 0 || chars <= safe) return single;

  const budget = Math.max(
    MIN_SECTION_CHARS,
    safe - fixedOverheadChars(input) - TAXONOMY_RESERVE_CHARS,
  );
  const packed = packTurns(input.turns, budget);

  // One section means the whole thing was a single oversized turn. Splitting
  // it further would not help, and three passes over one section is pure cost.
  if (packed.length <= 1) return single;

  const requests = packed.length * 2 + 1;
  const maxRequests = requests + MAX_REPAIRS_PER_RUN + 1;
  if (packed.length > maxSections) {
    return {
      mode: 'too-large',
      chars,
      sectionCount: packed.length,
      requests,
      maxRequests,
      sections: [],
    };
  }

  const sections: AnalysisSection[] = packed.map((turns, i) => ({
    index: i + 1,
    turns,
    context: i === 0 ? [] : packed[i - 1]!.slice(-CONTEXT_TURNS).map(asContext),
    chars: turns.reduce((n, t) => n + turnCost(t), 0),
  }));

  return {
    mode: 'sections',
    chars,
    sectionCount: sections.length,
    requests,
    maxRequests,
    sections,
  };
}
