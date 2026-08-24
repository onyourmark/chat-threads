/**
 * What actually ends up in a topic file.
 *
 * The live failure this exists to prevent: after Find Topics on a real
 * ~876-turn conversation, every exported topic file was 2.8–3.5 MB against a
 * complete cleaned conversation of 4.5 MB. Even "Why is AI so stupid.md" —
 * a topic nobody had touched — was 2.8 MB. Each topic was receiving most of
 * the conversation.
 *
 * The cause was Shared. A shared turn is copied into every topic transcript by
 * design, the model was offered "shared" as a value, and it used it as a
 * catch-all for turns it could not confidently place. Several hundred such
 * turns made every topic file approximately the whole conversation, and made
 * the count beside a topic in Split ("23 turns") bear no relation to the file
 * that came out.
 *
 * These tests assert the corrected semantics from both ends: what membership
 * means, and what the exported bytes contain.
 */

import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { buildTurns, freezeConversation } from '../src/model/conversation';
import type { RawTurnInput } from '../src/model/conversation';
import { SHARED, UNASSIGNED, type SourceConversation } from '../src/model/types';
import { noBranches } from '../src/model/branch';
import {
  BUILT_IN_TOPIC_NAME,
  isPristineDefaultTopic,
} from '../src/model/default-topic';
import {
  addTopic,
  addTurnToTopic,
  assignmentSummary,
  countAssignedTo,
  createWorkingState,
  removeTopic,
  removeTurnFromTopic,
  resetTopicIds,
  setAssignment,
  setIncluded,
  sharedTurns,
  type WorkingState,
} from '../src/operations/working';
import {
  generateCleaned,
  generateSplit,
  renderMarkdown,
  topicOwnTurns,
} from '../src/operations/transcript';
import { applyProposal } from '../src/ai/apply';
import { validateTopicProposal } from '../src/ai/schema';
import { validateSectionAssignments } from '../src/ai/stages';
import { chatgptMixedTopics } from './fixtures/chatgpt';

function small(): WorkingState {
  resetTopicIds();
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    ),
  );
}

/** Three topics, and a handle on each. */
function threeTopics(): {
  state: WorkingState;
  a: string;
  b: string;
  c: string;
} {
  let state = small();
  state = addTopic(state, 'Topic A');
  state = addTopic(state, 'Topic B');
  state = addTopic(state, 'Topic C');
  const [a, b, c] = state.topics.filter((t) => !t.builtIn).map((t) => t.id);
  return { state, a: a!, b: b!, c: c! };
}

// ------------------------------------------------------------ semantics ---

describe('what belonging to a topic means', () => {
  it('a turn in A appears only in A', () => {
    const { state, a, b, c } = threeTopics();
    const next = setAssignment(state, 'chatgpt-0', a);

    expect(topicOwnTurns(next, a).map((t) => t.id)).toEqual(['chatgpt-0']);
    expect(topicOwnTurns(next, b)).toEqual([]);
    expect(topicOwnTurns(next, c)).toEqual([]);
  });

  it('a turn in A and B appears once in each, and not in C', () => {
    const { state, a, b, c } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);

    expect(topicOwnTurns(next, a).map((t) => t.id)).toEqual(['chatgpt-0']);
    expect(topicOwnTurns(next, b).map((t) => t.id)).toEqual(['chatgpt-0']);
    expect(topicOwnTurns(next, c)).toEqual([]);
  });

  it('an unassigned turn appears in no topic', () => {
    const { state, a, b } = threeTopics();
    expect(topicOwnTurns(state, a)).toEqual([]);
    expect(topicOwnTurns(state, b)).toEqual([]);
    expect(generateSplit(state).every((c) => c.turns.length === 0)).toBe(true);
  });

  it('an excluded turn appears nowhere, even in a topic it belongs to', () => {
    const { state, a } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', a);
    next = setIncluded(next, 'chatgpt-0', false);

    expect(topicOwnTurns(next, a)).toEqual([]);
    expect(generateCleaned(next).turns.map((t) => t.id)).not.toContain(
      'chatgpt-0',
    );
  });

  it('no turn appears twice inside one topic', () => {
    const { state, a } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    // Ask for the same membership twice, and add a shared turn as well.
    next = addTurnToTopic(next, 'chatgpt-0', a);
    next = setAssignment(next, 'chatgpt-1', SHARED);

    const conversation = generateSplit(next).find((c) => c.topicId === a)!;
    const ids = conversation.turns.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shared means every topic, and only a person can say so', () => {
    const { state, a, b, c } = threeTopics();
    const next = setAssignment(state, 'chatgpt-0', SHARED);

    for (const id of [a, b, c]) {
      const conversation = generateSplit(next).find((x) => x.topicId === id)!;
      expect(conversation.turns.map((t) => t.id)).toEqual(['chatgpt-0']);
      // But it belongs to none of them.
      expect(conversation.ownTurnCount).toBe(0);
      expect(conversation.sharedTurnCount).toBe(1);
    }
    expect(sharedTurns(next)).toHaveLength(1);
  });

  it('choosing one topic from the dropdown replaces every other membership', () => {
    const { state, a, b } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);
    expect(next.turns[0]!.alsoIn).toEqual([b]);

    next = setAssignment(next, 'chatgpt-0', a);
    expect(next.turns[0]!.alsoIn).toEqual([]);
    expect(topicOwnTurns(next, b)).toEqual([]);
  });

  it('removing a turn from one topic leaves the others alone', () => {
    const { state, a, b } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);

    next = removeTurnFromTopic(next, 'chatgpt-0', b);
    expect(topicOwnTurns(next, a).map((t) => t.id)).toEqual(['chatgpt-0']);
    expect(topicOwnTurns(next, b)).toEqual([]);

    // Removing the primary promotes the other, rather than losing both.
    let other = addTurnToTopic(
      setAssignment(state, 'chatgpt-0', a),
      'chatgpt-0',
      b,
    );
    other = removeTurnFromTopic(other, 'chatgpt-0', a);
    expect(other.turns[0]!.assignment).toBe(b);
    expect(other.turns[0]!.alsoIn).toEqual([]);
  });

  it('deleting a topic does not strand a turn that was also in another', () => {
    const { state, a, b } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);

    next = removeTopic(next, a);
    expect(next.turns[0]!.assignment).toBe(b);
    expect(next.turns[0]!.alsoIn).toEqual([]);
    expect(topicOwnTurns(next, b).map((t) => t.id)).toEqual(['chatgpt-0']);
  });
});

