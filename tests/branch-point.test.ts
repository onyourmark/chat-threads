/**
 * Finding where a conversation was branched into a new chat.
 *
 * The user's problem in one sentence: "I branched this conversation a long
 * time ago, and now I cannot find the point again." The branch boundary sits
 * hundreds of turns up, and the browser's own Find cannot reach it because the
 * marker is not text anyone typed.
 *
 * What ChatGPT actually records — the four `branching_from_*` keys on the
 * first message of the new chat — was established by reading ChatGPT's own web
 * bundle, not by guessing. These tests pin down both halves of using it: that
 * a real branch is found and lands on the right turn, and that the far more
 * common forks in a conversation tree are never mistaken for one.
 */

import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { normalizeClaudeConversation } from '../src/adapters/claude/normalize';
import { freezeConversation } from '../src/model/conversation';
import { createWorkingState } from '../src/operations/working';
import { branchPointSequences, focusFor } from '../src/sidepanel/branch-view';
import { parseSourceConversation } from '../src/model/messages';
import type { SourceConversation } from '../src/model/types';
import {
  chatgptBranched,
  chatgptBranchedForeignOwner,
  chatgptBranchedHiddenMarker,
  chatgptBranchedNoMessageId,
  chatgptBranchedUnreadable,
  chatgptEditedPrompt,
  chatgptLongBranched,
  chatgptNoBranch,
  chatgptRegenerated,
  chatgptTwoBranchPoints,
} from './fixtures/chatgpt-branch';
import { claudeShort } from './fixtures/claude';

function load(payload: unknown): SourceConversation {
  return freezeConversation(
    normalizeChatGptConversation(payload, {
      url: 'https://chatgpt.com/c/x',
      method: 'test',
    }),
  );
}

// -------------------------------------------------------- ordinary chats ---

describe('a conversation that was never branched', () => {
  it('reports that it looked and found nothing', () => {
    const c = load(chatgptNoBranch);

    expect(c.branches.status).toBe('none');
    expect(c.branches.points).toEqual([]);
  });

  it('puts no badge on any turn', () => {
    const c = load(chatgptNoBranch);
    expect(branchPointSequences(c.branches).size).toBe(0);
  });

  it('does not disturb the transcript', () => {
    const c = load(chatgptNoBranch);
    expect(c.turns).toHaveLength(4);
    expect(c.turns[0]?.originalText).toContain('acetone');
  });
});

// --------------------------------------------------------- a real branch ---

describe('a conversation created with "Branch in new chat"', () => {
  it('finds the branch and names the turn it came from', () => {
    const c = load(chatgptBranched);

    expect(c.branches.status).toBe('found');
    expect(c.branches.points).toHaveLength(1);

    const point = c.branches.points[0]!;
    expect(point.kind).toBe('new-chat-branch');
    // msg-n4 is the last inherited turn: turn 4 on screen, sequence 3.
    expect(point.turnSequence).toBe(3);
    expect(point.branchFromMessageId).toBe('msg-n4');
    expect(point.sourceConversationId).toBe('conv-plain');
    expect(point.sourceConversationTitle).toBe('Sourdough starter');
    expect(point.confidence).toBe('confirmed');
  });

  it('points at the turn the user actually branched from', () => {
    const c = load(chatgptBranched);
    const sequence = c.branches.points[0]!.turnSequence!;

    const turn = c.turns.find((t) => t.sequence === sequence)!;
    expect(turn.role).toBe('assistant');
    expect(turn.originalText).toContain('1:1:1 by weight');

    // And the next turn is the first one written in the new chat.
    const next = c.turns.find((t) => t.sequence === sequence + 1)!;
    expect(next.originalText).toContain('whole week of feeding times');
  });

  it('marks exactly one turn for the badge', () => {
    const c = load(chatgptBranched);
    expect([...branchPointSequences(c.branches)]).toEqual([3]);
  });

  it('falls back to the turn before the branch when no message id is given', () => {
    const c = load(chatgptBranchedNoMessageId);

    expect(c.branches.status).toBe('found');
    const point = c.branches.points[0]!;
    expect(point.turnSequence).toBe(3);
    expect(point.confidence).toBe('probable');
    expect(point.detail).toMatch(/not the exact message/i);
  });

  it('records the source conversation for a link, when it is the user\'s own', () => {
    const mine = load(chatgptBranched).branches.points[0]!;
    expect(mine.sourceConversationId).toBe('conv-plain');
    expect(mine.sourceConversationOwner).toBeUndefined();

    // Someone else's conversation: the id is kept, but the owner is recorded,
    // which is what stops the panel offering to open it.
    const theirs = load(chatgptBranchedForeignOwner).branches.points[0]!;
    expect(theirs.sourceConversationId).toBe('conv-someone-else');
    expect(theirs.sourceConversationOwner).toBe('user-abc123');
  });
});

