/**
 * Find Topics on a conversation too long for one request.
 *
 * Version 1.0.0 sent every retained turn in a single request. On an 866-turn
 * conversation — roughly 688,000 characters — the model had no room for it and
 * the request was rejected, which the panel reported as a bad model name. This
 * file holds down both halves of the fix: that a long conversation is divided
 * before anything is sent, and that dividing it does not lose, duplicate or
 * reorder a single turn.
 *
 * Nothing here touches a network or a key. The mock analyzer is scripted per
 * stage and is handed the real prompt, so a test replies about exactly the
 * turns it was shown — the same constraint a real model works under.
 */

import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { SHARED, UNASSIGNED } from '../src/model/types';
import {
  BUILT_IN_TOPIC_ID,
  BUILT_IN_TOPIC_MODEL_ID,
} from '../src/model/default-topic';
import {
  createWorkingState,
  setIncluded,
  setWorkingText,
  type WorkingState,
} from '../src/operations/working';
import { applyProposal } from '../src/ai/apply';
import { buildAnalysisInput } from '../src/ai/prompt';
import {
  MAX_SECTIONS,
  planAnalysis,
  SAFE_REQUEST_CHARS,
  turnCost,
  type AnalysisSection,
} from '../src/ai/plan';
import { MockAnalyzer, type MockScript } from '../src/ai/providers/mock';
import { runTopicAnalysis } from '../src/ai/run';
import { applyToSession, sessionKey, type Session } from '../src/sidepanel/sessions';
import type { AnalysisInput, ModelRequest } from '../src/ai/types';
import { chatgptMixedTopics } from './fixtures/chatgpt';
import { buildLongConversation } from './fixtures/long-conversation';

// ------------------------------------------------------------- helpers -----

function smallConversation(): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/conv-mixed',
        method: 'test',
      }),
    ),
  );
}

/** The turn numbers a prompt actually asked the model to place. */
function assignableTurns(prompt: string): number[] {
  const out: number[] = [];
  const re = /^--- Turn (\d+) — /gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) out.push(Number(match[1]));
  return out;
}

/** The turn numbers a prompt showed only as background. */
function contextTurns(prompt: string): number[] {
  const out: number[] = [];
  const re = /^--- Earlier turn (\d+) — /gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) out.push(Number(match[1]));
  return out;
}

function flatten(sections: readonly AnalysisSection[]): number[] {
  return sections.flatMap((s) => s.turns.map((t) => t.number));
}

/**
 * A script that behaves like a co-operative model: each section reports the
 * subjects it saw, the merge collapses the three names for one thing, and each
 * section places exactly the turns it was given.
 */
function cooperativeScript(
  canonical: readonly { id: string; name: string }[] = [
    { id: 'c1', name: 'Chrome Web Store release' },
    { id: 'c2', name: 'Travel plans' },
  ],
): MockScript {
  return {
    discover: (_request, call) =>
      JSON.stringify({
        topics: [
          {
            id: 't1',
            name: `Section ${call + 1} subject`,
            description: 'Something this section covered.',
          },
        ],
      }),
    merge: () =>
      JSON.stringify({
        topics: canonical.map((t) => ({
          ...t,
          description: `About ${t.name}.`,
        })),
      }),
    classify: (request) =>
      JSON.stringify({
        assignments: assignableTurns(request.user).map((turn, i) => ({
          turn,
          topic: canonical[i % canonical.length]!.id,
          uncertain: false,
        })),
      }),
  };
}

// ------------------------------------------------------- planning ----------

