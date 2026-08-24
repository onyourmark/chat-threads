/**
 * Split.
 *
 * Create topics, put each turn into one, and optionally ask a model to
 * propose the topics for you. An accepted proposal writes into these same
 * controls — there is no separate AI state — so changing a dropdown always
 * wins over whatever the model said.
 */

import { useState } from 'react';
import { SHARED, UNASSIGNED } from '../../model/types';
import {
  addTopic,
  clearTopics,
  countAssignedTo,
  removeTopic,
  renameTopic,
  setAssignment,
  toggleIncluded,
  type WorkingState,
} from '../../operations/working';
import { TurnCard } from './TurnCard';
import {
  branchPointSequences,
  focusFor,
  type TurnFocus,
} from '../branch-view';
import { FindTopics } from './FindTopics';
import { TopicReview } from './TopicReview';
import type { TopicProposal } from '../../ai/schema';

interface Props {
  state: WorkingState;
  onChange: (next: WorkingState) => void;
  /**
   * Notes from the last accepted proposal. Held by the session rather than
   * here, so they survive the user looking at another tab and coming back.
   */
  proposalNotes: readonly string[] | null;
  onProposal: (proposal: TopicProposal) => void;
  onClearNotes: () => void;
  /** The turn the panel has been asked to show, if any. */
  focus?: TurnFocus | null;
}

export function SplitView({
  state,
  onChange,
  proposalNotes,
  onProposal,
  onClearNotes,
  focus = null,
}: Props) {
  const branchPoints = branchPointSequences(state.source.branches);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const hasProposal = state.topics.some((t) => t.fromProposal);
  const builtIn = state.topics.find((t) => t.builtIn);
  const hasBuiltIn = builtIn !== undefined;
  const builtInName = builtIn?.name ?? '';

  // A topic the user removed while reviewing it should not leave the panel
  // stranded in a review of nothing.
  const reviewing = state.topics.find((t) => t.id === reviewingId);

  if (reviewing) {
    return (
      <TopicReview
        state={state}
        topic={reviewing}
        onChange={onChange}
        onClose={() => setReviewingId(null)}
      />
    );
  }

  return (
    <>
      <p className="section-title">Topics</p>

      {state.topics.length > 0 && (
        <div className="topic-list">
          {state.topics.map((topic, i) => {
            const count = countAssignedTo(state, topic.id);
            return (
              <div className="topic-card" key={topic.id}>
                <div className="topic-row">
                  <span className="topic-index">{i + 1}</span>
                  <input
                    type="text"
                    value={topic.name}
                    aria-label={`Name of topic ${i + 1}`}
                    onChange={(e) =>
                      onChange(renameTopic(state, topic.id, e.target.value))
                    }
                  />
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => onChange(removeTopic(state, topic.id))}
                    aria-label={`Remove topic ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
                <div className="topic-meta">
                  <span>
                    {count} turn{count === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={count === 0}
                    onClick={() => setReviewingId(topic.id)}
                  >
                    Review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="hint" style={{ marginBottom: 6 }}>
        Add a topic for each separate discussion you want to pull out, then
        assign the turns below. A turn marked <strong>Shared</strong> goes into
        every topic; one left <strong>Unassigned</strong> goes into none.
        {hasBuiltIn && (
          <>
            {' '}
            <strong>{builtInName}</strong> is here to start with, for turns
            spent arguing with the AI rather than getting work done. Rename it,
            remove it, or leave it empty.
          </>
        )}
      </p>

      <div className="row" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="btn"
          onClick={() => onChange(addTopic(state))}
        >
          Add topic
        </button>
        {state.topics.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              onChange(clearTopics(state));
              onClearNotes();
            }}
          >
            Clear all
          </button>
        )}
      </div>

      <FindTopics state={state} onProposal={onProposal} />

      {hasProposal && (
        <div className="notice">
          <h3>Suggested topics applied</h3>
          <p style={{ margin: 0 }}>
            These are suggestions. Rename a topic, move any turn, or clear them
            all — nothing is generated until you open Output.
          </p>
          {proposalNotes && proposalNotes.length > 0 && (
            <ul>
              {proposalNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="section-title">Turns</p>

      {state.turns.map((turn, i) => (
        <TurnCard
          key={turn.id}
          turn={turn}
          displayNumber={i + 1}
          branchPoint={branchPoints.has(turn.sequence)}
          focus={focusFor(focus, turn)}
          badges={
            <>
              {turn.uncertain && (
                <span className="badge uncertain" title="The model was unsure">
                  Unsure
                </span>
              )}
              {turn.assignmentOverridden && (
                <span className="badge mine">Your choice</span>
              )}
              {!turn.assignmentOverridden &&
                !turn.uncertain &&
                hasProposal &&
                turn.assignment !== UNASSIGNED && (
                  <span className="badge ai">Suggested</span>
                )}
            </>
          }
          actions={
            <button
              type="button"
              className="btn small"
              onClick={() => onChange(toggleIncluded(state, turn.id))}
            >
              {turn.included ? 'Exclude' : 'Include'}
            </button>
          }
        >
          <div className="assign" style={{ padding: '6px 0 0' }}>
            <label htmlFor={`assign-${turn.id}`} style={{ flex: 'none' }}>
              Goes to
            </label>
            <select
              id={`assign-${turn.id}`}
              value={turn.assignment}
              disabled={!turn.included}
              onChange={(e) =>
                onChange(setAssignment(state, turn.id, e.target.value))
              }
            >
              <option value={UNASSIGNED}>Unassigned</option>
              {state.topics.map((t, ti) => (
                <option key={t.id} value={t.id}>
                  {ti + 1}. {t.name}
                </option>
              ))}
              <option value={SHARED}>Shared (every topic)</option>
            </select>
          </div>
        </TurnCard>
      ))}
    </>
  );
}
