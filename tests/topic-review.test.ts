/**
 * Topic Review: isolating a topic and removing turns from it.
 *
 * The point of this feature is that it invents nothing. "Removed through a
 * topic" and "excluded in the Clean view" are the same flag, so most of what
 * these tests check is that the two really are indistinguishable afterwards —
 * in Clean, in Output, and under Reset.
 *
 * The mechanism is general: nothing here is specific to the built-in topic,
 * and the suite exercises a manual topic, an AI-proposed topic and the
 * built-in one through the same code.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { SHARED, UNASSIGNED } from '../src/model/types';
import { BUILT_IN_TOPIC_ID } from '../src/model/default-topic';
import {
  addTopic,
  countAssignedTo,
  createWorkingState,
  hasChanges,
  removeTopic,
  resetAll,
  resetTopicIds,
  setAssignment,
  setIncluded,
  setIncludedMany,
  toggleIncluded,
  turnsAssignedTo,
  type WorkingState,
} from '../src/operations/working';
import {
  generateCleaned,
  generateSplit,
  renderMarkdown,
} from '../src/operations/transcript';
import { applyProposal } from '../src/ai/apply';
import { buildAnalysisInput } from '../src/ai/prompt';
import { MockAnalyzer } from '../src/ai/providers/mock';
import {
  chatgptVenting,
  VENTING_PROPOSAL,
  VENTING_TURNS,
} from './fixtures/chatgpt-venting';

function load(): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptVenting, {
        url: 'https://chatgpt.com/c/conv-venting',
        method: 'test',
      }),
    ),
  );
}

/** A manually created topic holding turns 0 and 1. */
function withManualTopic(): { state: WorkingState; topicId: string } {
  let state = addTopic(load(), 'Email discussion');
  const topicId = state.topics[state.topics.length - 1]!.id;
  state = setAssignment(state, 'chatgpt-0', topicId);
  state = setAssignment(state, 'chatgpt-1', topicId);
  return { state, topicId };
}

/** The state after Find Topics has run on the venting fixture. */
async function withProposal(): Promise<WorkingState> {
  const state = load();
  const result = await new MockAnalyzer(VENTING_PROPOSAL).analyze(
    buildAnalysisInput(state),
  );
  if (!result.ok) throw new Error('proposal unexpectedly rejected');
  return applyProposal(state, result.proposal);
}

/**
 * What the review screen commits: every turn it listed, minus the ones the
 * user unticked.
 */
function removeSelected(
  state: WorkingState,
  topicId: string,
  keep: readonly string[] = [],
): WorkingState {
  const selected = turnsAssignedTo(state, topicId)
    .map((t) => t.id)
    .filter((id) => !keep.includes(id));
  return setIncludedMany(state, selected, false);
}

beforeEach(() => resetTopicIds());

describe('a topic shows only its own turns', () => {
  it('lists exactly the turns assigned to it', async () => {
    const state = await withProposal();

    expect(turnsAssignedTo(state, BUILT_IN_TOPIC_ID).map((t) => t.sequence)).toEqual(
      [4, 5, 6, 7, 8],
    );
  });

  it('works the same for a manually created topic', () => {
    const { state, topicId } = withManualTopic();

    expect(turnsAssignedTo(state, topicId).map((t) => t.sequence)).toEqual([
      0, 1,
    ]);
  });

  it('works the same for an AI-proposed topic', async () => {
    const state = await withProposal();
    const proposed = state.topics.find((t) => t.fromProposal)!;

    expect(turnsAssignedTo(state, proposed.id).map((t) => t.sequence)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('does not include turns from other topics', async () => {
    const state = await withProposal();
    const reviewed = turnsAssignedTo(state, BUILT_IN_TOPIC_ID);

    expect(reviewed.every((t) => t.assignment === BUILT_IN_TOPIC_ID)).toBe(true);
    expect(reviewed.map((t) => t.workingText).join(' ')).not.toContain(
      'long context windows',
    );
  });

  it('does not offer Shared turns, which belong to every topic', () => {
    const { state, topicId } = withManualTopic();
    const shared = setAssignment(state, 'chatgpt-9', SHARED);

    // Removing a shared turn while reviewing one topic would silently take it
    // out of all the others, so it is not listed here.
    expect(turnsAssignedTo(shared, topicId).map((t) => t.id)).toEqual([
      'chatgpt-0',
      'chatgpt-1',
    ]);
  });

  it('reports a count for the topic list', async () => {
    const state = await withProposal();

    expect(countAssignedTo(state, BUILT_IN_TOPIC_ID)).toBe(5);
    expect(countAssignedTo(state, 'no-such-topic')).toBe(0);
  });

  it('is empty for a topic nothing was assigned to', () => {
    expect(turnsAssignedTo(load(), BUILT_IN_TOPIC_ID)).toEqual([]);
  });
});

describe('removing the selected turns', () => {
  it('excludes every turn when nothing is unticked', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);

    for (const sequence of [4, 5, 6, 7, 8]) {
      expect(after.turns[sequence]?.included).toBe(false);
    }
  });

  it('leaves an unticked turn included', async () => {
    const state = await withProposal();
    // The user spots that turn 6 had something substantive in it.
    const after = removeSelected(state, BUILT_IN_TOPIC_ID, ['chatgpt-6']);

    expect(after.turns[6]?.included).toBe(true);
    expect(after.turns[4]?.included).toBe(false);
    expect(after.turns[8]?.included).toBe(false);
  });

  it('touches nothing outside the topic', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);

    for (const sequence of [0, 1, 2, 3, 9, 10]) {
      expect(after.turns[sequence]?.included).toBe(true);
    }
  });

  it('does nothing at all when everything is unticked', async () => {
    const state = await withProposal();
    const keep = turnsAssignedTo(state, BUILT_IN_TOPIC_ID).map((t) => t.id);
    const after = removeSelected(state, BUILT_IN_TOPIC_ID, keep);

    expect(after).toBe(state);
    expect(after.turns.every((t) => t.included)).toBe(true);
  });

  it('leaves the topic assignments alone', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);

    // Removal is about inclusion, not about un-assigning. The turns are still
    // in the topic, which is why re-including one puts it straight back.
    expect(countAssignedTo(after, BUILT_IN_TOPIC_ID)).toBe(5);
  });

  it('works for a manual topic with no special handling', () => {
    const { state, topicId } = withManualTopic();
    const after = removeSelected(state, topicId);

    expect(after.turns[0]?.included).toBe(false);
    expect(after.turns[1]?.included).toBe(false);
    expect(after.turns[2]?.included).toBe(true);
  });

  it('works for an AI-proposed topic with no special handling', async () => {
    const state = await withProposal();
    const proposed = state.topics.find((t) => t.fromProposal)!;
    const after = removeSelected(state, proposed.id);

    expect([0, 1, 2, 3].map((i) => after.turns[i]?.included)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(after.turns[4]?.included).toBe(true);
  });

  it('can be pointed at a whole unrelated thread', async () => {
    // The "remove the travel discussion" case, using the AI-discussion topic.
    const state = await withProposal();
    const aiTalk = state.topics.filter((t) => t.fromProposal)[1]!;
    const after = removeSelected(state, aiTalk.id);

    const cleaned = renderMarkdown(generateCleaned(after));
    expect(cleaned).not.toContain('long context windows');
    expect(cleaned).toContain('refactor this function');
  });
});

