/**
 * Turning a validated proposal into topics and assignments.
 *
 * The proposal does not become a second, hidden source of truth: applying it
 * writes into exactly the same topic list and per-turn assignments the manual
 * Split view uses, so any later manual change simply overwrites it.
 */

import type { Topic } from '../model/types';
import { BUILT_IN_TOPIC_MODEL_ID } from '../model/default-topic';
import { topicIdFromModelId } from './prompt';
import { setAssignments, setTopics, type WorkingState } from '../operations/working';
import type { TopicProposal } from './schema';
import type { AnalyzerConfig } from './types';
import type { TopicAnalyzer } from './types';
import { AnthropicAnalyzer } from './providers/anthropic';
import { OpenAiAnalyzer } from './providers/openai';

/**
 * Apply a proposal to the working state.
 *
 * Topic ids from the model are namespaced so they cannot collide with ids the
 * user's own topics already use. Turns the model did not place keep whatever
 * they had, which for a fresh conversation means Unassigned.
 */
export function applyProposal(
  state: WorkingState,
  proposal: TopicProposal,
): WorkingState {
  const idFor = (modelId: string) => `ai-${modelId}`;

  // Topics the user is responsible for survive a proposal, keeping whatever
  // names they gave them. Without this, applying a proposal would silently
  // replace the built-in topic with the model's own version of the same idea,
  // and would throw away a topic the user had added specifically so that the
  // model would find turns for it.
  //
  // Topics from a previous proposal are not kept: re-running Find Topics is
  // how you ask for a different answer, and keeping the old answer alongside
  // the new one would just accumulate near-duplicates.
  const kept = state.topics.filter((t) => t.builtIn || !t.fromProposal);
  const builtIn = kept.find((t) => t.builtIn);
  const keptById = new Map(kept.map((t) => [t.id, t]));

  const topics: Topic[] = [
    ...kept,
    ...proposal.topics.map((t) => ({
      id: idFor(t.id),
      name: t.name,
      description: t.description,
      fromProposal: true,
    })),
  ];

  /**
   * The internal topic a model id refers to, or null if it refers to nothing.
   *
   * A reserved id names a topic that already existed; if the user removed it
   * while the request was in flight there is nothing to assign to, and the
   * turn is left alone rather than the topic being resurrected behind them.
   */
  const topicFor = (modelId: string): string | null => {
    if (modelId === BUILT_IN_TOPIC_MODEL_ID) return builtIn?.id ?? null;
    const keptId = topicIdFromModelId(modelId);
    if (keptId !== null) return keptById.get(keptId)?.id ?? null;
    return idFor(modelId);
  };

  /*
    A model may list one turn under two topics, which is how it says the turn
    belongs to both. The first becomes the turn's assignment and the rest its
    further topics — a real membership in two topics out of fifteen, rather
    than Shared, which would put it in all fifteen. `validateTopicProposal`
    refuses Shared from a model outright, so nothing here can produce it.
  */
  const bySequence = new Map(state.turns.map((t) => [t.sequence, t.id]));
  const byTurn = new Map<
    string,
    { turnId: string; assignment: string; alsoIn: string[]; uncertain: boolean }
  >();

  for (const a of proposal.assignments) {
    const turnId = bySequence.get(a.turn);
    if (!turnId) continue;
    const topicId = topicFor(a.topic);
    if (topicId === null) continue;

    const existing = byTurn.get(turnId);
    if (!existing) {
      byTurn.set(turnId, {
        turnId,
        assignment: topicId,
        alsoIn: [],
        uncertain: a.uncertain,
      });
      continue;
    }
    if (existing.assignment === topicId || existing.alsoIn.includes(topicId)) {
      continue;
    }
    existing.alsoIn.push(topicId);
    // Belonging to two topics is a judgement, so the turn keeps any doubt the
    // model expressed about either of them.
    existing.uncertain = existing.uncertain || a.uncertain;
  }

  const updates = [...byTurn.values()];

  // Topics first: `setTopics` clears assignments that name a topic that no
  // longer exists, and the new assignments must be written after that.
  return setAssignments(setTopics(state, topics), updates, { byUser: false });
}

/** Build a live analyzer from the user's settings. */
export function createAnalyzer(config: AnalyzerConfig): TopicAnalyzer {
  return config.providerId === 'anthropic'
    ? new AnthropicAnalyzer(config.apiKey, config.model)
    : new OpenAiAnalyzer(config.apiKey, config.model);
}