describe('choosing how a conversation is sent', () => {
  it('keeps an ordinary conversation in one request', () => {
    const plan = planAnalysis(buildAnalysisInput(smallConversation()));

    expect(plan.mode).toBe('single');
    expect(plan.requests).toBe(1);
    expect(plan.chars).toBeLessThan(SAFE_REQUEST_CHARS);
  });

  it('divides a conversation that would not fit', () => {
    const input = buildAnalysisInput(buildLongConversation());
    const plan = planAnalysis(input);

    expect(plan.mode).toBe('sections');
    expect(plan.chars).toBeGreaterThan(SAFE_REQUEST_CHARS);
    expect(plan.sectionCount).toBeGreaterThan(1);
    // Two passes over every section, plus one to reconcile them.
    expect(plan.requests).toBe(plan.sectionCount * 2 + 1);
  });

  it('reproduces the observed conversation and plans a bounded run', () => {
    const state = buildLongConversation({ turns: 866, charsPerTurn: 794 });
    const input = buildAnalysisInput(state);

    expect(input.turns).toHaveLength(866);
    // The failure report said about 687,832 characters.
    const payload = input.turns.reduce((n, t) => n + t.text.length, 0);
    expect(payload).toBeGreaterThan(650_000);
    expect(payload).toBeLessThan(720_000);

    const plan = planAnalysis(input);
    expect(plan.mode).toBe('sections');
    expect(plan.sectionCount).toBeLessThanOrEqual(MAX_SECTIONS);
    expect(plan.requests).toBeLessThan(50);
  });

  it('covers every retained turn exactly once, in order', () => {
    const input = buildAnalysisInput(buildLongConversation());
    const plan = planAnalysis(input);

    const seen = flatten(plan.sections);
    expect(seen).toEqual(input.turns.map((t) => t.number));
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('keeps the original sequence numbers, not per-section ones', () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 400 }));
    const plan = planAnalysis(input);
    const last = plan.sections[plan.sections.length - 1]!;

    expect(plan.sections[0]!.turns[0]!.number).toBe(0);
    expect(last.turns[last.turns.length - 1]!.number).toBe(399);
  });

  it('leaves excluded turns out of every section', () => {
    let state = buildLongConversation({ turns: 300 });
    state = setIncluded(state, 'chatgpt-7', false);
    state = setIncluded(state, 'chatgpt-208', false);

    const plan = planAnalysis(buildAnalysisInput(state));
    const seen = flatten(plan.sections);

    expect(seen).not.toContain(7);
    expect(seen).not.toContain(208);
    expect(seen).toHaveLength(298);
  });

  it('sections the working text, never the original', () => {
    let state = buildLongConversation({ turns: 300 });
    state = setWorkingText(state, 'chatgpt-5', 'Redacted by the user.');

    const plan = planAnalysis(buildAnalysisInput(state));
    const all = plan.sections
      .flatMap((s) => s.turns)
      .map((t) => t.text)
      .join('\n');

    expect(all).toContain('Redacted by the user.');
    expect(all).not.toContain('Turn 5 continues the discussion');
  });

  it('respects the per-turn limit inside a section', () => {
    const state = buildLongConversation({ turns: 200, charsPerTurn: 9000 });
    const input = buildAnalysisInput(state, { maxCharsPerTurn: 400 });
    const plan = planAnalysis(input);

    for (const section of plan.sections) {
      for (const turn of section.turns) {
        expect(turn.text.length).toBeLessThanOrEqual(401);
        expect(turn.truncated).toBe(true);
      }
    }
  });

  it('keeps each section inside the size budget', () => {
    const input = buildAnalysisInput(buildLongConversation());
    const plan = planAnalysis(input);

    for (const section of plan.sections) {
      expect(section.chars).toBeLessThan(SAFE_REQUEST_CHARS);
      expect(section.chars).toBe(
        section.turns.reduce((n, t) => n + turnCost(t), 0),
      );
    }
  });

  it('does not end a section on a question whose answer starts the next', () => {
    const plan = planAnalysis(buildAnalysisInput(buildLongConversation()));

    for (let i = 0; i < plan.sections.length - 1; i += 1) {
      const section = plan.sections[i]!;
      const next = plan.sections[i + 1]!;
      if (section.turns.length < 2) continue;
      const last = section.turns[section.turns.length - 1]!;
      const first = next.turns[0]!;
      expect(last.role === 'user' && first.role === 'assistant').toBe(false);
    }
  });

  it('shows a section the turns just before it, without claiming them', () => {
    const plan = planAnalysis(buildAnalysisInput(buildLongConversation()));

    expect(plan.sections[0]!.context).toEqual([]);
    for (let i = 1; i < plan.sections.length; i += 1) {
      const section = plan.sections[i]!;
      const previous = plan.sections[i - 1]!;
      expect(section.context.length).toBeGreaterThan(0);

      const owned = new Set(section.turns.map((t) => t.number));
      for (const shown of section.context) {
        expect(owned.has(shown.number)).toBe(false);
        expect(previous.turns.some((t) => t.number === shown.number)).toBe(true);
      }
    }
  });

  it('survives conversations that are not neatly alternating', () => {
    const cases: Array<{ name: string; state: WorkingState }> = [
      {
        name: 'every turn from the user',
        state: buildLongConversation({ turns: 300, roleAt: () => 'user' }),
      },
      {
        name: 'every turn from the assistant',
        state: buildLongConversation({ turns: 300, roleAt: () => 'assistant' }),
      },
      {
        name: 'long runs of one role',
        state: buildLongConversation({
          turns: 300,
          roleAt: (i) => (Math.floor(i / 7) % 2 === 0 ? 'user' : 'assistant'),
        }),
      },
    ];

    for (const { name, state } of cases) {
      const input = buildAnalysisInput(state);
      const plan = planAnalysis(input);
      expect(plan.mode, name).toBe('sections');
      expect(flatten(plan.sections), name).toEqual(
        input.turns.map((t) => t.number),
      );
    }
  });

  it('handles empty turns and one enormous turn without losing either', () => {
    let state = buildLongConversation({ turns: 200 });
    state = setWorkingText(state, 'chatgpt-3', '');
    state = setWorkingText(state, 'chatgpt-4', '   ');
    state = setWorkingText(state, 'chatgpt-100', 'z'.repeat(500_000));

    const input = buildAnalysisInput(state);
    const plan = planAnalysis(input);
    const seen = flatten(plan.sections);

    expect(seen).toEqual(input.turns.map((t) => t.number));
    expect(seen).toContain(3);
    expect(seen).toContain(4);
    expect(seen).toContain(100);
  });

  it('refuses a conversation past any sensible number of requests', () => {
    const state = buildLongConversation({ turns: 4000, charsPerTurn: 1400 });
    const plan = planAnalysis(buildAnalysisInput(state));

    expect(plan.mode).toBe('too-large');
    expect(plan.sectionCount).toBeGreaterThan(MAX_SECTIONS);
    expect(plan.sections).toEqual([]);
  });
});

