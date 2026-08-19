/**
 * Turning a validated proposal into topics and assignments.
 *
 * The proposal does not become a second, hidden source of truth: applying it
 * writes into exactly the same topic list and per-turn assignments the manual
 * Split view uses, so any later manual change simply overwrites it.
 */

import type { Topic } from '../model/types';
import { SHARED } from '../model/types';
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

  const topics: Topic[] = proposal.topics.map((t) => ({
    id: idFor(t.id),
    name: t.name,
    description: t.description,
    fromProposal: true,
  }));

  const bySequence = new Map(state.turns.map((t) => [t.sequence, t.id]));
  const updates = proposal.assignments.flatMap((a) => {
    const turnId = bySequence.get(a.turn);
    if (!turnId) return [];
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
