import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { SHARED, UNASSIGNED } from '../src/model/types';
import {
  createWorkingState,
  resetTopicIds,
  setAssignment,
  setIncluded,
  type WorkingState,
} from '../src/operations/working';
import { generateSplit, renderMarkdown } from '../src/operations/transcript';
import { applyProposal } from '../src/ai/apply';
import { buildAnalysisInput } from '../src/ai/prompt';
import { MockAnalyzer } from '../src/ai/providers/mock';
import {
  parseModelJson,
  validateTopicProposal,
} from '../src/ai/schema';
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

const VALID_REPLY = JSON.stringify({
  topics: [
    { id: 't1', name: 'Browser extension design', description: 'How to build it.' },
    { id: 't2', name: 'GitHub promotion', description: 'Getting it noticed.' },
    { id: 't3', name: 'Travel', description: 'Weather in Lisbon.' },
  ],
  assignments: [
    { turn: 0, topic: 'shared', uncertain: false },
    { turn: 1, topic: 'shared', uncertain: false },
    { turn: 2, topic: 't1', uncertain: false },
    { turn: 3, topic: 't1', uncertain: false },
    { turn: 4, topic: 't2', uncertain: false },
    { turn: 5, topic: 't2', uncertain: true },
    { turn: 6, topic: 't3', uncertain: false },
    { turn: 7, topic: 't3', uncertain: false },
  ],
});

const ALL_TURNS = [0, 1, 2, 3, 4, 5, 6, 7];