// -------------------------------------------------------- running ----------

describe('running a short conversation', () => {
  const reply = JSON.stringify({
    topics: [{ id: 't1', name: 'One thing', description: 'All of it.' }],
    assignments: [{ turn: 0, topic: 't1', uncertain: false }],
  });

  it('still makes exactly one request', async () => {
    const analyzer = new MockAnalyzer(reply);
    const result = await runTopicAnalysis(
      analyzer,
      buildAnalysisInput(smallConversation()),
    );

    expect(result.ok).toBe(true);
    expect(analyzer.calls).toHaveLength(1);
    expect(analyzer.calls[0]!.stage).toBe('single');
  });

  it('reports a run that was asked for with nothing to analyse', async () => {
    const analyzer = new MockAnalyzer(reply);
    const empty: AnalysisInput = { turns: [], existingTopics: [] };
    const result = await runTopicAnalysis(analyzer, empty);

    expect(result.ok).toBe(false);
    expect(analyzer.calls).toHaveLength(0);
  });
});

describe('running a long conversation', () => {
  it('switches to sections on its own and makes the planned calls', async () => {
    const input = buildAnalysisInput(buildLongConversation());
    const plan = planAnalysis(input);
    const analyzer = new MockAnalyzer(cooperativeScript());

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(true);
    expect(analyzer.countOf('single')).toBe(0);
    expect(analyzer.countOf('discover')).toBe(plan.sectionCount);
    expect(analyzer.countOf('merge')).toBe(1);
    expect(analyzer.countOf('classify')).toBe(plan.sectionCount);
    expect(analyzer.calls).toHaveLength(plan.requests);
  });

  it('places every retained turn exactly once', async () => {
    const input = buildAnalysisInput(buildLongConversation());
    const analyzer = new MockAnalyzer(cooperativeScript());

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    const placed = result.proposal.assignments.map((a) => a.turn);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort((a, b) => a - b)).toEqual(
      input.turns.map((t) => t.number),
    );
    expect(result.proposal.unplaced).toEqual([]);
  });

  it('uses only the canonical topic ids in the final proposal', async () => {
    const input = buildAnalysisInput(buildLongConversation());
    const analyzer = new MockAnalyzer(cooperativeScript());

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    const ids = new Set(result.proposal.topics.map((t) => t.id));
    expect([...ids].sort()).toEqual(['c1', 'c2']);
    for (const a of result.proposal.assignments) {
      expect(
        ids.has(a.topic) || a.topic === SHARED || a.topic === BUILT_IN_TOPIC_MODEL_ID,
      ).toBe(true);
    }
  });

  it('says in the notes that the conversation was divided', async () => {
    const input = buildAnalysisInput(buildLongConversation());
    const result = await runTopicAnalysis(
      new MockAnalyzer(cooperativeScript()),
      input,
    );
    if (!result.ok) throw new Error(result.errors.join(' '));

    expect(result.proposal.notes.join(' ')).toMatch(/analysed in \d+ sections/);
  });

  it('reports progress the user can follow', async () => {
    const input = buildAnalysisInput(buildLongConversation());
    const plan = planAnalysis(input);
    const seen: string[] = [];

    await runTopicAnalysis(new MockAnalyzer(cooperativeScript()), input, {
      onProgress: (p) =>
        seen.push(
          p.phase === 'discover' || p.phase === 'classify'
            ? `${p.phase} ${p.section}/${p.sections}`
            : p.phase,
        ),
    });

    expect(seen[0]).toBe(`discover 1/${plan.sectionCount}`);
    expect(seen).toContain('merge');
    expect(seen[seen.length - 1]).toBe(
      `classify ${plan.sectionCount}/${plan.sectionCount}`,
    );
    expect(seen).toHaveLength(plan.requests);
  });

  it('never sends an excluded turn, in any request', async () => {
    let state = buildLongConversation({ turns: 300 });
    state = setIncluded(state, 'chatgpt-11', false);
    state = setWorkingText(state, 'chatgpt-12', 'A secret the user removed.');
    state = setIncluded(state, 'chatgpt-12', false);

    const analyzer = new MockAnalyzer(cooperativeScript());
    await runTopicAnalysis(analyzer, buildAnalysisInput(state));

    const sent = analyzer.calls.map((c: ModelRequest) => c.user).join('\n');
    expect(sent).not.toContain('A secret the user removed.');
    expect(sent).not.toMatch(/^--- Turn 11 — /m);
    expect(sent).not.toMatch(/^--- Earlier turn 11 — /m);
  });

  it('sends the edited text rather than what the provider originally said', async () => {
    let state = buildLongConversation({ turns: 300 });
    state = setWorkingText(state, 'chatgpt-9', 'Only this much survives.');

    const analyzer = new MockAnalyzer(cooperativeScript());
    await runTopicAnalysis(analyzer, buildAnalysisInput(state));

    const sent = analyzer.calls.map((c: ModelRequest) => c.user).join('\n');
    expect(sent).toContain('Only this much survives.');
    expect(sent).not.toContain('Turn 9 continues the discussion');
  });

  it('does not let overlapping context become a second assignment', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 400 }));
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      // A model that ignores the instruction and places its context too.
      classify: (request) =>
        JSON.stringify({
          assignments: [
            ...contextTurns(request.user).map((turn) => ({
              turn,
              topic: 'c2',
              uncertain: false,
            })),
            ...assignableTurns(request.user).map((turn) => ({
              turn,
              topic: 'c1',
              uncertain: false,
            })),
          ],
        }),
    });

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    const placed = result.proposal.assignments.map((a) => a.turn);
    expect(new Set(placed).size).toBe(placed.length);
    // Every turn kept the decision of the section that owned it.
    expect(result.proposal.assignments.every((a) => a.topic === 'c1')).toBe(true);
  });

  it('refuses an absurd conversation before sending anything', async () => {
    const state = buildLongConversation({ turns: 4000, charsPerTurn: 1400 });
    const analyzer = new MockAnalyzer(cooperativeScript());

    const result = await runTopicAnalysis(analyzer, buildAnalysisInput(state));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/too long to analyse automatically/i);
    expect(analyzer.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------- reconciliation -------

describe('reconciling the topics each section found', () => {
  it('shows the merge step every section list, and only topic names', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const plan = planAnalysis(input);
    const analyzer = new MockAnalyzer({
      discover: (_request, call) =>
        JSON.stringify({
          topics: [
            {
              id: 't1',
              name: ['Chrome extension publishing', 'Web Store submission', 'Chrome Store setup'][
                call % 3
              ],
              description: 'Getting the extension listed.',
            },
          ],
        }),
      merge: () =>
        JSON.stringify({
          topics: [
            {
              id: 'c1',
              name: 'Chrome Web Store release',
              description: 'Everything about listing the extension.',
            },
          ],
        }),
      classify: (request) =>
        JSON.stringify({
          assignments: assignableTurns(request.user).map((turn) => ({
            turn,
            topic: 'c1',
            uncertain: false,
          })),
        }),
    });

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    const merge = analyzer.calls.find((c: ModelRequest) => c.stage === 'merge')!;
    expect(merge.user).toContain('Chrome extension publishing');
    expect(merge.user).toContain('Web Store submission');
    expect(merge.user).toContain('Chrome Store setup');
    for (let i = 1; i <= plan.sectionCount; i += 1) {
      expect(merge.user).toContain(`Section ${i}:`);
    }
    // The merge step is given topic names, not the conversation again.
    expect(merge.user).not.toContain('continues the discussion of');
    expect(merge.user.length).toBeLessThan(10_000);

    // Three names for one thing became one topic.
    expect(result.proposal.topics).toHaveLength(1);
    expect(result.proposal.topics[0]!.name).toBe('Chrome Web Store release');
  });

  it('gives the final pass the canonical list and nothing to invent from', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer(cooperativeScript());
    await runTopicAnalysis(analyzer, input);

    const classify = analyzer.calls.filter((c: ModelRequest) => c.stage === 'classify');
    for (const call of classify) {
      expect(call.user).toContain('id "c1"');
      expect(call.user).toContain('id "c2"');
      expect(call.user).toContain('Use these ids and no others.');
    }
  });

  it('drops a section that answers with a topic nobody agreed on', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      classify: (request, call) =>
        JSON.stringify({
          assignments: assignableTurns(request.user).map((turn) => ({
            turn,
            topic: call === 0 ? 'invented-by-this-section' : 'c1',
            uncertain: false,
          })),
        }),
    });

    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    expect(result.proposal.topics.map((t) => t.id)).toEqual(['c1', 'c2']);
    // The first section's turns were refused rather than filed under a topic
    // the rest of the conversation has never heard of.
    expect(result.proposal.unplaced.length).toBeGreaterThan(0);
    expect(result.proposal.notes.join(' ')).toMatch(/not proposed|unassigned/i);
  });
});

