/**
 * The live failure of 24 August 2026, and the two things that now prevent it.
 *
 * A real 876-turn ChatGPT conversation was analysed with OpenAI gpt-4o-mini.
 * It sectioned correctly, ran all fifteen discovery requests in about 55
 * seconds, and then threw the lot away:
 *
 *     The topics from each section could not be combined:
 *     The reply had no "topics" list.
 *
 * The cause was not the model and not the prompt. The OpenAI client accepted a
 * `schema` on every request and never put it on the wire — it sent
 * `response_format: { type: 'json_object' }`, which guarantees only that the
 * reply parses. The merge step duly answered with valid JSON under a property
 * name of its own choosing, and fifteen paid requests were lost.
 *
 * Two defences, tested here. Structured Outputs stops the wrong shape being
 * produced; the bounded repair recovers if one is produced anyway. The second
 * exists because the first depends on a model the user can retype at will.
 */

import { describe, expect, it } from 'vitest';
import { buildAnalysisInput } from '../src/ai/prompt';
import { planAnalysis } from '../src/ai/plan';
import { MockAnalyzer, type MockScript } from '../src/ai/providers/mock';
import { runTopicAnalysis, MAX_REPAIRS_PER_RUN } from '../src/ai/run';
import { REPAIR_SYSTEM_PROMPT } from '../src/ai/stages';
import type { ModelRequest } from '../src/ai/types';
import { buildLongConversation } from './fixtures/long-conversation';

/**
 * The conversation from the live run: 876 turns, fifteen sections.
 *
 * The per-turn length is chosen so the fixture divides into the same fifteen
 * sections the real conversation did, which is what makes the request counts
 * below comparable with what the user actually paid for.
 */
function liveConversation() {
  return buildAnalysisInput(
    buildLongConversation({ turns: 876, charsPerTurn: 760 }),
  );
}

function turnsIn(prompt: string): number[] {
  const out: number[] = [];
  const re = /^--- Turn (\d+) — /gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) out.push(Number(m[1]));
  return out;
}

const CANONICAL = [
  { id: 'c1', name: 'Chrome Web Store release', description: 'Listing it.' },
  { id: 'c2', name: 'Travel plans', description: 'Lisbon.' },
];

/** Everything except merge behaves; merge is the variable under test. */
function scriptWithMerge(merge: MockScript['merge']): MockScript {
  return {
    discover: (_r, call) =>
      JSON.stringify({
        topics: [
          { id: 't1', name: `Section ${call + 1}`, description: 'Something.' },
        ],
      }),
    merge,
    classify: (request) =>
      JSON.stringify({
        assignments: turnsIn(request.user).map((turn, i) => ({
          turn,
          topic: CANONICAL[i % CANONICAL.length]!.id,
          uncertain: false,
        })),
      }),
  };
}

/**
 * Behave like a model asked to reformat its own answer: pull the previous
 * reply out of the repair prompt and put the array under the right property.
 *
 * This is what makes the repair tests meaningful. A fixture that simply
 * returns a fresh correct answer would pass even if the repair prompt carried
 * nothing useful; this one can only work if the previous reply really is in
 * there.
 */
function reformat(request: ModelRequest, to: string): string {
  const match = request.user.match(/Your previous reply:\n([\s\S]*?)\n\nReturn/);
  if (!match) throw new Error('repair prompt did not carry the previous reply');
  const previous = JSON.parse(match[1]!) as Record<string, unknown>;
  const only = Object.values(previous)[0];
  return JSON.stringify({ [to]: only });
}

/** Requests that were repairs rather than ordinary stage requests. */
function repairs(analyzer: MockAnalyzer): ModelRequest[] {
  return analyzer.calls.filter(
    (c: ModelRequest) => c.system === REPAIR_SYSTEM_PROMPT,
  );
}

// ------------------------------------------------- the exact live failure --