describe('validating model output', () => {
  it('accepts a well-formed proposal', () => {
    const result = validateTopicProposal(JSON.parse(VALID_REPLY), ALL_TURNS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.topics).toHaveLength(3);
    expect(result.proposal.assignments).toHaveLength(8);
    expect(result.proposal.unplaced).toEqual([]);
  });

  it('represents uncertainty', () => {
    const result = validateTopicProposal(JSON.parse(VALID_REPLY), ALL_TURNS);
    if (!result.ok) throw new Error('expected ok');

    const unsure = result.proposal.assignments.filter((a) => a.uncertain);
    expect(unsure.map((a) => a.turn)).toEqual([5]);
  });

  it('rejects output that is not an object', () => {
    for (const bad of [null, 'a string', 42, ['a'], true]) {
      const r = validateTopicProposal(bad, ALL_TURNS);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects a proposal with no topics list', () => {
    const r = validateTopicProposal({ assignments: [] }, ALL_TURNS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toMatch(/topics/i);
  });

  it('rejects a proposal with no assignments list', () => {
    const r = validateTopicProposal({ topics: [{ id: 'a', name: 'A' }] }, ALL_TURNS);
    expect(r.ok).toBe(false);
  });

  it('rejects topics missing an id or a name', () => {
    expect(
      validateTopicProposal(
        { topics: [{ name: 'No id' }], assignments: [{ turn: 0, topic: 'x' }] },
        ALL_TURNS,
      ).ok,
    ).toBe(false);

    expect(
      validateTopicProposal(
        { topics: [{ id: 't1' }], assignments: [{ turn: 0, topic: 't1' }] },
        ALL_TURNS,
      ).ok,
    ).toBe(false);
  });

  it('rejects duplicate topic ids and the reserved "shared" id', () => {
    expect(
      validateTopicProposal(
        {
          topics: [
            { id: 't1', name: 'A' },
            { id: 't1', name: 'B' },
          ],
          assignments: [{ turn: 0, topic: 't1' }],
        },
        ALL_TURNS,
      ).ok,
    ).toBe(false);

    expect(
      validateTopicProposal(
        {
          topics: [{ id: 'shared', name: 'Nope' }],
          assignments: [{ turn: 0, topic: 'shared' }],
        },
        ALL_TURNS,
      ).ok,
    ).toBe(false);
  });

  it('rejects more topics than the limit allows', () => {
    const topics = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      name: `Topic ${i}`,
    }));
    const r = validateTopicProposal(
      { topics, assignments: [{ turn: 0, topic: 't0' }] },
      ALL_TURNS,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a proposal that places nothing', () => {
    const r = validateTopicProposal(
      { topics: [{ id: 't1', name: 'A' }], assignments: [] },
      ALL_TURNS,
    );
    expect(r.ok).toBe(false);
  });

  it('ignores an invented turn number and says so', () => {
    const r = validateTopicProposal(
      {
        topics: [{ id: 't1', name: 'A' }],
        assignments: [
          { turn: 0, topic: 't1' },
          { turn: 999, topic: 't1' },
        ],
      },
      ALL_TURNS,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.assignments.map((a) => a.turn)).toEqual([0]);
    expect(r.proposal.notes.join(' ')).toMatch(/does not exist/i);
  });

  it('ignores an assignment to a topic that was not proposed', () => {
    const r = validateTopicProposal(
      {
        topics: [{ id: 't1', name: 'A' }],
        assignments: [
          { turn: 0, topic: 't1' },
          { turn: 1, topic: 'made-up' },
        ],
      },
      ALL_TURNS,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.assignments).toHaveLength(1);
    expect(r.proposal.notes.join(' ')).toMatch(/was not proposed/i);
  });

  it('reports turns the model left out', () => {
    const r = validateTopicProposal(
      {
        topics: [{ id: 't1', name: 'A' }],
        assignments: [{ turn: 0, topic: 't1' }],
      },
      ALL_TURNS,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.unplaced).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.proposal.notes.join(' ')).toMatch(/left unassigned/i);
  });

  it('strips control characters from a topic name', () => {
    const r = validateTopicProposal(
      {
        topics: [{ id: 't1', name: 'Bad'+String.fromCharCode(0)+'name'+String.fromCharCode(27)+'here' }],
        assignments: [{ turn: 0, topic: 't1' }],
      },
      ALL_TURNS,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.topics[0]?.name).toBe('Bad name here');
    // eslint-disable-next-line no-control-regex
    expect(r.proposal.topics[0]?.name).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe('parsing a model reply', () => {
  it('reads bare JSON', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON inside a fenced code block', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('reads JSON with a sentence in front of it', () => {
    expect(parseModelJson('Here you go:\n{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for text with no JSON in it', () => {
    expect(parseModelJson('I cannot help with that.')).toBeNull();
    expect(parseModelJson('{ not json at all')).toBeNull();
  });
});

describe('applying a proposal', () => {
  beforeEach(() => resetTopicIds());

  it('fills in the same controls manual splitting uses', async () => {
    const state = load();
    const analyzer = new MockAnalyzer(VALID_REPLY);
    const result = await analyzer.analyze(buildAnalysisInput(state));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = applyProposal(state, result.proposal);

    expect(next.topics).toHaveLength(3);
    expect(next.topics[0]?.name).toBe('Browser extension design');
    expect(next.topics.every((t) => t.fromProposal)).toBe(true);
    expect(next.turns[0]?.assignment).toBe(SHARED);
    expect(next.turns[2]?.assignment).toBe(next.topics[0]?.id);
    expect(next.turns[6]?.assignment).toBe(next.topics[2]?.id);
  });

  it('marks uncertain turns and leaves the rest unmarked', async () => {
    const state = load();
    const result = await new MockAnalyzer(VALID_REPLY).analyze(
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error('expected ok');

    const next = applyProposal(state, result.proposal);
    expect(next.turns[5]?.uncertain).toBe(true);
    expect(next.turns[4]?.uncertain).toBe(false);
    expect(next.turns.every((t) => !t.assignmentOverridden)).toBe(true);
  });

  it('produces split conversations that match the proposal', async () => {
    const state = load();
    const result = await new MockAnalyzer(VALID_REPLY).analyze(
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error('expected ok');

    const out = generateSplit(applyProposal(state, result.proposal));
    expect(out).toHaveLength(3);
    expect(renderMarkdown(out[0]!)).toContain('store its working copy');
    expect(renderMarkdown(out[2]!)).toContain('Lisbon');
  });

  it('lets a manual change override the proposal', async () => {
    const state = load();
    const result = await new MockAnalyzer(VALID_REPLY).analyze(
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error('expected ok');

    const applied = applyProposal(state, result.proposal);
    const travelTopic = applied.topics[2]!.id;

    // The model put turn 4 in "GitHub promotion"; the user moves it.
    const corrected = setAssignment(applied, 'chatgpt-4', travelTopic);

    expect(corrected.turns[4]?.assignment).toBe(travelTopic);
    expect(corrected.turns[4]?.assignmentOverridden).toBe(true);

    const out = generateSplit(corrected);
    expect(renderMarkdown(out[2]!)).toContain('GitHub project noticed');
    expect(renderMarkdown(out[1]!)).not.toContain('GitHub project noticed');
  });

  it('clears the uncertain flag when the user makes the call', async () => {
    const state = load();
    const result = await new MockAnalyzer(VALID_REPLY).analyze(
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error('expected ok');

    const applied = applyProposal(state, result.proposal);
    expect(applied.turns[5]?.uncertain).toBe(true);

    const corrected = setAssignment(applied, 'chatgpt-5', SHARED);
    expect(corrected.turns[5]?.uncertain).toBe(false);
    expect(corrected.turns[5]?.assignmentOverridden).toBe(true);
  });

  it('reports invalid model output instead of changing anything', async () => {
    const state = load();
    const analyzer = new MockAnalyzer('I would rather not do that.');
    const result = await analyzer.analyze(buildAnalysisInput(state));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    // Nothing was applied.
    expect(state.topics).toHaveLength(0);
    expect(state.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });

  it('does not touch the source conversation', async () => {
    const state = load();
    const result = await new MockAnalyzer(VALID_REPLY).analyze(
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error('expected ok');

    const next = applyProposal(state, result.proposal);
    expect(next.source).toBe(state.source);
    expect(next.source.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });
});

describe('what gets sent to a model', () => {
  it('sends only turn numbers, roles and text', () => {
    const input = buildAnalysisInput(load());
    const keys = Object.keys(input.turns[0]!).sort();

    expect(keys).toEqual(['number', 'role', 'text', 'truncated']);
    expect(Object.keys(input).sort()).toEqual(['title', 'turns']);
  });

  it('does not send excluded turns', () => {
    const state = setIncluded(load(), 'chatgpt-6', false);
    const input = buildAnalysisInput(state);

    expect(input.turns.map((t) => t.number)).not.toContain(6);
    expect(input.turns.map((t) => t.text).join(' ')).not.toContain('Lisbon');
  });

  it('sends the edited text, never the original', () => {
    const state = load();
    const edited = {
      ...state,
      turns: state.turns.map((t) =>
        t.id === 'chatgpt-6'
          ? { ...t, workingText: 'Redacted question.', edited: true }
          : t,
      ),
    };

    const input = buildAnalysisInput(edited);
    const all = input.turns.map((t) => t.text).join(' ');
    expect(all).toContain('Redacted question.');
    expect(all).not.toContain('Lisbon warm in March');
  });

  it('shortens very long turns and marks them as shortened', () => {
    const state = load();
    const long = 'x'.repeat(5000);
    const withLong = {
      ...state,
      turns: state.turns.map((t) =>
        t.id === 'chatgpt-0' ? { ...t, workingText: long } : t,
      ),
    };

    const input = buildAnalysisInput(withLong, { maxCharsPerTurn: 100 });
    expect(input.turns[0]?.text.length).toBeLessThanOrEqual(101);
    expect(input.turns[0]?.truncated).toBe(true);
    expect(input.turns[1]?.truncated).toBe(false);
  });

  it('sends nothing at all unless analyze is called', () => {
    const analyzer = new MockAnalyzer(VALID_REPLY);
    buildAnalysisInput(load());
    expect(analyzer.calls).toHaveLength(0);
  });
});
