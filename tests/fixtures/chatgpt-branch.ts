/**
 * Synthetic ChatGPT payloads for branch detection.
 *
 * Built by hand from the structure ChatGPT's own web bundle reads back — the
 * four `branching_from_*` metadata keys it writes on the first message of a
 * conversation created with "Branch in new chat". No part of any real
 * conversation appears here, and none ever should: see CONTRIBUTING.md.
 *
 * The awkward shapes are deliberate. A regenerated answer and an edited prompt
 * both fork the mapping in exactly the way that would tempt a naive detector
 * into calling them branches, and each has a fixture here so that the test
 * suite fails if one ever starts being reported as one.
 */

type Json = Record<string, unknown>;

let clock = 1_720_000_000;
function nextTime(): number {
  clock += 60;
  return clock;
}

export interface BranchMarker {
  conversationId?: unknown;
  messageId?: unknown;
  title?: unknown;
  owner?: unknown;
}

interface NodeSpec {
  id: string;
  parent: string | null;
  children?: string[];
  role?: string;
  parts?: unknown[];
  hidden?: boolean;
  /** Writes the `branching_from_*` keys onto this message's metadata. */
  branch?: BranchMarker;
  /** Written verbatim into metadata, for the malformed cases. */
  rawMetadata?: Json;
  time?: number;
}

function node(spec: NodeSpec): Json {
  const branch = spec.branch;
  const message =
    spec.role === undefined
      ? null
      : {
          id: `msg-${spec.id}`,
          author: { role: spec.role, name: null, metadata: {} },
          create_time: spec.time ?? nextTime(),
          content: { content_type: 'text', parts: spec.parts ?? [''] },
          status: 'finished_successfully',
          end_turn: true,
          weight: 1,
          metadata: {
            ...(spec.hidden
              ? { is_visually_hidden_from_conversation: true }
              : {}),
            ...(branch
              ? {
                  ...('conversationId' in branch
                    ? { branching_from_conversation_id: branch.conversationId }
                    : {}),
                  ...('messageId' in branch
                    ? { branching_from_message_id: branch.messageId }
                    : {}),
                  ...('title' in branch
                    ? { branching_from_conversation_title: branch.title }
                    : {}),
                  ...('owner' in branch
                    ? { branching_from_conversation_owner: branch.owner }
                    : {}),
                }
              : {}),
            ...(spec.rawMetadata ?? {}),
          },
          recipient: 'all',
        };

  return {
    id: spec.id,
    message,
    parent: spec.parent,
    children: spec.children ?? [],
  };
}

function mapping(nodes: Json[]): Json {
  const out: Json = {};
  for (const n of nodes) out[n.id as string] = n;
  return out;
}

/** A perfectly ordinary conversation. Nothing branched, nothing to find. */
export const chatgptNoBranch: Json = {
  title: 'Sourdough starter',
  conversation_id: 'conv-plain',
  current_node: 'n4',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['My starter smells like acetone. Is it dead?'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['Not dead — hungry. Feed it twice a day for a few days.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      children: ['n4'],
      role: 'user',
      parts: ['What ratio should I feed at?'],
    }),
    node({
      id: 'n4',
      parent: 'n3',
      role: 'assistant',
      parts: ['1:1:1 by weight is a good place to start.'],
    }),
  ]),
};

/**
 * A conversation created by "Branch in new chat".
 *
 * Turns 0-3 were inherited from the source conversation. The user's message at
 * `n5` is the first one they sent in the new chat, and it carries the four
 * metadata keys. `branching_from_message_id` names `msg-n4`, which is present
 * here because the branch inherited it — so the branch point resolves exactly.
 */
export const chatgptBranched: Json = {
  title: 'Feeding schedule',
  conversation_id: 'conv-branched',
  current_node: 'n6',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['My starter smells like acetone. Is it dead?'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['Not dead — hungry. Feed it twice a day for a few days.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      children: ['n4'],
      role: 'user',
      parts: ['What ratio should I feed at?'],
    }),
    node({
      id: 'n4',
      parent: 'n3',
      children: ['n5'],
      role: 'assistant',
      parts: ['1:1:1 by weight is a good place to start.'],
    }),
    node({
      id: 'n5',
      parent: 'n4',
      children: ['n6'],
      role: 'user',
      parts: ['Let us work out a whole week of feeding times.'],
      branch: {
        conversationId: 'conv-plain',
        messageId: 'msg-n4',
        title: 'Sourdough starter',
      },
    }),
    node({
      id: 'n6',
      parent: 'n5',
      role: 'assistant',
      parts: ['Here is a seven-day schedule.'],
    }),
  ]),
};

