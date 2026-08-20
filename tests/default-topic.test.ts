/**
 * The built-in "Why is AI so stupid?" topic.
 *
 * A note on what the classification tests can and cannot show. Whether a
 * particular turn *is* venting is a judgement the model makes, and no test
 * here can make a model behave. What these tests establish is the part Chat
 * Threads is responsible for:
 *
 *  - the model is actually told the rules, including the two negative ones
 *    that stop the topic swallowing every bug report;
 *  - when a model applies those rules, the result lands where it should — the
 *    whole exchange together, the criticism and the ordinary discussion left
 *    alone — and comes out correctly in the generated transcripts.
 *
 * The fixture is built so that a rule violation would be visible: turn 2 is
 * blunt criticism and turn 9 is ordinary discussion about AI, and both must
 * stay out of the built-in topic.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { SHARED, UNASSIGNED } from '../src/model/types';
import {
  BUILT_IN_TOPIC_DESCRIPTION,
  BUILT_IN_TOPIC_ID,
  BUILT_IN_TOPIC_MODEL_ID,
  BUILT_IN_TOPIC_NAME,
  createDefaultTopic,
  isPristineDefaultTopic,
} from '../src/model/default-topic';
import {
  addTopic,
  clearTopics,
  createWorkingState,
  hasChanges,
  removeTopic,
  renameTopic,
  resetAll,
  resetTopicIds,
  setAssignment,
  setIncluded,
  setWorkingText,
  type WorkingState,
} from '../src/operations/working';
import {
  generateCleaned,
  generateSplit,
  renderMarkdown,
} from '../src/operations/transcript';
import { applyProposal } from '../src/ai/apply';
import { buildAnalysisInput, buildUserPrompt } from '../src/ai/prompt';
import { MockAnalyzer } from '../src/ai/providers/mock';
import {
  chatgptVenting,
  VENTING_PROPOSAL,
  VENTING_PROPOSAL_ECHOING_BUILT_IN,
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

/** Run the fixture through the analyzer and apply what comes back. */
async function analyzed(
  state: WorkingState,
  reply = VENTING_PROPOSAL,
): Promise<WorkingState> {
  const result = await new MockAnalyzer(reply).analyze(
    buildAnalysisInput(state),
  );
  if (!result.ok) throw new Error(`unexpected rejection: ${result.errors}`);
  return applyProposal(state, result.proposal);
}

/** The transcript of the built-in topic, whatever position it ended up in. */
function builtInTranscript(state: WorkingState): string {
  const conversation = generateSplit(state).find(
    (c) => c.topicId === BUILT_IN_TOPIC_ID,
  );
  return conversation ? renderMarkdown(conversation) : '';
}

beforeEach(() => resetTopicIds());