// -------------------------------------------------- the built-in topic -----

describe('the built-in topic across sections', () => {
  it('is offered to every stage and never re-proposed', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      classify: (request) =>
        JSON.stringify({
          assignments: assignableTurns(request.user).flatMap((turn, i) => {
            if (i === 0) {
              return [{ turn, topic: BUILT_IN_TOPIC_MODEL_ID, uncertain: false }];
            }
            // A turn in two topics is listed twice — which is what a model now
            // has instead of "shared", and is a far narrower claim.
            if (i === 1) {
              return [
                { turn, topic: 'c1', uncertain: false },
                { turn, topic: 'c2', uncertain: false },
              ];
            }
            return [{ turn, topic: 'c1', uncertain: false }];
          }),
        }),
    });

    const state = buildLongConversation({ turns: 300 });
    const result = await runTopicAnalysis(analyzer, input);
    if (!result.ok) throw new Error(result.errors.join(' '));

    // Discovery and merge are told to leave it alone; classification is told
    // what belongs in it.
    for (const call of analyzer.calls) {
      if (call.stage === 'discover' || call.stage === 'merge') {
        expect(call.user).toContain(`"${BUILT_IN_TOPIC_MODEL_ID}"`);
        expect(call.user).toMatch(/do not (list|include) it/i);
      }
      if (call.stage === 'classify') {
        expect(call.user).toContain(`id "${BUILT_IN_TOPIC_MODEL_ID}"`);
      }
    }

    expect(result.proposal.topics.map((t) => t.id)).not.toContain(
      BUILT_IN_TOPIC_MODEL_ID,
    );

    const applied = applyProposal(state, result.proposal);
    expect(applied.topics.filter((t) => t.builtIn)).toHaveLength(1);
    expect(
      applied.turns.some((t) => t.assignment === BUILT_IN_TOPIC_ID),
    ).toBe(true);
    // Nothing a model said becomes Shared: that would put the turn in every
    // topic, and is a decision only a person makes.
    expect(applied.turns.every((t) => t.assignment !== SHARED)).toBe(true);
    expect(applied.turns.some((t) => t.alsoIn.length > 0)).toBe(true);
  });

  it('rejects a merged list that tries to claim the reserved id', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      merge: () =>
        JSON.stringify({
          topics: [
            { id: BUILT_IN_TOPIC_MODEL_ID, name: 'Mine now', description: 'x' },
          ],
        }),
    });

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/could not be combined/i);
    expect(analyzer.countOf('classify')).toBe(0);
  });
});