/**
 * The same, except ChatGPT did not record the source message id.
 *
 * The marked message is still by construction the first of the branch, so the
 * turn before it is the branch point — inferred rather than stated, which is
 * what `probable` means.
 */
export const chatgptBranchedNoMessageId: Json = {
  title: 'Feeding schedule',
  conversation_id: 'conv-branched-2',
  current_node: 'n6',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['My starter smells like acetone. Is it dead?'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['Not dead — hungry.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      children: ['n4'],
      role: 'user',
      parts: ['What ratio should I feed at?'],
    }),
    node({
      id: 'n4',
      parent: 'n3',
      children: ['n5'],
      role: 'assistant',
      parts: ['1:1:1 by weight.'],
    }),
    node({
      id: 'n5',
      parent: 'n4',
      children: ['n6'],
      role: 'user',
      parts: ['Let us work out a whole week of feeding times.'],
      branch: {
        conversationId: 'conv-plain',
        title: 'Sourdough starter',
      },
    }),
    node({
      id: 'n6',
      parent: 'n5',
      role: 'assistant',
      parts: ['Here is a seven-day schedule.'],
    }),
  ]),
};

/**
 * The marker sits on a hidden provider node rather than the visible turn.
 *
 * ChatGPT groups several messages into one displayed turn and hides some of
 * them; the branch record can land on one of those. It must still resolve to
 * the visible turn the branch was taken from, and the hidden node must not
 * become a turn of its own.
 */
export const chatgptBranchedHiddenMarker: Json = {
  title: 'Feeding schedule',
  conversation_id: 'conv-branched-hidden',
  current_node: 'n6',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['My starter smells like acetone. Is it dead?'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['nh'],
      role: 'assistant',
      parts: ['Not dead — hungry. Feed it twice a day.'],
    }),
    node({
      id: 'nh',
      parent: 'n2',
      children: ['n5'],
      role: 'user',
      hidden: true,
      parts: ['Context the interface never shows.'],
      branch: {
        conversationId: 'conv-plain',
        title: 'Sourdough starter',
      },
    }),
    node({
      id: 'n5',
      parent: 'nh',
      children: ['n6'],
      role: 'user',
      parts: ['Let us work out a whole week of feeding times.'],
    }),
    node({
      id: 'n6',
      parent: 'n5',
      role: 'assistant',
      parts: ['Here is a seven-day schedule.'],
    }),
  ]),
};

/**
 * A regenerated assistant answer: one user turn, two assistant children.
 *
 * The commonest fork there is, and never a new-chat branch — the second answer
 * lives in this conversation, not another one.
 */
export const chatgptRegenerated: Json = {
  title: 'Sourdough starter',
  conversation_id: 'conv-regen',
  current_node: 'n2b',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2a', 'n2b'],
      role: 'user',
      parts: ['My starter smells like acetone. Is it dead?'],
    }),
    node({
      id: 'n2a',
      parent: 'n1',
      role: 'assistant',
      parts: ['The first answer, which the user regenerated away.'],
    }),
    node({
      id: 'n2b',
      parent: 'n1',
      role: 'assistant',
      parts: ['The second answer, which is the one on screen.'],
    }),
  ]),
};

/**
 * An edited prompt: one assistant turn, two user children.
 *
 * The other common fork, and also not a new-chat branch.
 */
export const chatgptEditedPrompt: Json = {
  title: 'Sourdough starter',
  conversation_id: 'conv-edit',
  current_node: 'n3b',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['My starter smells odd.'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3a', 'n3b'],
      role: 'assistant',
      parts: ['Tell me more about the smell.'],
    }),
    node({
      id: 'n3a',
      parent: 'n2',
      role: 'user',
      parts: ['It smells of acetone.'],
    }),
    node({
      id: 'n3b',
      parent: 'n2',
      role: 'user',
      parts: ['It smells of acetone, and there is grey liquid on top.'],
    }),
  ]),
};