// ------------------------------------------------- hidden provider nodes ---

describe('a branch marker on a hidden provider node', () => {
  it('resolves to the visible turn, and stays out of the transcript', () => {
    const c = load(chatgptBranchedHiddenMarker);

    expect(c.branches.status).toBe('found');
    expect(c.branches.points[0]!.turnSequence).toBe(1);

    // The hidden node carried the marker but is not a turn.
    const all = c.turns.map((t) => t.originalText).join('\n');
    expect(all).not.toContain('Context the interface never shows');
    expect(c.turns).toHaveLength(4);

    const turn = c.turns.find((t) => t.sequence === 1)!;
    expect(turn.originalText).toContain('Feed it twice a day');
  });
});

// --------------------------------------------- not a new-chat branch -------

describe('ordinary forks in the conversation tree', () => {
  it('does not call a regenerated answer a branch', () => {
    const c = load(chatgptRegenerated);

    expect(c.branches.status).toBe('none');
    expect(c.branches.points).toEqual([]);
    // The fork is real — the active branch followed one side of it.
    expect(c.turns).toHaveLength(2);
    expect(c.turns[1]?.originalText).toContain('the one on screen');
  });

  it('does not call an edited prompt a branch', () => {
    const c = load(chatgptEditedPrompt);

    expect(c.branches.status).toBe('none');
    expect(c.branches.points).toEqual([]);
    expect(c.turns[2]?.originalText).toContain('grey liquid');
  });

  it('needs the explicit metadata, not a shape in the tree', () => {
    // Both fixtures fork; neither carries a branching_from_* key. If detection
    // ever starts inferring from fan-out, these two go red first.
    for (const payload of [chatgptRegenerated, chatgptEditedPrompt]) {
      expect(load(payload).branches.status).toBe('none');
    }
  });
});

// ------------------------------------------------------- long and multiple -

describe('a branch point far above the end of a long conversation', () => {
  it('finds turn 184 of 866', () => {
    const c = load(chatgptLongBranched());

    expect(c.turns).toHaveLength(866);
    expect(c.branches.status).toBe('found');

    const point = c.branches.points[0]!;
    expect(point.turnSequence).toBe(183);
    expect(point.confidence).toBe('confirmed');
    // What the panel shows, and what the turn card shows, agree.
    expect(point.turnSequence! + 1).toBe(184);
  });

  it('navigates to the right turn id', () => {
    const state = createWorkingState(load(chatgptLongBranched()));
    const sequence = state.source.branches.points[0]!.turnSequence!;
    const turn = state.turns.find((t) => t.sequence === sequence)!;

    expect(turn.id).toBe('chatgpt-183');
    expect(turn.originalText).toBe('Turn 183 of the branched conversation.');

    // Asking for it twice produces two distinct focus requests, so pressing
    // the button again scrolls again.
    expect(focusFor({ turnId: turn.id, nonce: 1 }, turn)).toBe(1);
    expect(focusFor({ turnId: turn.id, nonce: 2 }, turn)).toBe(2);
    expect(focusFor({ turnId: 'chatgpt-0', nonce: 2 }, turn)).toBeNull();
  });

  it('works wherever the branch sits', () => {
    for (const branchAt of [0, 1, 50, 400, 864]) {
      const c = load(chatgptLongBranched({ turns: 866, branchAt }));
      expect(c.branches.points[0]?.turnSequence, `branchAt ${branchAt}`).toBe(
        branchAt,
      );
    }
  });
});