describe('the topic is there to begin with', () => {
  it('appears automatically when a conversation is loaded', () => {
    const state = load();

    expect(state.topics).toHaveLength(1);
    expect(state.topics[0]).toMatchObject({
      id: BUILT_IN_TOPIC_ID,
      name: 'Why is AI so stupid?',
      description: 'Cursing, arguing, or venting at the AI.',
      builtIn: true,
    });
  });

  it('starts empty, with no turn assigned to it', () => {
    const state = load();
    expect(state.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });

  it('is not itself counted as an unsaved change', () => {
    // Otherwise Reset Changes would look enabled on every fresh conversation.
    expect(hasChanges(load())).toBe(false);
  });

  it('is a fresh object each time, so renaming one does not affect another', () => {
    const first = load();
    const renamed = renameTopic(first, BUILT_IN_TOPIC_ID, 'Mine');

    expect(renamed.topics[0]?.name).toBe('Mine');
    expect(load().topics[0]?.name).toBe(BUILT_IN_TOPIC_NAME);
    expect(createDefaultTopic()).not.toBe(createDefaultTopic());
  });
});

describe('it is a default, not a requirement', () => {
  it('can be renamed, and stays the built-in topic', () => {
    const state = renameTopic(load(), BUILT_IN_TOPIC_ID, 'Arguments with the bot');

    expect(state.topics[0]?.name).toBe('Arguments with the bot');
    expect(state.topics[0]?.builtIn).toBe(true);
    expect(state.topics[0]?.id).toBe(BUILT_IN_TOPIC_ID);
    expect(hasChanges(state)).toBe(true);
  });

  it('can be removed', () => {
    const state = removeTopic(load(), BUILT_IN_TOPIC_ID);

    expect(state.topics).toHaveLength(0);
    expect(hasChanges(state)).toBe(true);
    expect(generateSplit(state)).toHaveLength(0);
  });

  it('returns its turns to Unassigned when removed, like any topic', () => {
    let state = setAssignment(load(), 'chatgpt-4', BUILT_IN_TOPIC_ID);
    state = removeTopic(state, BUILT_IN_TOPIC_ID);

    expect(state.turns[4]?.assignment).toBe(UNASSIGNED);
  });

  it('can be left unused without affecting anything else', () => {
    let state = addTopic(load(), 'The actual work');
    const work = state.topics[1]!;
    state = setAssignment(state, 'chatgpt-0', work.id);

    const out = generateSplit(state);
    const builtIn = out.find((c) => c.topicId === BUILT_IN_TOPIC_ID);

    expect(builtIn?.turns).toHaveLength(0);
    expect(renderMarkdown(out.find((c) => c.topicId === work.id)!)).toContain(
      'refactor this function',
    );
    // The cleaned conversation is untouched by an unused topic.
    expect(generateCleaned(state).turns).toHaveLength(VENTING_TURNS.length);
  });

  it('is cleared by Clear all, along with every other topic', () => {
    expect(clearTopics(load()).topics).toHaveLength(0);
  });
});

describe('Reset Changes restores the default state', () => {
  it('brings the topic back after it was removed', () => {
    const state = removeTopic(load(), BUILT_IN_TOPIC_ID);
    const reset = resetAll(state);

    expect(reset.topics).toHaveLength(1);
    expect(reset.topics[0]?.id).toBe(BUILT_IN_TOPIC_ID);
    expect(reset.topics[0]?.name).toBe(BUILT_IN_TOPIC_NAME);
    expect(hasChanges(reset)).toBe(false);
  });

  it('undoes a rename', () => {
    const renamed = renameTopic(load(), BUILT_IN_TOPIC_ID, 'Something else');
    expect(resetAll(renamed).topics[0]?.name).toBe(BUILT_IN_TOPIC_NAME);
  });

  it('undoes an applied proposal, leaving only the default topic', async () => {
    const state = await analyzed(load());
    expect(state.topics.length).toBeGreaterThan(1);

    const reset = resetAll(state);
    expect(reset.topics).toHaveLength(1);
    expect(isPristineDefaultTopic(reset.topics[0]!)).toBe(true);
    expect(reset.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });

  it('undoes exclusions and edits alongside it', () => {
    let state = setIncluded(load(), 'chatgpt-4', false);
    state = setWorkingText(state, 'chatgpt-0', 'edited');
    state = renameTopic(state, BUILT_IN_TOPIC_ID, 'renamed');

    const reset = resetAll(state);
    expect(reset.turns[4]?.included).toBe(true);
    expect(reset.turns[0]?.edited).toBe(false);
    expect(reset.topics[0]?.name).toBe(BUILT_IN_TOPIC_NAME);
  });
});

describe('the model is told what belongs in it', () => {
  const prompt = () => buildUserPrompt(buildAnalysisInput(load()));

  it('describes the topic and its reserved id', () => {
    const text = prompt();

    expect(text).toContain(`id "${BUILT_IN_TOPIC_MODEL_ID}"`);
    expect(text).toContain(BUILT_IN_TOPIC_NAME);
    expect(text).toContain(BUILT_IN_TOPIC_DESCRIPTION);
    expect(text).toContain('already exist');
  });

  it('asks for cursing, arguing and venting', () => {
    const text = prompt().toLowerCase();

    expect(text).toContain('swearing at the assistant');
    expect(text).toContain('arguing with it about its own behaviour');
    expect(text).toContain('venting frustration at it');
  });

  it('asks for the assistant side of the exchange too', () => {
    expect(prompt()).toContain('assign that turn');
    expect(prompt().toLowerCase()).toContain(
      'so the whole exchange can be removed together',
    );
  });

  it('rules out ordinary discussion about AI', () => {
    expect(prompt().toLowerCase()).toContain(
      'do not use it for ordinary discussion about ai',
    );
  });

  it('rules out criticism, corrections and disagreement', () => {
    const text = prompt().toLowerCase();

    expect(text).toContain('normal technical criticism');
    expect(text).toContain('correcting an answer');
    expect(text).toContain('even when the person says the assistant is wrong');
    expect(text).toContain('move the work forward');
  });

  it('tells the model an empty result is acceptable', () => {
    expect(prompt().toLowerCase()).toContain('assign nothing to it');
  });

  it('stops describing the topic once the user removes it', () => {
    const state = removeTopic(load(), BUILT_IN_TOPIC_ID);
    const input = buildAnalysisInput(state);

    expect(input.existingTopics).toHaveLength(0);
    expect(buildUserPrompt(input)).not.toContain(BUILT_IN_TOPIC_NAME);
  });

  it('passes the name the user chose, not the original', () => {
    const state = renameTopic(load(), BUILT_IN_TOPIC_ID, 'Bot arguments');
    const input = buildAnalysisInput(state);

    expect(input.existingTopics[0]?.name).toBe('Bot arguments');
    expect(buildUserPrompt(input)).toContain('Bot arguments');
  });
});

describe('classifying an argument, when the model follows the rules', () => {
  it('puts cursing at the AI into the built-in topic', async () => {
    const state = await analyzed(load());

    expect(state.turns[4]?.assignment).toBe(BUILT_IN_TOPIC_ID);
    expect(builtInTranscript(state)).toContain('Why is this so hard for you?');
  });

  it('puts arguing with the AI into the built-in topic', async () => {
    const state = await analyzed(load());

    expect(state.turns[6]?.assignment).toBe(BUILT_IN_TOPIC_ID);
    expect(builtInTranscript(state)).toContain('you clearly did not');
  });

  it('puts venting at the AI into the built-in topic', async () => {
    const state = await analyzed(load());

    expect(state.turns[8]?.assignment).toBe(BUILT_IN_TOPIC_ID);
    expect(builtInTranscript(state)).toContain('waste of my time');
  });

  it('brings the assistant side of the exchange with it', async () => {
    const state = await analyzed(load());

    // Turn 5 answers the swearing; turn 7 answers the accusation. Leaving
    // either behind would strand half an exchange in the work transcript.
    expect(state.turns[5]?.assignment).toBe(BUILT_IN_TOPIC_ID);
    expect(state.turns[7]?.assignment).toBe(BUILT_IN_TOPIC_ID);

    const transcript = builtInTranscript(state);
    expect(transcript).toContain('I am sorry for the frustration');
    expect(transcript).toContain('I did not run the code');
  });

  it('keeps the whole exchange contiguous and in order', async () => {
    const state = await analyzed(load());
    const conversation = generateSplit(state).find(
      (c) => c.topicId === BUILT_IN_TOPIC_ID,
    );

    expect(conversation?.turns.map((t) => t.sequence)).toEqual([4, 5, 6, 7, 8]);
  });

  it('does not take ordinary technical criticism', async () => {
    const state = await analyzed(load());

    // "This is wrong. It still throws" is part of the work.
    expect(state.turns[2]?.assignment).not.toBe(BUILT_IN_TOPIC_ID);
    expect(builtInTranscript(state)).not.toContain('It still throws');
  });

  it('does not take a correction of an error', async () => {
    const state = await analyzed(load());

    expect(state.turns[3]?.assignment).not.toBe(BUILT_IN_TOPIC_ID);
    expect(builtInTranscript(state)).not.toContain('corrected version');
  });

  it('does not take ordinary discussion about AI', async () => {
    const state = await analyzed(load());

    expect(state.turns[9]?.assignment).not.toBe(BUILT_IN_TOPIC_ID);
    expect(state.turns[10]?.assignment).not.toBe(BUILT_IN_TOPIC_ID);

    const transcript = builtInTranscript(state);
    expect(transcript).not.toContain('long context windows');
    expect(transcript).not.toContain('sparse attention');
  });

  it('leaves the work transcript complete and readable', async () => {
    const state = await analyzed(load());
    const work = generateSplit(state).find((c) =>
      c.topicName?.includes('Refactoring'),
    );
    const text = renderMarkdown(work!);

    expect(text).toContain('refactor this function');
    expect(text).toContain('It still throws');
    expect(text).toContain('corrected version');
    expect(text).not.toContain('Why is this so hard for you?');
    expect(text).not.toContain('waste of my time');
  });

  it('changes nothing about the cleaned conversation', async () => {
    const state = await analyzed(load());
    const cleaned = renderMarkdown(generateCleaned(state));

    // Splitting is not deleting: everything is still in the full transcript.
    for (const turn of VENTING_TURNS) {
      expect(cleaned).toContain(turn.slice(0, 30));
    }
  });
});

describe('Find Topics preserves the built-in topic', () => {
  it('keeps it rather than replacing it with an equivalent', async () => {
    const state = await analyzed(load());
    const builtIn = state.topics.filter((t) => t.builtIn);

    expect(builtIn).toHaveLength(1);
    expect(builtIn[0]?.id).toBe(BUILT_IN_TOPIC_ID);
    expect(builtIn[0]?.name).toBe(BUILT_IN_TOPIC_NAME);
    // And it did not arrive as a proposed topic.
    expect(builtIn[0]?.fromProposal).toBeUndefined();
  });

  it('adds the proposed topics alongside it', async () => {
    const state = await analyzed(load());
    const proposed = state.topics.filter((t) => t.fromProposal);

    expect(state.topics).toHaveLength(3);
    expect(proposed.map((t) => t.name)).toEqual([
      'Refactoring the function',
      'How models handle long context',
    ]);
  });

  it('keeps the name the user gave it', async () => {
    const renamed = renameTopic(load(), BUILT_IN_TOPIC_ID, 'Bot arguments');
    const state = await analyzed(renamed);

    const builtIn = state.topics.find((t) => t.builtIn);
    expect(builtIn?.name).toBe('Bot arguments');
    expect(state.turns[4]?.assignment).toBe(BUILT_IN_TOPIC_ID);
  });

  it('does not create a duplicate when the model echoes it back', async () => {
    const state = await analyzed(load(), VENTING_PROPOSAL_ECHOING_BUILT_IN);

    expect(state.topics.filter((t) => t.builtIn)).toHaveLength(1);
    expect(
      state.topics.filter((t) => t.name === 'Frustration with the assistant'),
    ).toHaveLength(0);
    // The assignments it made still landed on the real topic.
    expect(state.turns[4]?.assignment).toBe(BUILT_IN_TOPIC_ID);
    expect(state.turns[8]?.assignment).toBe(BUILT_IN_TOPIC_ID);
  });

  it('says so in the notes when it had to drop a duplicate', async () => {
    const result = await new MockAnalyzer(
      VENTING_PROPOSAL_ECHOING_BUILT_IN,
    ).analyze(buildAnalysisInput(load()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.notes.join(' ')).toMatch(/already existed/i);
  });

  it('does not resurrect the topic the user removed', async () => {
    const without = removeTopic(load(), BUILT_IN_TOPIC_ID);
    const result = await new MockAnalyzer(VENTING_PROPOSAL).analyze(
      buildAnalysisInput(without),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The reserved id is no longer offered, so those assignments are dropped
    // and reported rather than quietly recreating the topic.
    const state = applyProposal(without, result.proposal);
    expect(state.topics.some((t) => t.builtIn)).toBe(false);
    expect(state.turns[4]?.assignment).toBe(UNASSIGNED);
    expect(result.proposal.notes.join(' ')).toMatch(/was not proposed/i);
  });

  it('accepts a proposal in which everything is venting', async () => {
    const allVenting = JSON.stringify({
      topics: [],
      assignments: [
        { turn: 4, topic: 'venting', uncertain: false },
        { turn: 8, topic: 'venting', uncertain: false },
      ],
    });
    const state = await analyzed(load(), allVenting);

    expect(state.topics).toHaveLength(1);
    expect(state.turns[4]?.assignment).toBe(BUILT_IN_TOPIC_ID);
  });
});

describe('it behaves like any other topic downstream', () => {
  it('works with manual assignment', () => {
    const state = setAssignment(load(), 'chatgpt-4', BUILT_IN_TOPIC_ID);

    expect(state.turns[4]?.assignmentOverridden).toBe(true);
    expect(builtInTranscript(state)).toContain('Why is this so hard for you?');
  });

  it('lets a manual change override what the model decided', async () => {
    const state = await analyzed(load());
    const work = state.topics.find((t) => t.name === 'Refactoring the function')!;

    // The user decides turn 6 was really about the work after all.
    const corrected = setAssignment(state, 'chatgpt-6', work.id);

    expect(corrected.turns[6]?.assignmentOverridden).toBe(true);
    expect(builtInTranscript(corrected)).not.toContain('you clearly did not');
    expect(
      renderMarkdown(
        generateSplit(corrected).find((c) => c.topicId === work.id)!,
      ),
    ).toContain('you clearly did not');
  });

  it('respects exclusion', async () => {
    let state = await analyzed(load());
    state = setIncluded(state, 'chatgpt-4', false);

    expect(builtInTranscript(state)).not.toContain('Why is this so hard for you?');
    // The rest of the exchange is still there.
    expect(builtInTranscript(state)).toContain('waste of my time');
  });

  it('receives shared turns like any other topic', async () => {
    let state = await analyzed(load());
    state = setAssignment(state, 'chatgpt-0', SHARED);

    expect(builtInTranscript(state)).toContain('refactor this function');
  });

  it('produces a numbered, titled transcript', async () => {
    const state = await analyzed(load());
    const conversation = generateSplit(state).find(
      (c) => c.topicId === BUILT_IN_TOPIC_ID,
    );

    expect(conversation?.title).toBe(`Conversation 1: ${BUILT_IN_TOPIC_NAME}`);
    const text = renderMarkdown(conversation!);
    expect(text).toContain('**User:**');
    expect(text).toContain('**Assistant:**');
  });

  it('never touches the source conversation', async () => {
    const state = load();
    const analysedState = await analyzed(state);

    expect(analysedState.source).toBe(state.source);
    expect(
      analysedState.source.turns.every((t) => t.assignment === UNASSIGNED),
    ).toBe(true);
  });
});
