/**
 * Where a conversation was branched, in provider-independent terms.
 *
 * ChatGPT's "Branch in new chat" takes a message in one conversation and
 * starts a second conversation from it. The new conversation inherits the
 * history up to that message and then goes its own way. Months and several
 * hundred turns later, finding that boundary again is genuinely hard: it is
 * somewhere in the middle of a very long scroll, and Ctrl-F cannot find it
 * because the marker is not text the user ever wrote.
 *
 * This module is the vocabulary the rest of Chat Threads uses for that. It
 * names no provider field and knows no provider's shape — the ChatGPT-specific
 * reading of it lives in `adapters/chatgpt/branch-metadata.ts`, and a provider
 * that cannot express the idea at all says so with `unsupported` rather than
 * being quietly reported as having no branches.
 */

/**
 * What kind of branch this is.
 *
 * Deliberately one member. A provider tree branches for several reasons —
 * a regenerated answer, an edited prompt, a chosen alternative — and none of
 * those is this. They are ordinary siblings inside one conversation, and
 * reporting them here would bury the one event the user is actually looking
 * for. If another kind ever becomes distinguishable from provider data, it
 * gets a member of its own rather than being folded into this one.
 */
export type BranchKind = 'new-chat-branch';

/**
 * How far the provider data goes.
 *
 * - `confirmed`  the provider named the exact message the branch came from,
 *                and it was found in this conversation.
 * - `probable`   the provider marked the first message of the branch but did
 *                not name the source message, so the turn immediately before
 *                it was used. Right in every ordinary case; inferred rather
 *                than stated.
 * - `ambiguous`  the branch is real but its position could not be pinned to a
 *                turn. Shown, but without a jump target.
 */
export type BranchConfidence = 'confirmed' | 'probable' | 'ambiguous';

/** One branch event, tied to one turn where possible. */
export interface BranchPoint {
  kind: BranchKind;
  /** The provider's id for the message branched from, when it gave one. */
  branchFromMessageId?: string;
  /**
   * The normalized turn this maps to. Absent when the point is real but could
   * not be placed — the UI then shows the branch without offering to jump.
   */
  turnSequence?: number;
  /** The conversation this one was branched out of. */
  sourceConversationId?: string;
  /** That conversation's title, as the provider recorded it at branch time. */
  sourceConversationTitle?: string;
  /**
   * Present when the provider says the source belongs to another account,
   * which is what stops Chat Threads from offering to open it.
   */
  sourceConversationOwner?: string;
  timestamp?: string;
  confidence: BranchConfidence;
  /** One sentence, shown to the user, saying how this was worked out. */
  detail: string;
}

export type BranchStatus =
  /** This provider has no way to express a branch. Nothing was looked for. */
  | 'unsupported'
  /** Looked, and the provider recorded nothing. The ordinary case. */
  | 'none'
  /** At least one branch was found. */
  | 'found'
  /**
   * It could not be determined from the data to hand — either a marker was
   * present but unreadable, or the conversation was read from the page rather
   * than from the provider's own data, which does not carry branch metadata.
   * Never silently reported as 'none'.
   */
  | 'indeterminate';

export interface BranchInfo {
  status: BranchStatus;
  /** Chronological, oldest first. Empty unless `status` is 'found'. */
  points: BranchPoint[];
  /** Why, when the status is not 'found'. Safe to display. */
  detail?: string;
}

/** A provider that cannot express branches at all. */
export function unsupportedBranches(detail: string): BranchInfo {
  return { status: 'unsupported', points: [], detail };
}

/** Looked and found nothing — which is what most conversations are. */
export function noBranches(): BranchInfo {
  return { status: 'none', points: [] };
}

/** The data to hand cannot answer the question either way. */
export function undeterminedBranches(detail: string): BranchInfo {
  return { status: 'indeterminate', points: [], detail };
}