// ------------------------------------------------ the AI cannot use shared -

describe('a suggestion can never make a turn Shared', () => {
  it('refuses "shared" from the single-request path, and says so', () => {
    const result = validateTopicProposal(
      {
        topics: [{ id: 't1', name: 'A' }],
        assignments: [
          { turn: 0, topic: 't1' },
          { turn: 1, topic: 'shared' },
          { turn: 2, topic: 'shared' },
        ],
      },
      [0, 1, 2],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.assignments.map((a) => a.turn)).toEqual([0]);
    expect(result.proposal.unplaced).toEqual([1, 2]);
    expect(result.proposal.notes.join(' ')).toMatch(/Shared is yours to set/i);
  });

  it('refuses "shared" from a section of a long run', () => {
    const result = validateSectionAssignments(
      {
        assignments: [
          { turn: 0, topic: 'c1' },
          { turn: 1, topic: 'shared' },
        ],
      },
      new Set([0, 1]),
      new Set(['c1']),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments.map((a) => a.turn)).toEqual([0]);
    expect(result.dropped).toBe(1);
  });

  it('never produces a Shared turn when a proposal is applied', () => {
    const state = threeTopics().state;
    const applied = applyProposal(state, {
      topics: [
        { id: 't1', name: 'One' },
        { id: 't2', name: 'Two' },
      ],
      assignments: [
        { turn: 0, topic: 't1', uncertain: false },
        { turn: 1, topic: 't1', uncertain: false },
        { turn: 1, topic: 't2', uncertain: true },
      ],
      unplaced: [],
      notes: [],
    });

    expect(applied.turns.every((t) => t.assignment !== SHARED)).toBe(true);
    // And the two-topic turn really is in two, not all.
    const proposed = applied.topics.filter((t) => t.fromProposal);
    expect(applied.turns[1]!.assignment).toBe(proposed[0]!.id);
    expect(applied.turns[1]!.alsoIn).toEqual([proposed[1]!.id]);
    expect(applied.turns[1]!.uncertain).toBe(true);
  });

  it('does not offer "shared" to the model anywhere', async () => {
    const { TOPIC_PROPOSAL_SCHEMA } = await import('../src/ai/schema');
    const { SECTION_ASSIGNMENTS_SCHEMA, CLASSIFY_SYSTEM_PROMPT } = await import(
      '../src/ai/stages'
    );
    const { SYSTEM_PROMPT } = await import('../src/ai/prompt');

    // The schema descriptions used to name it as a value to use.
    expect(JSON.stringify(TOPIC_PROPOSAL_SCHEMA)).not.toMatch(
      /"shared" when the turn belongs/,
    );
    expect(JSON.stringify(SECTION_ASSIGNMENTS_SCHEMA)).not.toMatch(
      /"shared" when the turn belongs/,
    );
    // And both prompts now tell it not to.
    expect(SYSTEM_PROMPT).toMatch(/never use "shared"/i);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/never use "shared"/i);
  });
});