describe('more than one branch point', () => {
  it('lists them all, oldest first', () => {
    const c = load(chatgptTwoBranchPoints);

    expect(c.branches.status).toBe('found');
    expect(c.branches.points.map((p) => p.turnSequence)).toEqual([1, 3]);
    expect(c.branches.points.map((p) => p.sourceConversationTitle)).toEqual([
      'The first conversation',
      'The second conversation',
    ]);
    expect([...branchPointSequences(c.branches)].sort((a, b) => a - b)).toEqual([
      1, 3,
    ]);
  });
});

// ------------------------------------------------------- failing safely ----

describe('when the provider data is not what it was', () => {
  it('says so rather than reporting no branch', () => {
    const c = load(chatgptBranchedUnreadable);

    expect(c.branches.status).toBe('indeterminate');
    expect(c.branches.points).toEqual([]);
    expect(c.branches.detail).toMatch(/could not place/i);
    // The conversation itself still loads.
    expect(c.turns).toHaveLength(3);
  });

  it('ignores metadata of the wrong type without throwing', () => {
    const payload = {
      title: 'Odd',
      conversation_id: 'c',
      current_node: 'n1',
      mapping: {
        root: { id: 'root', message: null, parent: null, children: ['n1'] },
        n1: {
          id: 'n1',
          parent: 'root',
          children: [],
          message: {
            id: 'msg-n1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['Hello'] },
            metadata: { branching_from_conversation_id: { nested: true } },
          },
        },
      },
    };

    const c = load(payload);
    expect(c.branches.status).toBe('indeterminate');
    expect(c.turns).toHaveLength(1);
  });

});

describe('a provider with no notion of branching', () => {
  it('says unsupported rather than none', () => {
    const c = normalizeClaudeConversation(claudeShort, {
      url: 'https://claude.ai/chat/x',
      method: 'test',
    });

    expect(c.branches.status).toBe('unsupported');
    expect(c.branches.points).toEqual([]);
    expect(c.branches.detail).toMatch(/Claude does not record/i);
    // Which is not the same as "no branches", and does not badge anything.
    expect(branchPointSequences(c.branches).size).toBe(0);
  });
});

// ----------------------------------------------- crossing the boundary -----

describe('branch information sent from the content script', () => {
  it('survives the trip intact', () => {
    const original = load(chatgptBranched);
    const revived = parseSourceConversation(
      JSON.parse(JSON.stringify(original)),
    );

    expect(revived).not.toBeNull();
    expect(revived!.branches.status).toBe('found');
    expect(revived!.branches.points[0]!.turnSequence).toBe(3);
    expect(revived!.branches.points[0]!.sourceConversationTitle).toBe(
      'Sourdough starter',
    );
  });

  it('is not invented when the message did not carry any', () => {
    const original = JSON.parse(JSON.stringify(load(chatgptBranched)));
    delete original.branches;

    const revived = parseSourceConversation(original);
    expect(revived!.branches.status).toBe('indeterminate');
    expect(revived!.branches.points).toEqual([]);
  });

  it('refuses a "found" with nothing in it', () => {
    const original = JSON.parse(JSON.stringify(load(chatgptBranched)));
    original.branches = { status: 'found', points: [] };

    const revived = parseSourceConversation(original);
    expect(revived!.branches.status).toBe('indeterminate');
  });

  it('drops a point of an unknown kind', () => {
    const original = JSON.parse(JSON.stringify(load(chatgptBranched)));
    original.branches.points.push({
      kind: 'something-else',
      turnSequence: 99,
      confidence: 'confirmed',
      detail: 'x',
    });

    const revived = parseSourceConversation(original);
    expect(revived!.branches.points).toHaveLength(1);
    expect(revived!.branches.points[0]!.turnSequence).toBe(3);
  });
});

// -------------------------------------------------------------- privacy ----

describe('branch detection is local and free', () => {
  it('makes no network request and needs no key', () => {
    const calls: unknown[] = [];
    const original = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = (...args: unknown[]) => {
      calls.push(args);
      throw new Error('branch detection must not use the network');
    };
    try {
      const c = load(chatgptLongBranched({ turns: 200, branchAt: 20 }));
      expect(c.branches.status).toBe('found');
    } finally {
      (globalThis as { fetch: unknown }).fetch = original;
    }
    expect(calls).toEqual([]);
  });
});