// ------------------------------------------------------ cancellation -------

describe('cancelling a long run', () => {
  async function cancelDuring(stage: 'discover' | 'merge' | 'classify') {
    const input = buildAnalysisInput(buildLongConversation({ turns: 400 }));
    const controller = new AbortController();
    const script = cooperativeScript();

    const analyzer = new MockAnalyzer({
      discover: (request, call) => {
        if (stage === 'discover' && call === 1) controller.abort();
        return script.discover!(request, call) as string;
      },
      merge: (request, call) => {
        if (stage === 'merge') controller.abort();
        return script.merge!(request, call) as string;
      },
      classify: (request, call) => {
        if (stage === 'classify' && call === 1) controller.abort();
        return script.classify!(request, call) as string;
      },
    });

    const result = await runTopicAnalysis(analyzer, input, {
      signal: controller.signal,
    });
    return { result, analyzer, sections: planAnalysis(input).sectionCount };
  }

  it('stops while reading sections', async () => {
    const { result, analyzer, sections } = await cancelDuring('discover');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['The request was cancelled.']);
    expect(analyzer.countOf('discover')).toBeLessThan(sections);
    expect(analyzer.countOf('merge')).toBe(0);
    expect(analyzer.countOf('classify')).toBe(0);
  });

  it('stops while reconciling topics', async () => {
    const { result, analyzer } = await cancelDuring('merge');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['The request was cancelled.']);
    expect(analyzer.countOf('merge')).toBe(1);
    expect(analyzer.countOf('classify')).toBe(0);
  });

  it('stops while sorting sections, without a half-finished proposal', async () => {
    const { result, analyzer, sections } = await cancelDuring('classify');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['The request was cancelled.']);
    expect(analyzer.countOf('classify')).toBeLessThan(sections);
  });

  it('makes no request at all when it is cancelled before it starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const analyzer = new MockAnalyzer(cooperativeScript());

    const result = await runTopicAnalysis(
      analyzer,
      buildAnalysisInput(buildLongConversation({ turns: 400 })),
      { signal: controller.signal },
    );

    expect(result.ok).toBe(false);
    expect(analyzer.calls).toHaveLength(0);
  });
});