// ------------------------------------------ the built-in topic, untouched --

describe('an untouched "Why is AI so stupid?"', () => {
  it('has nothing of its own, however many Shared turns exist', () => {
    const { state } = threeTopics();
    let next = state;
    for (const id of ['chatgpt-0', 'chatgpt-1', 'chatgpt-2']) {
      next = setAssignment(next, id, SHARED);
    }

    const builtIn = next.topics.find((t) => t.builtIn)!;
    expect(isPristineDefaultTopic(builtIn)).toBe(true);

    const conversation = generateSplit(next).find(
      (c) => c.topicId === builtIn.id,
    )!;
    expect(conversation.ownTurnCount).toBe(0);
    expect(countAssignedTo(next, builtIn.id)).toBe(0);

    // Which is what Output filters on, so it stays out of the export.
    const shown = generateSplit(next).filter((c) => {
      const topic = next.topics.find((t) => t.id === c.topicId);
      if (!topic || !isPristineDefaultTopic(topic)) return true;
      return (c.ownTurnCount ?? c.turns.length) > 0;
    });
    expect(shown.map((c) => c.topicName)).not.toContain(BUILT_IN_TOPIC_NAME);
  });

  it('appears once it has a turn of its own', () => {
    const { state } = threeTopics();
    const builtIn = state.topics.find((t) => t.builtIn)!;
    const next = setAssignment(state, 'chatgpt-0', builtIn.id);

    const conversation = generateSplit(next).find(
      (c) => c.topicId === builtIn.id,
    )!;
    expect(conversation.ownTurnCount).toBe(1);
  });
});

// -------------------------------------------------- the live-sized case ---

/** A conversation the size of the one that failed. */
function bigConversation(turns = 876): SourceConversation {
  const raw: RawTurnInput[] = Array.from({ length: turns }, (_, i) => ({
    role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text: `Turn ${i}. ${'Conversation text that makes this turn a realistic size. '.repeat(12)}`,
  }));
  return freezeConversation({
    provider: 'chatgpt',
    conversationId: 'big',
    title: 'A very long conversation',
    url: 'https://chatgpt.com/c/big',
    turns: buildTurns('chatgpt', 'big', raw),
    retrieval: {
      completeness: 'complete',
      method: 'test',
      detail: 'Synthetic.',
      warnings: [],
    },
    branches: noBranches(),
  });
}

describe('876 turns across fifteen topics', () => {
  /** Fifteen topics, each owning one fifteenth of the conversation. */
  function spread(): WorkingState {
    resetTopicIds();
    let state = createWorkingState(bigConversation());
    for (let i = 0; i < 15; i += 1) state = addTopic(state, `Topic ${i + 1}`);

    const topics = state.topics.filter((t) => !t.builtIn).map((t) => t.id);
    const updates = state.turns.map((t, i) => ({
      turnId: t.id,
      assignment: topics[i % 15]!,
    }));
    // One block of turns genuinely belongs to two topics.
    return updates.reduce((acc, u, i) => {
      let next = setAssignment(acc, u.turnId, u.assignment);
      if (i >= 100 && i < 130) next = addTurnToTopic(next, u.turnId, topics[0]!);
      return next;
    }, state);
  }

  it('gives each topic its own share, not most of the conversation', () => {
    const state = spread();
    const cleaned = renderMarkdown(generateCleaned(state)).length;
    const split = generateSplit(state).filter((c) => c.turns.length > 0);

    expect(split).toHaveLength(15);
    for (const conversation of split) {
      const size = renderMarkdown(conversation).length;
      // The live failure was every file at 60–78% of the whole. A fifteenth
      // is under 7%; the topic that picked up the extra block is still small.
      expect(size / cleaned, conversation.title).toBeLessThan(0.15);
    }
  });

  it('gives the topics substantially different contents', () => {
    const split = generateSplit(spread()).filter((c) => c.turns.length > 0);
    const membership = split.map((c) => new Set(c.turns.map((t) => t.id)));

    // No two topics hold the same turns, and no turn is in every topic.
    const everywhere = [...membership[0]!].filter((id) =>
      membership.every((m) => m.has(id)),
    );
    expect(everywhere).toEqual([]);

    for (let i = 1; i < membership.length; i += 1) {
      const overlap = [...membership[i]!].filter((id) => membership[0]!.has(id));
      // Only the deliberate two-topic block overlaps with the first topic.
      expect(overlap.length).toBeLessThan(membership[i]!.size);
    }
  });

  it('accounts for every turn exactly as assigned', () => {
    const state = spread();
    const split = generateSplit(state);
    const appearances = new Map<string, number>();
    for (const conversation of split) {
      for (const turn of conversation.turns) {
        appearances.set(turn.id, (appearances.get(turn.id) ?? 0) + 1);
      }
    }

    for (const turn of state.turns) {
      const expected = 1 + turn.alsoIn.length;
      expect(appearances.get(turn.id) ?? 0, turn.id).toBe(expected);
    }
  });

  it('reproduces the live failure when Shared is used at that scale', () => {
    // Not a regression test for a bug that still exists — a demonstration of
    // why a suggestion is no longer allowed to do this. Six hundred shared
    // turns is what made every file most of the conversation.
    let state = spread();
    for (let i = 0; i < 600; i += 1) {
      state = setAssignment(state, `chatgpt-${i}`, SHARED);
    }

    const cleaned = renderMarkdown(generateCleaned(state)).length;
    const worst = Math.max(
      ...generateSplit(state).map((c) => renderMarkdown(c).length),
    );
    expect(worst / cleaned).toBeGreaterThan(0.6);

    // And the count beside the topic now says why, instead of showing a small
    // number next to a huge file.
    expect(sharedTurns(state)).toHaveLength(600);
  });
});