/**
 * Branch keys present but holding nothing usable.
 *
 * A format change, or a half-written record. It must not be reported as "no
 * branch": the honest answer is that something is there and we cannot read it.
 */
export const chatgptBranchedUnreadable: Json = {
  title: 'Feeding schedule',
  conversation_id: 'conv-branched-bad',
  current_node: 'n3',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['First inherited turn.'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['Second inherited turn.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      role: 'user',
      parts: ['The first message of the branch.'],
      branch: { conversationId: 12345, messageId: null, title: '   ' },
    }),
  ]),
};

/**
 * A long conversation whose branch point is hundreds of turns above the end.
 *
 * This is the case the feature exists for: the boundary is at turn 184 of 866,
 * far out of sight, and not findable with the browser's own Find.
 */
export function chatgptLongBranched(
  options: { turns?: number; branchAt?: number } = {},
): Json {
  const total = options.turns ?? 866;
  const branchAt = options.branchAt ?? 183; // 0-based; turn 184 on screen
  const nodes: Json[] = [node({ id: 'root', parent: null, children: ['t0'] })];

  for (let i = 0; i < total; i += 1) {
    const isBranchStart = i === branchAt + 1;
    nodes.push(
      node({
        id: `t${i}`,
        parent: i === 0 ? 'root' : `t${i - 1}`,
        children: i === total - 1 ? [] : [`t${i + 1}`],
        role: i % 2 === 0 ? 'user' : 'assistant',
        parts: [`Turn ${i} of the branched conversation.`],
        ...(isBranchStart
          ? {
              branch: {
                conversationId: 'conv-source-long',
                messageId: `msg-t${branchAt}`,
                title: 'The original long conversation',
              },
            }
          : {}),
      }),
    );
  }

  return {
    title: 'The branched long conversation',
    conversation_id: 'conv-long-branched',
    current_node: `t${total - 1}`,
    mapping: mapping(nodes),
  };
}

/**
 * Two branch markers in one conversation.
 *
 * Rare, but expressible — a branch of a branch that inherited its parent's
 * marker. Both must be listed, oldest first, rather than one being chosen.
 */
export const chatgptTwoBranchPoints: Json = {
  title: 'Twice branched',
  conversation_id: 'conv-twice',
  current_node: 'n7',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['Inherited from the first conversation.'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['Also inherited.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      children: ['n4'],
      role: 'user',
      parts: ['The first branch started here.'],
      branch: {
        conversationId: 'conv-first',
        messageId: 'msg-n2',
        title: 'The first conversation',
      },
    }),
    node({
      id: 'n4',
      parent: 'n3',
      children: ['n5'],
      role: 'assistant',
      parts: ['An answer in the first branch.'],
    }),
    node({
      id: 'n5',
      parent: 'n4',
      children: ['n6'],
      role: 'user',
      parts: ['The second branch started here.'],
      branch: {
        conversationId: 'conv-second',
        messageId: 'msg-n4',
        title: 'The second conversation',
      },
    }),
    node({
      id: 'n6',
      parent: 'n5',
      children: ['n7'],
      role: 'assistant',
      parts: ['An answer in the second branch.'],
    }),
    node({
      id: 'n7',
      parent: 'n6',
      role: 'user',
      parts: ['Still going.'],
    }),
  ]),
};

/** Branched from a conversation belonging to somebody else. */
export const chatgptBranchedForeignOwner: Json = {
  title: 'From a shared chat',
  conversation_id: 'conv-foreign',
  current_node: 'n3',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n1'] }),
    node({
      id: 'n1',
      parent: 'root',
      children: ['n2'],
      role: 'user',
      parts: ['Inherited turn.'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['Another inherited turn.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      role: 'user',
      parts: ['The first message of the branch.'],
      branch: {
        conversationId: 'conv-someone-else',
        messageId: 'msg-n2',
        title: 'Their conversation',
        owner: 'user-abc123',
      },
    }),
  ]),
};
