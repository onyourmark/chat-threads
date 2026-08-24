/**
 * Asking for a topic by name.
 *
 * Reported from real use: "I found the topics, then added one of my own and
 * pressed Find Topics again, hoping it would find that one too. It didn't."
 * And the other way round: "I cleared the topics, added just my topic, and
 * pressed the button — there was no other way to say *find me the turns about
 * this*."
 *
 * Both failed for the same reason. Only the built-in topic was ever described
 * to the model; a topic the user had made was neither sent nor kept, so the
 * request went out as though it did not exist and applying the answer threw it
 * away. These tests hold down the fix from both ends: what is sent, and what
 * survives coming back.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { UNASSIGNED } from '../src/model/types';
import {
  BUILT_IN_TOPIC_MODEL_ID,
  BUILT_IN_TOPIC_NAME,
} from '../src/model/default-topic';
import {
  addTopic,
  clearTopics,
  createWorkingState,
  removeTopic,
  renameTopic,
  resetTopicIds,
  setTopics,
  type WorkingState,
} from '../src/operations/working';
import {
  buildAnalysisInput,
  buildUserPrompt,
  modelIdForTopic,
  reservedTopicIds,
  topicIdFromModelId,
} from '../src/ai/prompt';
import { applyProposal } from '../src/ai/apply';
import { MockAnalyzer } from '../src/ai/providers/mock';
import { runTopicAnalysis } from '../src/ai/run';
import { buildClassifyPrompt, buildDiscoveryPrompt, buildMergePrompt } from '../src/ai/stages';
import { planAnalysis } from '../src/ai/plan';
import { buildLongConversation } from './fixtures/long-conversation';
import { chatgptMixedTopics } from './fixtures/chatgpt';

function load(): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/conv-mixed',
        method: 'test',
      }),
    ),
  );
}

/** A conversation with one topic the user typed in themselves. */
function withMyTopic(name = 'Kubernetes networking'): WorkingState {
  return addTopic(load(), name);
}

beforeEach(() => resetTopicIds());

// -------------------------------------------------------- what is sent -----

describe('a topic the user named is described to the model', () => {
  it('is sent, with an id the model can assign turns to', () => {
    const state = withMyTopic();
    const input = buildAnalysisInput(state);

    const mine = input.existingTopics.find(
      (t) => t.name === 'Kubernetes networking',
    );
    expect(mine).toBeDefined();
    expect(reservedTopicIds(input)).toContain(mine!.id);

    // The id points back at the topic it came from, so nothing has to be
    // reconstructed later.
    const topic = state.topics.find((t) => t.name === 'Kubernetes networking')!;
    expect(topicIdFromModelId(mine!.id)).toBe(topic.id);
  });

  it('keeps the built-in topic on its own reserved word', () => {
    const input = buildAnalysisInput(withMyTopic());
    const builtIn = input.existingTopics.find(
      (t) => t.name === BUILT_IN_TOPIC_NAME,
    );

    expect(builtIn?.id).toBe(BUILT_IN_TOPIC_MODEL_ID);
    expect(topicIdFromModelId(BUILT_IN_TOPIC_MODEL_ID)).toBeNull();
  });

  it('tells the model to find turns for it, and to leave it empty if none fit', () => {
    const prompt = buildUserPrompt(buildAnalysisInput(withMyTopic()));

    expect(prompt).toContain('Kubernetes networking');
    expect(prompt).toMatch(/named by the person/i);
    expect(prompt).toMatch(/Assign every turn that genuinely belongs/i);
    // The important half: an empty answer is allowed.
    expect(prompt).toMatch(/An empty topic is a truthful answer/i);
  });

  it('says nothing about named topics when there are none', () => {
    const prompt = buildUserPrompt(buildAnalysisInput(load()));
    expect(prompt).not.toMatch(/named by the person/i);
  });

  it('does not re-send topics from a previous suggestion', () => {
    // Re-running is how you ask for a different answer; keeping the old one
    // would just accumulate near-duplicates.
    const state = setTopics(load(), [
      { id: 'ai-t1', name: 'From the last run', fromProposal: true },
      { id: 'mine', name: 'Mine' },
    ]);
    const names = buildAnalysisInput(state).existingTopics.map((t) => t.name);

    expect(names).toContain('Mine');
    expect(names).not.toContain('From the last run');
  });
});

describe('a named topic reaches every stage of a sectioned run', () => {
  const state = () => addTopic(buildLongConversation({ turns: 300 }), 'Deployment pipeline');

  it('is kept out of what discovery and merge are asked to invent', () => {
    const input = buildAnalysisInput(state());
    const plan = planAnalysis(input);
    const section = plan.sections[0]!;

    for (const prompt of [
      buildDiscoveryPrompt(input, section, plan.sectionCount),
      buildMergePrompt(input, [{ section: 1, topics: [] }], plan.sectionCount),
    ]) {
      expect(prompt).toContain('Deployment pipeline');
      expect(prompt).toMatch(/do not list them/i);
    }
  });

  it('is offered to the pass that actually places turns', () => {
    const input = buildAnalysisInput(state());
    const plan = planAnalysis(input);
    const mine = input.existingTopics.find(
      (t) => t.name === 'Deployment pipeline',
    )!;

    const prompt = buildClassifyPrompt(input, plan.sections[0]!, plan.sectionCount, [
      { id: 'c1', name: 'Something else' },
    ]);

    expect(prompt).toContain(`id "${mine.id}"`);
    expect(prompt).toMatch(/named by the person/i);
  });
});

// ---------------------------------------------------- what comes back ------

