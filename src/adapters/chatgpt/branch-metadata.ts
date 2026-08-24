/**
 * Reading ChatGPT's record of "Branch in new chat".
 *
 * ## What ChatGPT actually stores
 *
 * Established by reading ChatGPT's own web bundle rather than by guessing, and
 * by watching which fields its interface reads back. When the user picks
 * "Branch in new chat" on a message, the app starts a new conversation whose
 * first message is sent with three or four extra fields, which the server then
 * persists on that message's `metadata`:
 *
 *   branching_from_conversation_id     the conversation branched out of
 *   branching_from_message_id          the message inside it it came from
 *   branching_from_conversation_title  that conversation's title at the time
 *   branching_from_conversation_owner  its owner, when not the current user
 *
 * ChatGPT renders those as the "Branched from …" line the user sees, by
 * looking for the first message of a turn that carries them. So the marked
 * message is by construction the *first message of the new branch*: everything
 * before it in this conversation was inherited from the source, everything
 * from it onwards is new. That is what makes the boundary findable.
 *
 * ## What ChatGPT does not store
 *
 * Nothing on the other side. There is no `has_branches`, no branch count, and
 * no list of child conversations anywhere in the payload or the bundle — the
 * relationship is recorded only on the conversation that was created, pointing
 * back at its source. So a conversation that has been branched *out of* cannot
 * be detected from its own data, and Chat Threads says so rather than
 * pretending it looked and found nothing interesting.
 *
 * ## What this deliberately does not treat as a branch
 *
 * A ChatGPT conversation is a tree, and it forks whenever an answer is
 * regenerated, a prompt is edited, or an alternative is picked. None of those
 * is a new-chat branch, and there is a structural reason they can never be
 * confused with one: a new-chat branch lives in a *different conversation*, so
 * it cannot appear as a fork inside this conversation's mapping at all. This
 * module therefore keys on the explicit metadata above and nothing else — it
 * never infers a branch from the shape of the tree.
 */

import {
  noBranches,
  type BranchInfo,
  type BranchPoint,
} from '../../model/branch';

/** The metadata keys ChatGPT writes on the first message of a branch. */
const FROM_CONVERSATION_ID = 'branching_from_conversation_id';
const FROM_MESSAGE_ID = 'branching_from_message_id';
const FROM_CONVERSATION_TITLE = 'branching_from_conversation_title';
const FROM_CONVERSATION_OWNER = 'branching_from_conversation_owner';

