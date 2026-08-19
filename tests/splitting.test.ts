import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { SHARED, UNASSIGNED } from '../src/model/types';
import {
  addTopic,
  clearTopics,
  createWorkingState,
  removeTopic,
  renameTopic,
  resetTopicIds,
  setAssignment,
  setIncluded,
  type WorkingState,
} from '../src/operations/working';
import {
  generateSplit,
  renderMarkdown,
  unassignedIncludedTurns,
} from '../src/operations/transcript';
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

/**
 * The fixture is: [0] general instruction, [1] ack, [2..3] extension,
 * [4..5] promotion, [6..7] travel.
 */
function splitIntoThree(state: WorkingState): WorkingState {
  let s = addTopic(state, 'Browser Extension Design');
  s = addTopic(s, 'GitHub Promotion');
  s = addTopic(s, 'Unrelated Travel Discussion');
  const [extension, promotion, travel] = s.topics;

  s = setAssignment(s, 'chatgpt-0', SHARED);
  s = setAssignment(s, 'chatgpt-1', SHARED);
  s = setAssignment(s, 'chatgpt-2', extension!.id);
  s = setAssignment(s, 'chatgpt-3', extension!.id);
  s = setAssignment(s, 'chatgpt-4', promotion!.id);
  s = setAssignment(s, 'chatgpt-5', promotion!.id);
  s = setAssignment(s, 'chatgpt-6', travel!.id);
  s = setAssignment(s, 'chatgpt-7', travel!.id);
  return s;
}

describe('manual topic splitting', () => {
  beforeEach(() => resetTopicIds());

  it('creates and renames topics', () => {
    let s = addTopic(load());
    expect(s.topics[0]?.name).toBe('Topic 1');

    s = addTopic(s);
    expect(s.topics[1]?.name).toBe('Topic 2');

    s = renameTopic(s, s.topics[0]!.id, 'Browser Extension Design');
    expect(s.topics[0]?.name).toBe('Browser Extension Design');
  });

  it('supports more than three topics', () => {
    let s = load();
    for (let i = 0; i < 7; i++) s = addTopic(s);
    expect(s.topics).toHaveLength(7);
  });

  it('keeps assignments and generates one conversation per topic', () => {
    const s = splitIntoThree(load());
    const out = generateSplit(s);

    expect(out).toHaveLength(3);
    expect(out[0]?.title).toBe('Conversation 1: Browser Extension Design');
    expect(out[1]?.title).toBe('Conversation 2: GitHub Promotion');
    expect(out[2]?.title).toBe('Conversation 3: Unrelated Travel Discussion');
  });

  it('puts each topic turn in only its own conversation', () => {
    const out = generateSplit(splitIntoThree(load()));

    const extension = renderMarkdown(out[0]!);
    expect(extension).toContain('store its working copy');
    expect(extension).not.toContain('GitHub project noticed');
    expect(extension).not.toContain('Lisbon');

    const travel = renderMarkdown(out[2]!);
    expect(travel).toContain('Lisbon');
    expect(travel).not.toContain('store its working copy');
  });

  it('includes a shared turn, in full, in every topic conversation', () => {
    const out = generateSplit(splitIntoThree(load()));

    for (const conversation of out) {
      const text = renderMarkdown(conversation);
      expect(text).toContain('Answer carefully and keep replies short.');
      expect(text).toContain('Understood.');
    }
  });

  it('preserves chronological order within each topic', () => {
    const out = generateSplit(splitIntoThree(load()));

    for (const conversation of out) {
      const sequences = conversation.turns.map((t) => t.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      // The shared opening comes first even though it was added separately.
      expect(sequences[0]).toBe(0);
    }
  });

  it('leaves an unassigned turn out of every topic conversation', () => {
    let s = splitIntoThree(load());
    s = setAssignment(s, 'chatgpt-6', UNASSIGNED);

    for (const conversation of generateSplit(s)) {
      expect(renderMarkdown(conversation)).not.toContain('Lisbon warm in March');
    }
    expect(unassignedIncludedTurns(s).map((t) => t.id)).toEqual(['chatgpt-6']);
  });

  it('leaves an excluded turn out of every topic conversation', () => {
    let s = splitIntoThree(load());
    s = setIncluded(s, 'chatgpt-0', false); // a shared turn

    for (const conversation of generateSplit(s)) {
      expect(renderMarkdown(conversation)).not.toContain(
        'Answer carefully and keep replies short.',
      );
    }
  });

  it('keeps a topic with no turns of its own visible rather than dropping it', () => {
    const s = addTopic(splitIntoThree(load()), 'Nothing here yet');
    const out = generateSplit(s);

    expect(out).toHaveLength(4);
    expect(out[3]?.title).toBe('Conversation 4: Nothing here yet');
    // It receives the shared turns and nothing else, which is the documented
    // meaning of Shared.
    expect(out[3]?.turns.map((t) => t.id)).toEqual(['chatgpt-0', 'chatgpt-1']);
  });

  it('generates an entirely empty topic when nothing is shared', () => {
    let s = splitIntoThree(load());
    s = setAssignment(s, 'chatgpt-0', UNASSIGNED);
    s = setAssignment(s, 'chatgpt-1', UNASSIGNED);
    s = addTopic(s, 'Nothing here yet');

    const out = generateSplit(s);
    expect(out[3]?.turns).toHaveLength(0);
  });

  it('returns turns to Unassigned when their topic is removed', () => {
    const s = splitIntoThree(load());
    const removedId = s.topics[0]!.id;
    const after = removeTopic(s, removedId);

    expect(after.topics).toHaveLength(2);
    expect(after.turns[2]?.assignment).toBe(UNASSIGNED);
    // Other topics are untouched.
    expect(after.turns[4]?.assignment).toBe(s.topics[1]!.id);
  });

  it('clears every topic and assignment', () => {
    const s = clearTopics(splitIntoThree(load()));

    expect(s.topics).toHaveLength(0);
    expect(s.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
    expect(generateSplit(s)).toHaveLength(0);
  });

  it('does not touch the source conversation', () => {
    const state = load();
    const s = splitIntoThree(state);

    expect(s.source).toBe(state.source);
    expect(s.source.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });
});