describe('the merge reply that lost the first live run', () => {
  /** What gpt-4o-mini actually did: right information, wrong property. */
  const WRONG_KEY = () => JSON.stringify({ canonical_topics: CANONICAL });

  it('reproduces the old failure exactly when nothing may be repaired', async () => {
    const input = liveConversation();
    const plan = planAnalysis(input);
    expect(plan.sectionCount).toBe(15);

    const analyzer = new MockAnalyzer(scriptWithMerge(WRONG_KEY));
    const result = await runTopicAnalysis(analyzer, input, { maxRepairs: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The sentence the user saw, and the diagnosis it used to be missing.
    expect(result.errors[0]).toMatch(/could not be combined/i);
    expect(result.errors[0]).toContain('"canonical_topics"');
    expect(result.errors[0]).toContain('"topics"');

    // Fifteen discovery requests were made and their work was lost — which is
    // what made this expensive rather than merely annoying.
    expect(analyzer.countOf('discover')).toBe(15);
    expect(analyzer.countOf('classify')).toBe(0);
    expect(result.errors[0]).toContain('15 sections');
  });

  it('recovers with exactly one repair, and finishes the analysis', async () => {
    const input = liveConversation();
    const plan = planAnalysis(input);
    let mergeCalls = 0;
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => {
        mergeCalls += 1;
        // Wrong the first time, right when asked again — which is what a
        // model does when told exactly which property name to use.
        return mergeCalls === 1
          ? JSON.stringify({ canonical_topics: CANONICAL })
          : JSON.stringify({ topics: CANONICAL });
      }),
    );

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.topics.map((t) => t.id)).toEqual(['c1', 'c2']);
    expect(result.proposal.unplaced).toEqual([]);
    expect(result.proposal.assignments).toHaveLength(876);

    expect(repairs(analyzer)).toHaveLength(1);
    expect(analyzer.calls).toHaveLength(plan.requests + 1);
  });

  it('repairs by reformatting the reply, not by resending the conversation', async () => {
    const input = liveConversation();
    let mergeCalls = 0;
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => {
        mergeCalls += 1;
        return mergeCalls === 1
          ? JSON.stringify({ canonical_topics: CANONICAL })
          : JSON.stringify({ topics: CANONICAL });
      }),
    );

    await runTopicAnalysis(analyzer, input);
    const repair = repairs(analyzer)[0]!;

    // It carries the model's own previous answer and the schema, and says
    // which property is required.
    expect(repair.user).toContain('canonical_topics');
    expect(repair.user).toContain('"topics"');
    expect(repair.schema).toBeDefined();
    // And no conversation text at all.
    expect(repair.user).not.toContain('continues the discussion of');
    expect(repair.user.length).toBeLessThan(6_000);
  });

  it('never silently accepts the wrong property name', async () => {
    // Even with repair available, a model that keeps answering wrongly is
    // refused. The canonical shape is the schema's, not whatever turned up.
    const analyzer = new MockAnalyzer(scriptWithMerge(WRONG_KEY));
    const result = await runTopicAnalysis(analyzer, liveConversation());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/after being asked again/i);
    expect(repairs(analyzer)).toHaveLength(1);
  });
});

// ------------------------------------------------- the other two stages ----

describe('a wrongly shaped reply from the other stages', () => {
  it('repairs one discovery section and keeps the rest', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer({
      ...scriptWithMerge(() => JSON.stringify({ topics: CANONICAL })),
      discover: (request, call) => {
        if (request.system === REPAIR_SYSTEM_PROMPT) {
          return reformat(request, 'topics');
        }
        const topics = [
          { id: 't1', name: `Section ${call + 1}`, description: 'x' },
        ];
        // The first section answers under the wrong property name.
        return call === 0
          ? JSON.stringify({ found_topics: topics })
          : JSON.stringify({ topics });
      },
    });

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(repairs(analyzer)).toHaveLength(1);
    expect(result.proposal.unplaced).toEqual([]);
    // No note about an unreadable section: it was recovered.
    expect(result.proposal.notes.join(' ')).not.toMatch(/readable list/i);
  });

  it('repairs one classification section rather than losing its turns', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer({
      ...scriptWithMerge(() => JSON.stringify({ topics: CANONICAL })),
      classify: (request, call) => {
        if (request.system === REPAIR_SYSTEM_PROMPT) {
          return reformat(request, 'assignments');
        }
        const assignments = turnsIn(request.user).map((turn) => ({
          turn,
          topic: 'c1',
          uncertain: false,
        }));
        // The first section places every turn correctly, under the wrong
        // property name. Reformatting it must not lose a single turn.
        return call === 0
          ? JSON.stringify({ turn_assignments: assignments })
          : JSON.stringify({ assignments });
      },
    });

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(repairs(analyzer)).toHaveLength(1);
    expect(result.proposal.unplaced).toEqual([]);
    expect(result.proposal.notes.join(' ')).not.toMatch(/could not be sorted/i);
  });

  it('does not repair a reply that was not JSON at all', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => 'I would rather not do that.'),
    );

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/not usable JSON/i);
    // Asking a model that ignored the format to reformat nothing is pointless.
    expect(repairs(analyzer)).toHaveLength(0);
  });
});

