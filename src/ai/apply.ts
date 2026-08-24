/**
 * Turning a validated proposal into topics and assignments.
 *
 * The proposal does not become a second, hidden source of truth: applying it
 * writes into exactly the same topic list and per-turn assignments the manual
 * Split view uses, so any later manual change simply overwrites it.
 */

import type { Topic } from '../model/types';
import { SHARED } from '../model/types';
import { BUILT_IN_TOPIC_MODEL_ID } from '../model/default-topic';
import { topicIdFromModelId } from './prompt';
import { setAssignments, setTopics, type WorkingState } from '../operations/working';
import { SHARED_TOPIC, type TopicProposal } from './schema';
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

  const bySequence = new Map(state.turns.map((t) => [t.sequence, t.id]));
  const updates = proposal.assignments.flatMap((a) => {
    const turnId = bySequence.get(a.turn);
    if (!turnId) return [];

    // The model refers to a topic that already existed by a reserved id. If
    // the user has removed that topic since the request went out, there is
    // nothing to assign to, so the turn is left where it was rather than the
    // topic being resurrected behind their back.
    if (a.topic === BUILT_IN_TOPIC_MODEL_ID) {
      if (!builtIn) return [];
      return [{ turnId, assignment: builtIn.id, uncertain: a.uncertain }];
    }
    const keptId = topicIdFromModelId(a.topic);
    if (keptId !== null) {
      const topic = keptById.get(keptId);
      if (!topic) return [];
      return [{ turnId, assignment: topic.id, uncertain: a.uncertain }];
    }

    return [
      {
        turnId,
        assignment: a.topic === SHARED_TOPIC ? SHARED : idFor(a.topic),
        uncertain: a.uncertain,
      },
    ];
  });

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