// ------------------------------------------------ untrusted intermediates --

describe('what a badly behaved model cannot do', () => {
  const input = () => buildAnalysisInput(buildLongConversation({ turns: 400 }));

  it('tolerates one section that answers with nonsense', async () => {
    const script = cooperativeScript();
    const analyzer = new MockAnalyzer({
      ...script,
      discover: (request, call) =>
        call === 0 ? 'I would rather not.' : (script.discover!(request, call) as string),
    });

    const result = await runTopicAnalysis(analyzer, input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.notes.join(' ')).toMatch(/readable list of topics/i);
    expect(result.proposal.unplaced).toEqual([]);
  });

  it('gives up when no section returns anything usable', async () => {
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      discover: () => 'Nope.',
    });

    const result = await runTopicAnalysis(analyzer, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/no section returned/i);
    expect(analyzer.countOf('merge')).toBe(0);
  });

  it('gives up when the merge step is unreadable, and changes nothing', async () => {
    const state = buildLongConversation({ turns: 400 });
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      merge: () => '<<not json>>',
    });

    const result = await runTopicAnalysis(analyzer, buildAnalysisInput(state));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/could not be combined/i);
    expect(analyzer.countOf('classify')).toBe(0);
    expect(state.topics.map((t) => t.builtIn)).toEqual([true]);
    expect(state.turns.every((t) => t.assignment === UNASSIGNED)).toBe(true);
  });

  it('leaves one unreadable section unassigned rather than losing the rest', async () => {
    const script = cooperativeScript();
    const analyzer = new MockAnalyzer({
      ...script,
      classify: (request, call) =>
        call === 1 ? 'Sorry, no.' : (script.classify!(request, call) as string),
    });

    const result = await runTopicAnalysis(analyzer, input());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.unplaced.length).toBeGreaterThan(0);
    expect(result.proposal.assignments.length).toBeGreaterThan(0);
    expect(result.proposal.notes.join(' ')).toMatch(/could not be sorted/i);

    // Everything is still accounted for: placed plus unplaced is the whole
    // conversation, with no turn in both.
    const placed = result.proposal.assignments.map((a) => a.turn);
    const all = [...placed, ...result.proposal.unplaced].sort((a, b) => a - b);
    expect(all).toEqual(input().turns.map((t) => t.number));
  });

  it('ignores an invented turn number from a section', async () => {
    const script = cooperativeScript();
    const analyzer = new MockAnalyzer({
      ...script,
      classify: (request) =>
        JSON.stringify({
          assignments: [
            { turn: 99_999, topic: 'c1', uncertain: false },
            { turn: -3, topic: 'c1', uncertain: false },
            ...assignableTurns(request.user).map((turn) => ({
              turn,
              topic: 'c1',
              uncertain: false,
            })),
          ],
        }),
    });

    const result = await runTopicAnalysis(analyzer, input());
    if (!result.ok) throw new Error(result.errors.join(' '));

    const placed = result.proposal.assignments.map((a) => a.turn);
    expect(placed).not.toContain(99_999);
    expect(placed).not.toContain(-3);
    expect(result.proposal.unplaced).toEqual([]);
  });

  it('will not let a section claim a turn belonging to another section', async () => {
    const script = cooperativeScript();
    const analyzer = new MockAnalyzer({
      ...script,
      classify: (request, call) =>
        JSON.stringify({
          // Section 0 tries to place every turn in the conversation.
          assignments: (call === 0
            ? Array.from({ length: 400 }, (_, i) => i)
            : assignableTurns(request.user)
          ).map((turn) => ({ turn, topic: 'c1', uncertain: false })),
        }),
    });

    const first = planAnalysis(input()).sections[0]!;
    const result = await runTopicAnalysis(analyzer, input());
    if (!result.ok) throw new Error(result.errors.join(' '));

    const placed = result.proposal.assignments.map((a) => a.turn);
    expect(new Set(placed).size).toBe(placed.length);
    // It only got the turns it was actually shown.
    const firstPass = result.proposal.assignments.slice(0, first.turns.length);
    expect(firstPass.map((a) => a.turn)).toEqual(
      first.turns.map((t) => t.number),
    );
  });

  it('rejects a merged list longer than the proposal limit', async () => {
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      merge: () =>
        JSON.stringify({
          topics: Array.from({ length: 30 }, (_, i) => ({
            id: `c${i}`,
            name: `Topic ${i}`,
            description: 'x',
          })),
        }),
    });

    const result = await runTopicAnalysis(analyzer, input());

    expect(result.ok).toBe(false);
    expect(analyzer.countOf('classify')).toBe(0);
  });

  it('stops the run when a request is refused rather than paying for the rest', async () => {
    const analyzer = new MockAnalyzer({
      ...cooperativeScript(),
      discover: (_request, call) =>
        call === 2
          ? { ok: false as const, errors: ['OpenAI rejected that API key.'] }
          : JSON.stringify({ topics: [{ id: 't1', name: 'A', description: 'x' }] }),
    });

    const result = await runTopicAnalysis(analyzer, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['OpenAI rejected that API key.']);
    expect(analyzer.countOf('discover')).toBe(3);
    expect(analyzer.countOf('merge')).toBe(0);
  });
});

