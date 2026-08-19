/**
 * Building what gets sent to a model, and nothing more.
 *
 * `buildAnalysisInput` is the only place a conversation becomes an outgoing
 * payload. It selects fields explicitly rather than passing turn objects
 * through, so a future field added to `Turn` cannot silently start being
 * transmitted.
 */

import type { WorkingState } from '../operations/working';
import type { AnalysisInput, AnalysisTurn } from './types';
import { TOPIC_PROPOSAL_SCHEMA } from './schema';

export interface BuildOptions {
  /**
   * Longest run of text sent per turn. Turns above this are cut and marked
   * truncated. Topic classification only needs the gist, so the default sends
   * markedly less than the full conversation.
   */
  maxCharsPerTurn?: number;
}

export const DEFAULT_MAX_CHARS_PER_TURN = 1500;

/**
 * Build the analysis payload from the working conversation.
 *
 * Excluded turns are left out entirely: the user has already said they do not
 * want them, so there is no reason to send them anywhere. Working text is
 * used rather than original text, for the same reason — an edit that removed
 * something private must not be undone on the way out.
 */
export function buildAnalysisInput(
  state: WorkingState,
  options: BuildOptions = {},
): AnalysisInput {
  const max = options.maxCharsPerTurn ?? DEFAULT_MAX_CHARS_PER_TURN;
  const turns: AnalysisTurn[] = state.turns
    .filter((t) => t.included)
    .map((t) => {
      const full = t.workingText.trim();
      const truncated = full.length > max;
      return {
        number: t.sequence,
        role: t.role,
        text: truncated ? `${full.slice(0, max)}…` : full,
        truncated,
      };
    });

  return state.source.title
    ? { turns, title: state.source.title }
    : { turns };
}

/** How many characters the payload will contain, for the confirmation dialog. */
export function payloadSize(input: AnalysisInput): number {
  return input.turns.reduce((n, t) => n + t.text.length, 0);
}

export const SYSTEM_PROMPT = [
  'You sort the turns of a single chat conversation into the distinct topics it contains.',
  '',
  'Rules:',
  '- Identify only topics that are actually present. If the whole conversation is about one thing, return one topic.',
  '- Name each topic in a few plain words a person would recognise, e.g. "Browser extension design" or "Travel plans".',
  '- Assign every turn you are given to exactly one topic id, or to "shared".',
  '- Use "shared" only for turns that genuinely belong with every topic, such as an opening greeting or a general instruction that applies throughout.',
  '- Keep a question and its answer in the same topic.',
  '- Set "uncertain" to true whenever you are not confident, rather than guessing quietly.',
  '- Do not rewrite, summarise, translate, or comment on the conversation. Only classify it.',
  '- Reply with JSON matching the schema and nothing else.',
].join('\n');

/** The user-role message: the schema, then the numbered turns. */
export function buildUserPrompt(input: AnalysisInput): string {
  const lines: string[] = [];

  if (input.title) {
    lines.push(`Conversation title: ${input.title}`, '');
  }
  lines.push(
    'Return JSON matching this schema:',
    JSON.stringify(TOPIC_PROPOSAL_SCHEMA),
    '',
    'Here are the turns. Use the number shown for each one.',
    '',
  );

  for (const t of input.turns) {
    const speaker = t.role === 'user' ? 'User' : 'Assistant';
    const note = t.truncated ? ' (shortened)' : '';
    lines.push(`--- Turn ${t.number} — ${speaker}${note} ---`, t.text, '');
  }

  return lines.join('\n');
}
