/**
 * A synthetic conversation big enough to reproduce the failure that version
 * 1.0.1 exists to fix.
 *
 * The real one was 866 turns and roughly 688,000 characters of retained text,
 * which went out as a single OpenAI request and came back rejected. No real
 * conversation is in this repository, so the shape is rebuilt here: the same
 * turn count, the same order of magnitude of text, alternating roles, and a
 * handful of recurring subjects so that a merge step has something genuinely
 * near-duplicate to reconcile.
 *
 * Deterministic on purpose — no randomness anywhere — so a failure is
 * reproducible and a size assertion means the same thing on every machine.
 */

import { buildTurns, freezeConversation } from '../../src/model/conversation';
import type { RawTurnInput } from '../../src/model/conversation';
import type { Role, SourceConversation } from '../../src/model/types';
import {
  createWorkingState,
  type WorkingState,
} from '../../src/operations/working';

/**
 * Subjects the synthetic conversation drifts between.
 *
 * The first three are deliberately three names for one thing. A section that
 * happens to see only one of them will report only that name, which is exactly
 * the near-duplicate the merge step has to collapse.
 */
export const SUBJECTS = [
  'Chrome extension publishing',
  'Web Store submission',
  'Chrome Store setup',
  'Travel plans for Lisbon',
  'Sourdough starter troubleshooting',
  'Refactoring the payment service',
] as const;

export interface LongConversationOptions {
  /** How many turns to build. The observed conversation had 866. */
  turns?: number;
  /** Roughly how long each turn's text is. The observed average was ~794. */
  charsPerTurn?: number;
  title?: string;
  /** Repeat the same role this many times in a row, to test odd runs. */
  roleAt?: (index: number) => Role;
}

/** Filler that reads like prose rather than a run of one character. */
function body(subject: string, index: number, chars: number): string {
  const sentence = `Turn ${index} continues the discussion of ${subject}, picking up where the previous message left off and adding detail that matters later. `;
  let text = '';
  while (text.length < chars) text += sentence;
  return text.slice(0, chars);
}

/** Build the working state for a synthetic conversation of any size. */
export function buildLongConversation(
  options: LongConversationOptions = {},
): WorkingState {
  const count = options.turns ?? 866;
  const chars = options.charsPerTurn ?? 794;
  const roleAt =
    options.roleAt ?? ((i: number): Role => (i % 2 === 0 ? 'user' : 'assistant'));

  const raw: RawTurnInput[] = Array.from({ length: count }, (_, i) => ({
    role: roleAt(i),
    // Change subject every 40 turns, so a section covers one or two of them.
    text: body(SUBJECTS[Math.floor(i / 40) % SUBJECTS.length]!, i, chars),
  }));

  const source: SourceConversation = freezeConversation({
    provider: 'chatgpt',
    conversationId: 'conv-long',
    title: options.title ?? 'A very long conversation',
    url: 'https://chatgpt.com/c/conv-long',
    turns: buildTurns('chatgpt', 'conv-long', raw),
    retrieval: {
      completeness: 'complete',
      method: 'test',
      detail: 'Synthetic fixture.',
      warnings: [],
    },
  });

  return createWorkingState(source);
}