// ------------------------------------------------------------- bounded ----

describe('repair is bounded', () => {
  it('spends the run budget and then stops asking', async () => {
    const input = liveConversation();
    const plan = planAnalysis(input);
    // Every discovery reply is wrongly shaped, for ever.
    const analyzer = new MockAnalyzer({
      ...scriptWithMerge(() => JSON.stringify({ topics: CANONICAL })),
      discover: () => JSON.stringify({ nope: [] }),
    });

    const result = await runTopicAnalysis(analyzer, input);

    expect(repairs(analyzer)).toHaveLength(MAX_REPAIRS_PER_RUN);
    // Fifteen sections asked, four of them repaired, and then it gave up on
    // repairing rather than doubling the bill.
    expect(analyzer.countOf('discover')).toBe(15 + MAX_REPAIRS_PER_RUN);
    expect(analyzer.calls.length).toBeLessThanOrEqual(plan.maxRequests);

    // Nothing usable came back, so the run fails cleanly.
    expect(result.ok).toBe(false);
  });

  it('quotes a ceiling the run cannot exceed', async () => {
    const input = liveConversation();
    const plan = planAnalysis(input);

    expect(plan.requests).toBe(31);
    // 31 normal + 4 repairs + 1 wasted schema probe.
    expect(plan.maxRequests).toBe(36);
    expect(plan.maxRequests).toBeGreaterThan(plan.requests);
  });

  it('makes no repairs at all when every reply is well formed', async () => {
    const input = liveConversation();
    const plan = planAnalysis(input);
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => JSON.stringify({ topics: CANONICAL })),
    );

    const result = await runTopicAnalysis(analyzer, input);

    expect(result.ok).toBe(true);
    expect(repairs(analyzer)).toHaveLength(0);
    expect(analyzer.calls).toHaveLength(plan.requests);
  });
});

// -------------------------------------------------------- cancellation ----

describe('cancelling around a repair', () => {
  it('does not start a repair once the run has been cancelled', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const controller = new AbortController();
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => {
        // The reply is wrong, and the user stops the run in the same moment.
        controller.abort();
        return JSON.stringify({ canonical_topics: CANONICAL });
      }),
    );

    const result = await runTopicAnalysis(analyzer, input, {
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    expect(repairs(analyzer)).toHaveLength(0);
    expect(analyzer.countOf('classify')).toBe(0);
  });

  it('stops between a repair and the next stage', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    const controller = new AbortController();
    let mergeCalls = 0;
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => {
        mergeCalls += 1;
        if (mergeCalls === 1) return JSON.stringify({ canonical_topics: CANONICAL });
        controller.abort();
        return JSON.stringify({ topics: CANONICAL });
      }),
    );

    const result = await runTopicAnalysis(analyzer, input, {
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(['The request was cancelled.']);
    expect(repairs(analyzer)).toHaveLength(1);
    expect(analyzer.countOf('classify')).toBe(0);
  });

  it('reports a repair to the progress display rather than looking stalled', async () => {
    const input = buildAnalysisInput(buildLongConversation({ turns: 300 }));
    let mergeCalls = 0;
    const analyzer = new MockAnalyzer(
      scriptWithMerge(() => {
        mergeCalls += 1;
        return mergeCalls === 1
          ? JSON.stringify({ canonical_topics: CANONICAL })
          : JSON.stringify({ topics: CANONICAL });
      }),
    );

    const phases: string[] = [];
    await runTopicAnalysis(analyzer, input, {
      onProgress: (p) => phases.push(p.phase),
    });

    expect(phases).toContain('repair');
    expect(phases.filter((p) => p === 'repair')).toHaveLength(1);
  });
});