const BRANCH_KEYS = [
  FROM_CONVERSATION_ID,
  FROM_MESSAGE_ID,
  FROM_CONVERSATION_TITLE,
  FROM_CONVERSATION_OWNER,
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A trimmed string, or undefined. Never a number, object or empty string. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** One node of the mapping, as the scan needs it. */
export interface BranchScanNode {
  id: string;
  parentId?: string | null;
  /** The raw `message` object. Untrusted. */
  raw: unknown;
}

export interface BranchScanInput {
  /** The active branch, oldest first — the conversation the user can see. */
  path: readonly BranchScanNode[];
  /**
   * Provider message id -> normalized turn sequence, for visible turns only.
   * Used for the exact route: ChatGPT named the message, and it is here.
   */
  sequenceByMessageId: ReadonlyMap<string, number>;
  /**
   * Node id -> the sequence of the last visible turn at or before that node.
   * Used for the positional route, and the reason a branch marker sitting on
   * a hidden provider node still resolves to the right visible turn.
   */
  lastVisibleSequenceByNodeId: ReadonlyMap<string, number>;
}

/** Pull the four fields off one message, if it carries any of them. */
function readMarker(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const metadata = isRecord(raw.metadata) ? raw.metadata : null;
  if (!metadata) return null;
  return BRANCH_KEYS.some((k) => k in metadata) ? metadata : null;
}

/**
 * Find every branch ChatGPT recorded on this conversation.
 *
 * Scans the active branch only: a marker on a path the user is not looking at
 * describes a transcript they are not looking at either, and mapping it to a
 * turn number would point at the wrong turn.
 */
export function detectChatGptBranches(input: BranchScanInput): BranchInfo {
  const points: BranchPoint[] = [];
  const seen = new Set<string>();
  let unreadable = 0;

  for (const node of input.path) {
    const metadata = readMarker(node.raw);
    if (!metadata) continue;

    const sourceConversationId = str(metadata[FROM_CONVERSATION_ID]);
    const branchFromMessageId = str(metadata[FROM_MESSAGE_ID]);
    const sourceConversationTitle = str(metadata[FROM_CONVERSATION_TITLE]);
    const sourceConversationOwner = str(metadata[FROM_CONVERSATION_OWNER]);

    // The keys were there but held nothing usable — a format change, or a
    // half-written record. Counted, never silently treated as "no branch".
    if (
      !sourceConversationId &&
      !branchFromMessageId &&
      !sourceConversationTitle
    ) {
      unreadable += 1;
      continue;
    }

    const resolved = resolveTurn(node, branchFromMessageId, input);

    // One turn can hold several messages, and a retry can leave two markers
    // describing the same branch. Collapse them.
    const key = [
      sourceConversationId ?? '',
      branchFromMessageId ?? '',
      resolved.turnSequence ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    points.push({
      kind: 'new-chat-branch',
      ...(branchFromMessageId ? { branchFromMessageId } : {}),
      ...(resolved.turnSequence !== undefined
        ? { turnSequence: resolved.turnSequence }
        : {}),
      ...(sourceConversationId ? { sourceConversationId } : {}),
      ...(sourceConversationTitle ? { sourceConversationTitle } : {}),
      ...(sourceConversationOwner ? { sourceConversationOwner } : {}),
      confidence: resolved.confidence,
      detail: resolved.detail,
    });
  }

  if (points.length > 0) {
    // Chronological: the scan already walks the path in order, but sorting on
    // the resolved turn keeps two markers on the same node in a sensible order.
    points.sort((a, b) => (a.turnSequence ?? -1) - (b.turnSequence ?? -1));
    return { status: 'found', points };
  }

  if (unreadable > 0) {
    return {
      status: 'indeterminate',
      points: [],
      detail:
        'ChatGPT marked this conversation as branched but did not say where from, so Chat Threads could not place the branch point.',
    };
  }

  return noBranches();
}

interface Resolved {
  turnSequence?: number;
  confidence: BranchPoint['confidence'];
  detail: string;
}

/**
 * Turn a marker into a turn number.
 *
 * Two routes, in order of how much the provider actually told us:
 *
 * 1. ChatGPT named the source message and that message is in this
 *    conversation — the branch inherited it — so the branch point is exactly
 *    that turn.
 * 2. It did not, or the named message belongs to a conversation we are not
 *    looking at. The marked message is the first message of the branch by
 *    construction, so the last visible turn *before* it is the branch point.
 *    Read from the parent rather than the node, so that a marker sitting on a
 *    hidden provider node still lands on the visible turn it belongs to.
 */
function resolveTurn(
  node: BranchScanNode,
  branchFromMessageId: string | undefined,
  input: BranchScanInput,
): Resolved {
  if (branchFromMessageId) {
    const exact = input.sequenceByMessageId.get(branchFromMessageId);
    if (exact !== undefined) {
      return {
        turnSequence: exact,
        confidence: 'confirmed',
        detail: 'ChatGPT named the message this chat was branched from.',
      };
    }
  }

  const parentId = node.parentId ?? undefined;
  const before =
    parentId !== undefined
      ? input.lastVisibleSequenceByNodeId.get(parentId)
      : undefined;

  if (before !== undefined) {
    return {
      turnSequence: before,
      confidence: 'probable',
      detail:
        'ChatGPT recorded the branch but not the exact message, so the last turn before the branch was used.',
    };
  }

  return {
    confidence: 'ambiguous',
    detail:
      'ChatGPT recorded that this chat was branched, but not from which turn.',
  };
}
