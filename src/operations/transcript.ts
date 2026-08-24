/**
 * Turning a working conversation into transcripts the user can paste
 * somewhere else.
 *
 * Generation only ever selects and orders turns and prints their working
 * text verbatim. It never summarizes, rewrites, or invents content — the
 * point of Chat Threads is to carry the real conversation forward.
 */

import type { Turn } from '../model/types';
import { UNASSIGNED } from '../model/types';
import {
  belongsTo,
  sharedTurns,
  type WorkingState,
} from './working';

export type GeneratedKind = 'cleaned' | 'topic';

export interface GeneratedConversation {
  /** Stable within one generation run. */
  id: string;
  kind: GeneratedKind;
  /** Heading shown in the panel, e.g. "Conversation 2: GitHub Promotion". */
  title: string;
  /** The topic this came from, for a split. */
  topicId?: string;
  /** Topic name without the "Conversation n:" prefix. */
  topicName?: string;
  /** Selected turns in chronological order, carrying their working text. */
  turns: readonly Turn[];
  /**
   * How many of `turns` this topic owns, and how many arrived because a person
   * marked them Shared. Split shows both, so the number beside a topic and the
   * size of its exported file can never tell different stories.
   */
  ownTurnCount?: number;
  sharedTurnCount?: number;
}

/** The default continuation instruction, offered as an option. */
export const CONTINUATION_HEADER =
  'The following is a transcript of an earlier conversation. "User" and ' +
  '"Assistant" identify the historical speakers. Treat it as prior context ' +
  'and continue from it.';

export interface RenderOptions {
  /** Prepend the continuation instruction. Defaults to false. */
  includeHeader?: boolean;
  /** Custom continuation text. Defaults to `CONTINUATION_HEADER`. */
  headerText?: string;
  /** Note attachment names under a turn that had them. Defaults to true. */
  includeAttachments?: boolean;
}

/** Turns that survive exclusion, in order. */
function includedTurns(state: WorkingState): Turn[] {
  return state.turns.filter((t) => t.included);
}

/**
 * The cleaned conversation: everything still included, in the original order,
 * regardless of topic assignment.
 */
export function generateCleaned(state: WorkingState): GeneratedConversation {
  return {
    id: 'cleaned',
    kind: 'cleaned',
    title: 'Cleaned Conversation',
    turns: includedTurns(state),
  };
}

/**
 * The turns one topic owns, in conversation order.
 *
 * Own, precisely: assigned to it, or listed among the turn's further topics.
 * Not Shared — a shared turn reaches every topic transcript, but it is not
 * *about* any of them, and treating the two as the same thing is what let a
 * topic with nothing of its own export most of the conversation.
 *
 * Every turn appears at most once: the source list holds each turn once and
 * this only filters it.
 */
export function topicOwnTurns(state: WorkingState, topicId: string): Turn[] {
  return includedTurns(state).filter((t) => belongsTo(t, topicId));
}

/**
 * One conversation per topic.
 *
 * Selection rule, also documented in the README:
 *  - a turn assigned to topic X appears in topic X;
 *  - a turn that belongs to X and Y appears once in each, and nowhere else;
 *  - a turn marked Shared appears in full in *every* topic conversation —
 *    which is why only a person can mark one, never a suggestion;
 *  - a turn left Unassigned appears in none of them;
 *  - an excluded turn appears nowhere at all.
 *
 * This is the only place that decides what is in a topic. Preview, the single
 * Download button and the bulk export all render whatever comes out of here,
 * so there is no second selection rule that could disagree with the first.
 *
 * Topics with no turns of their own are still returned, so the user can see
 * that a topic came out empty rather than silently losing it.
 */
export function generateSplit(state: WorkingState): GeneratedConversation[] {
  const shared = sharedTurns(state);

  return state.topics.map((topic, i) => {
    const own = topicOwnTurns(state, topic.id);
    // A shared turn is never also an owned turn — `belongsTo` ignores SHARED —
    // so concatenating cannot repeat one.
    const turns = [...own, ...shared].sort((a, b) => a.sequence - b.sequence);
    return {
      id: topic.id,
      kind: 'topic' as const,
      title: `Conversation ${i + 1}: ${topic.name}`,
      topicId: topic.id,
      topicName: topic.name,
      turns,
      ownTurnCount: own.length,
      sharedTurnCount: shared.length,
    };
  });
}

/** Turns that would not reach any generated topic conversation. */
export function unassignedIncludedTurns(state: WorkingState): Turn[] {
  return includedTurns(state).filter(
    (t) => t.assignment === UNASSIGNED && t.alsoIn.length === 0,
  );
}

function speaker(turn: Turn): string {
  return turn.role === 'user' ? 'User' : 'Assistant';
}

function attachmentLine(turn: Turn): string | null {
  if (turn.attachments.length === 0) return null;
  const names = turn.attachments.map((a) => a.name).join(', ');
  return `[Attached: ${names}]`;
}

/**
 * Markdown transcript.
 *
 * The turn text is emitted exactly as stored, so fenced code blocks, lists,
 * and tables survive untouched. Only the speaker labels are added.
 */
export function renderMarkdown(
  conversation: GeneratedConversation,
  options: RenderOptions = {},
): string {
  const { includeHeader = false, includeAttachments = true } = options;
  const parts: string[] = [];

  if (includeHeader) {
    parts.push(options.headerText ?? CONTINUATION_HEADER);
  }

  for (const turn of conversation.turns) {
    const block: string[] = [`**${speaker(turn)}:**`];
    const attach = includeAttachments ? attachmentLine(turn) : null;
    if (attach) block.push(attach);
    block.push(turn.workingText.trim());
    parts.push(block.join('\n\n'));
  }

  return `${parts.join('\n\n')}\n`;
}

/** Plain-text transcript. Same content, no Markdown emphasis on the labels. */
export function renderPlainText(
  conversation: GeneratedConversation,
  options: RenderOptions = {},
): string {
  const { includeHeader = false, includeAttachments = true } = options;
  const parts: string[] = [];

  if (includeHeader) {
    parts.push(options.headerText ?? CONTINUATION_HEADER);
  }

  for (const turn of conversation.turns) {
    const block: string[] = [`${speaker(turn)}:`];
    const attach = includeAttachments ? attachmentLine(turn) : null;
    if (attach) block.push(attach);
    block.push(turn.workingText.trim());
    parts.push(block.join('\n\n'));
  }

  return `${parts.join('\n\n')}\n`;
}

/**
 * JSON export. Secondary to copy/paste, but it keeps the common internal
 * message structure so the data stays useful to other tools.
 */
export function renderJson(
  conversation: GeneratedConversation,
  state: WorkingState,
): string {
  return JSON.stringify(
    {
      chatThreadsVersion: 1,
      generated: conversation.title,
      kind: conversation.kind,
      source: {
        provider: state.source.provider,
        conversationId: state.source.conversationId,
        title: state.source.title,
        retrieval: state.source.retrieval,
      },
      messages: conversation.turns.map((t) => ({
        sequence: t.sequence,
        role: t.role,
        text: t.workingText,
        edited: t.edited,
        timestamp: t.timestamp,
        attachments: t.attachments,
        providerMessageId: t.providerMessageId,
      })),
    },
    null,
    2,
  );
}

/** A filename-safe version of a transcript title. */
export function fileNameFor(
  conversation: GeneratedConversation,
  extension: string,
): string {
  const base = conversation.title
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${base || 'conversation'}.${extension}`;
}