// ------------------------------------------------------------- counting ---

describe('the number beside a topic', () => {
  it('counts a two-topic turn once in each topic', () => {
    const { state, a, b } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);

    expect(countAssignedTo(next, a)).toBe(1);
    expect(countAssignedTo(next, b)).toBe(1);
  });

  it('does not count Shared turns as belonging to the topic', () => {
    const { state, a } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = setAssignment(next, 'chatgpt-1', SHARED);

    expect(countAssignedTo(next, a)).toBe(1);
    const conversation = generateSplit(next).find((c) => c.topicId === a)!;
    expect(conversation.ownTurnCount).toBe(1);
    expect(conversation.sharedTurnCount).toBe(1);
    // The file has both, which is why Split shows both numbers.
    expect(conversation.turns).toHaveLength(2);
  });

  it('matches what the topic file will contain', () => {
    const { state, a, b } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);
    next = setAssignment(next, 'chatgpt-2', a);
    next = setAssignment(next, 'chatgpt-3', SHARED);

    for (const id of [a, b]) {
      const conversation = generateSplit(next).find((c) => c.topicId === id)!;
      expect(conversation.ownTurnCount).toBe(countAssignedTo(next, id));
      expect(conversation.turns.length).toBe(
        (conversation.ownTurnCount ?? 0) + (conversation.sharedTurnCount ?? 0),
      );
    }
  });

  it('leaves an unassigned turn out of every count', () => {
    const { state, a } = threeTopics();
    expect(countAssignedTo(state, a)).toBe(0);
    expect(state.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });
});

// ------------------------------------------------------ the safe summary ---

describe('the assignment summary', () => {
  it('counts distribution without carrying any conversation text', () => {
    const { state, a, b } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = addTurnToTopic(next, 'chatgpt-0', b);
    next = setAssignment(next, 'chatgpt-1', b);
    next = setAssignment(next, 'chatgpt-2', SHARED);

    const summary = assignmentSummary(next);
    expect(summary.placed).toBe(2);
    expect(summary.shared).toBe(1);
    expect(summary.multiTopic).toBe(1);
    expect(summary.perTopic.get(a)).toBe(1);
    expect(summary.perTopic.get(b)).toBe(2);
    expect(summary.unassigned).toBe(next.turns.length - 3);

    // Numbers and topic ids only — nothing a person wrote.
    const serialised = JSON.stringify({
      ...summary,
      perTopic: [...summary.perTopic],
    });
    for (const turn of next.turns) {
      expect(serialised).not.toContain(turn.workingText.slice(0, 20));
    }
  });

  it('shows the number that was near 1 during the live failure', () => {
    const { state, a } = threeTopics();
    let spread = state;
    // Healthy: each topic holds a slice.
    spread = setAssignment(spread, 'chatgpt-0', a);
    expect(assignmentSummary(spread).largestTopicShare).toBeLessThan(0.5);

    // The failure: almost everything Shared, so every file is almost the lot.
    let overshared = state;
    for (const turn of state.turns) {
      overshared = setAssignment(overshared, turn.id, SHARED);
    }
    expect(assignmentSummary(overshared).largestTopicShare).toBe(1);
  });

  it('ignores excluded turns entirely', () => {
    const { state, a } = threeTopics();
    let next = setAssignment(state, 'chatgpt-0', a);
    next = setIncluded(next, 'chatgpt-0', false);

    const summary = assignmentSummary(next);
    expect(summary.placed).toBe(0);
    expect(summary.perTopic.get(a)).toBe(0);
  });
});