describe('there is only one notion of removal', () => {
  it('shows up as an ordinary exclusion, exactly like the Clean view', async () => {
    const state = await withProposal();
    const viaReview = removeSelected(state, BUILT_IN_TOPIC_ID, ['chatgpt-6']);

    // Doing the same thing by hand in Clean produces the identical state.
    let viaClean = state;
    for (const id of ['chatgpt-4', 'chatgpt-5', 'chatgpt-7', 'chatgpt-8']) {
      viaClean = setIncluded(viaClean, id, false);
    }

    expect(viaReview.turns.map((t) => t.included)).toEqual(
      viaClean.turns.map((t) => t.included),
    );
  });

  it('can be undone by re-including the turn in Clean', async () => {
    const state = await withProposal();
    const removed = removeSelected(state, BUILT_IN_TOPIC_ID);
    expect(removed.turns[4]?.included).toBe(false);

    const restored = toggleIncluded(removed, 'chatgpt-4');
    expect(restored.turns[4]?.included).toBe(true);
    expect(renderMarkdown(generateCleaned(restored))).toContain(
      'Why is this so hard for you?',
    );
  });

  it('adds no second flag to a turn', async () => {
    const state = await withProposal();
    const before = Object.keys(state.turns[4]!).sort();
    const after = Object.keys(
      removeSelected(state, BUILT_IN_TOPIC_ID).turns[4]!,
    ).sort();

    expect(after).toEqual(before);
    expect(after).toContain('included');
    expect(after.filter((k) => /remove|delete|hidden/i.test(k))).toEqual([]);
  });

  it('counts as an unsaved change', async () => {
    const state = await withProposal();
    expect(hasChanges(removeSelected(state, BUILT_IN_TOPIC_ID))).toBe(true);
  });

  it('never touches the source conversation', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);

    expect(after.source).toBe(state.source);
    expect(after.source.turns.every((t) => t.included)).toBe(true);
    expect(Object.isFrozen(after.source)).toBe(true);
  });
});