describe('a named topic survives the answer being applied', () => {
  const proposal = (extra: { turn: number; topic: string }[] = []) => ({
    topics: [{ id: 't1', name: 'Something the model found' }],
    assignments: [{ turn: 0, topic: 't1', uncertain: false }, ...extra.map((e) => ({ ...e, uncertain: false }))],
    unplaced: [],
    notes: [],
  });

  it('is still there afterwards, with its own name', () => {
    const state = withMyTopic();
    const mine = state.topics.find((t) => t.name === 'Kubernetes networking')!;

    const next = applyProposal(state, proposal());

    expect(next.topics.map((t) => t.name)).toContain('Kubernetes networking');
    expect(next.topics.find((t) => t.id === mine.id)).toBeDefined();
    // And the model's own topics were added alongside it.
    expect(next.topics.some((t) => t.fromProposal)).toBe(true);
  });

  it('receives the turns the model put in it', () => {
    const state = withMyTopic();
    const mine = state.topics.find((t) => t.name === 'Kubernetes networking')!;

    const next = applyProposal(
      state,
      proposal([{ turn: 2, topic: modelIdForTopic(mine) }]),
    );

    expect(next.turns[2]?.assignment).toBe(mine.id);
  });

  it('drops an assignment to a topic the user removed while it ran', () => {
    const state = withMyTopic();
    const mine = state.topics.find((t) => t.name === 'Kubernetes networking')!;
    const afterRemoval = removeTopic(state, mine.id);

    const next = applyProposal(
      afterRemoval,
      proposal([{ turn: 2, topic: modelIdForTopic(mine) }]),
    );

    // Not resurrected behind the user's back, and the turn stays put.
    expect(next.topics.map((t) => t.id)).not.toContain(mine.id);
    expect(next.turns[2]?.assignment).toBe(UNASSIGNED);
  });

  it('replaces the previous run\'s topics but not the user\'s', () => {
    const state = setTopics(load(), [
      { id: 'ai-old', name: 'Old suggestion', fromProposal: true },
      { id: 'mine', name: 'Mine' },
    ]);

    const next = applyProposal(state, proposal());

    expect(next.topics.map((t) => t.name)).toContain('Mine');
    expect(next.topics.map((t) => t.name)).not.toContain('Old suggestion');
  });

  it('keeps a renamed built-in topic', () => {
    const state = renameTopic(load(), load().topics[0]!.id, 'Bot arguments');
    const next = applyProposal(state, proposal());

    expect(next.topics.find((t) => t.builtIn)?.name).toBe('Bot arguments');
  });
});

// ------------------------------------------------------ the whole flow -----

describe('the two things the user actually tried', () => {
  it('adds a topic to an existing set and finds turns for it', async () => {
    // Their first attempt: topics already suggested, add one more, run again.
    let state = applyProposal(load(), {
      topics: [{ id: 't1', name: 'Browser extension design' }],
      assignments: [{ turn: 0, topic: 't1', uncertain: false }],
      unplaced: [],
      notes: [],
    });
    state = addTopic(state, 'Travel');

    const input = buildAnalysisInput(state);
    const mine = input.existingTopics.find((t) => t.name === 'Travel')!;

    const analyzer = new MockAnalyzer(
      JSON.stringify({
        topics: [{ id: 'n1', name: 'Extension work', description: 'x' }],
        assignments: input.turns.map((t, i) => ({
          turn: t.number,
          topic: i >= 6 ? mine.id : 'n1',
          uncertain: false,
        })),
      }),
    );

    const result = await runTopicAnalysis(analyzer, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = applyProposal(state, result.proposal);
    const travel = next.topics.find((t) => t.name === 'Travel')!;

    expect(travel).toBeDefined();
    expect(next.turns[6]?.assignment).toBe(travel.id);
    expect(next.turns[7]?.assignment).toBe(travel.id);
  });

  it('finds the turns for one topic on its own', async () => {
    // Their second attempt: clear everything, add one topic, run.
    const state = addTopic(clearTopics(load()), 'Lisbon weather');
    const input = buildAnalysisInput(state);
    const mine = input.existingTopics.find((t) => t.name === 'Lisbon weather')!;

    expect(input.existingTopics).toHaveLength(1);

    const analyzer = new MockAnalyzer(
      JSON.stringify({
        topics: [{ id: 'rest', name: 'Everything else', description: 'x' }],
        assignments: input.turns.map((t) => ({
          turn: t.number,
          topic: t.number >= 6 ? mine.id : 'rest',
          uncertain: false,
        })),
      }),
    );

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    const next = applyProposal(state, result.proposal);
    const topic = next.topics.find((t) => t.name === 'Lisbon weather')!;

    expect(next.turns.filter((t) => t.assignment === topic.id)).toHaveLength(2);
  });

  it('leaves the topic empty rather than inventing turns for it', async () => {
    const state = addTopic(clearTopics(load()), 'Nothing to do with this chat');
    const input = buildAnalysisInput(state);

    const analyzer = new MockAnalyzer(
      JSON.stringify({
        topics: [{ id: 'rest', name: 'Everything else', description: 'x' }],
        assignments: input.turns.map((t) => ({
          turn: t.number,
          topic: 'rest',
          uncertain: false,
        })),
      }),
    );

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    const next = applyProposal(state, result.proposal);
    const topic = next.topics.find(
      (t) => t.name === 'Nothing to do with this chat',
    )!;

    // Still listed, so the user can see the answer was "none".
    expect(topic).toBeDefined();
    expect(next.turns.filter((t) => t.assignment === topic.id)).toHaveLength(0);
  });
});