// ----------------------------------------------- landing in the right place -

describe('where a long run\'s answer is allowed to land', () => {
  function session(key: string, epoch: number, working: WorkingState): Session {
    return {
      key,
      tabId: 1,
      provider: 'chatgpt',
      conversationId: 'conv-long',
      working,
      epoch,
      proposalNotes: null,
    };
  }

  it('is dropped when the conversation was reloaded while it ran', async () => {
    const state = buildLongConversation({ turns: 300 });
    const key = sessionKey(1, 'chatgpt', 'conv-long');

    const result = await runTopicAnalysis(
      new MockAnalyzer(cooperativeScript()),
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error(result.errors.join(' '));

    // The run started at epoch 0; the session is now at epoch 1.
    const reloaded = new Map([[key, session(key, 1, state)]]);
    const after = applyToSession(reloaded, key, 0, (w) =>
      applyProposal(w, result.proposal),
    );

    expect(after).toBe(reloaded);
    expect(after.get(key)!.working.topics.every((t) => !t.fromProposal)).toBe(true);
  });

  it('is dropped when the user has moved to another conversation', async () => {
    const state = buildLongConversation({ turns: 300 });
    const started = sessionKey(1, 'chatgpt', 'conv-long');
    const other = sessionKey(2, 'chatgpt', 'conv-other');
    const sessions = new Map([[other, session(other, 0, state)]]);

    const result = await runTopicAnalysis(
      new MockAnalyzer(cooperativeScript()),
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error(result.errors.join(' '));

    const after = applyToSession(sessions, started, 0, (w) =>
      applyProposal(w, result.proposal),
    );

    expect(after).toBe(sessions);
    expect(after.get(other)!.working.topics.some((t) => t.fromProposal)).toBe(
      false,
    );
  });

  it('lands when the conversation is still the one that asked', async () => {
    const state = buildLongConversation({ turns: 300 });
    const key = sessionKey(1, 'chatgpt', 'conv-long');
    const sessions = new Map([[key, session(key, 4, state)]]);

    const result = await runTopicAnalysis(
      new MockAnalyzer(cooperativeScript()),
      buildAnalysisInput(state),
    );
    if (!result.ok) throw new Error(result.errors.join(' '));

    const after = applyToSession(
      sessions,
      key,
      4,
      (w) => applyProposal(w, result.proposal),
      result.proposal.notes,
    );

    expect(after).not.toBe(sessions);
    const applied = after.get(key)!;
    expect(applied.working.topics.filter((t) => t.fromProposal)).toHaveLength(2);
    expect(
      applied.working.turns.every((t) => t.assignment !== UNASSIGNED),
    ).toBe(true);
  });
});