describe('the output reflects it immediately', () => {
  it('drops removed turns from the cleaned transcript', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);
    const cleaned = renderMarkdown(generateCleaned(after));

    expect(cleaned).not.toContain('Why is this so hard for you?');
    expect(cleaned).not.toContain('waste of my time');
    expect(cleaned).not.toContain('I am sorry for the frustration');
  });

  it('keeps the turns the user unticked', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID, ['chatgpt-6']);
    const cleaned = renderMarkdown(generateCleaned(after));

    expect(cleaned).toContain('you clearly did not');
    expect(cleaned).not.toContain('waste of my time');
  });

  it('keeps the rest of the conversation intact', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);
    const cleaned = renderMarkdown(generateCleaned(after));

    for (const index of [0, 1, 2, 3, 9, 10]) {
      expect(cleaned).toContain(VENTING_TURNS[index]!.slice(0, 30));
    }
  });

  it('still generates a topic-specific transcript afterwards', async () => {
    // A topic serves two purposes; removing from the cleaned conversation must
    // not cost the ability to extract the topic on its own.
    const state = await withProposal();
    const work = state.topics.find(
      (t) => t.name === 'Refactoring the function',
    )!;
    const after = removeSelected(state, BUILT_IN_TOPIC_ID);

    const split = generateSplit(after);
    expect(split.map((c) => c.topicId)).toContain(work.id);
    expect(renderMarkdown(split.find((c) => c.topicId === work.id)!)).toContain(
      'refactor this function',
    );
  });

  it('leaves the removed topic able to produce its own transcript, minus the removals', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID, ['chatgpt-6']);
    const conversation = generateSplit(after).find(
      (c) => c.topicId === BUILT_IN_TOPIC_ID,
    );

    expect(conversation?.turns.map((t) => t.sequence)).toEqual([6]);
  });

  it('renders the same string every time, so preview and copy agree', async () => {
    const state = await withProposal();
    const after = removeSelected(state, BUILT_IN_TOPIC_ID, ['chatgpt-6']);
    const options = { includeHeader: true };

    const first = renderMarkdown(generateCleaned(after), options);
    const second = renderMarkdown(generateCleaned(after), options);
    expect(second).toBe(first);
  });
});

describe('correcting an assignment from the review screen', () => {
  it('moving a turn out takes it off the list', async () => {
    const state = await withProposal();
    const work = state.topics.find(
      (t) => t.name === 'Refactoring the function',
    )!;

    const moved = setAssignment(state, 'chatgpt-6', work.id);

    expect(turnsAssignedTo(moved, BUILT_IN_TOPIC_ID).map((t) => t.sequence)).toEqual(
      [4, 5, 7, 8],
    );
    // And so it cannot be removed by this review any more.
    expect(removeSelected(moved, BUILT_IN_TOPIC_ID).turns[6]?.included).toBe(
      true,
    );
  });

  it('moving a turn to Unassigned also takes it off the list', async () => {
    const state = await withProposal();
    const moved = setAssignment(state, 'chatgpt-4', UNASSIGNED);

    expect(turnsAssignedTo(moved, BUILT_IN_TOPIC_ID).map((t) => t.sequence)).toEqual(
      [5, 6, 7, 8],
    );
  });

  it('records that the user made the call', async () => {
    const state = await withProposal();
    const moved = setAssignment(state, 'chatgpt-6', UNASSIGNED);

    expect(moved.turns[6]?.assignmentOverridden).toBe(true);
  });
});

describe('Reset Changes undoes it', () => {
  it('brings removed turns back', async () => {
    const state = await withProposal();
    const removed = removeSelected(state, BUILT_IN_TOPIC_ID);
    const reset = resetAll(removed);

    expect(reset.turns.every((t) => t.included)).toBe(true);
    expect(hasChanges(reset)).toBe(false);
  });

  it('restores topic state along with it', async () => {
    const state = await withProposal();
    const reset = resetAll(removeSelected(state, BUILT_IN_TOPIC_ID));

    expect(reset.topics).toHaveLength(1);
    expect(reset.topics[0]?.id).toBe(BUILT_IN_TOPIC_ID);
    expect(reset.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });

  it('restores the cleaned transcript to the whole conversation', async () => {
    const state = await withProposal();
    const reset = resetAll(removeSelected(state, BUILT_IN_TOPIC_ID));
    const cleaned = renderMarkdown(generateCleaned(reset));

    for (const turn of VENTING_TURNS) {
      expect(cleaned).toContain(turn.slice(0, 30));
    }
  });
});

describe('setIncludedMany on its own', () => {
  it('ignores ids that are not in the conversation', () => {
    const state = load();
    expect(setIncludedMany(state, ['nope'], false)).toBe(state);
  });

  it('returns the same object when nothing would change', () => {
    const state = load();
    expect(setIncludedMany(state, [], false)).toBe(state);
    expect(setIncludedMany(state, ['chatgpt-0'], true)).toBe(state);
  });

  it('can put turns back as well as take them out', () => {
    const state = setIncludedMany(load(), ['chatgpt-0', 'chatgpt-1'], false);
    expect(state.turns[0]?.included).toBe(false);

    const back = setIncludedMany(state, ['chatgpt-0', 'chatgpt-1'], true);
    expect(back.turns[0]?.included).toBe(true);
    expect(back.turns[1]?.included).toBe(true);
  });

  it('does not disturb turns it was not given', () => {
    const state = setIncludedMany(load(), ['chatgpt-4'], false);

    expect(state.turns.filter((t) => !t.included).map((t) => t.id)).toEqual([
      'chatgpt-4',
    ]);
  });
});

describe('reviewing a topic that is then removed', () => {
  it('leaves the turns included, since nothing was committed', () => {
    const { state, topicId } = withManualTopic();
    const after = removeTopic(state, topicId);

    expect(after.turns.every((t) => t.included)).toBe(true);
    expect(turnsAssignedTo(after, topicId)).toEqual([]);
  });
});
