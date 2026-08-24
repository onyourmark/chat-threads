/**
 * Split.
 *
 * Create topics, put each turn into one, and optionally ask a model to
 * propose the topics for you. An accepted proposal writes into these same
 * controls — there is no separate AI state — so changing a dropdown always
 * wins over whatever the model said.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { SHARED, UNASSIGNED, type Turn } from '../../model/types';
import {
  addTopic,
  addTurnToTopic,
  clearTopics,
  removeTurnFromTopic,
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
  const branchPoints = useMemo(
    () => branchPointSequences(state.source.branches),
    [state.source.branches],
  );

  /*
    One pass for every topic's count, rather than one pass per topic. With 876
    turns and fifteen topics the difference is thirteen thousand comparisons on
    every render, which is the sort of thing that makes a panel feel slow for
    no visible reason.
  */
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    let shared = 0;
    for (const turn of state.turns) {
      if (!turn.included) continue;
      if (turn.assignment === SHARED) {
        shared += 1;
        continue;
      }
      out.set(turn.assignment, (out.get(turn.assignment) ?? 0) + 1);
      // A turn in two topics counts once in each, which is exactly how many
      // times it will appear in the exported files.
      for (const id of turn.alsoIn) {
        out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
    return { byTopic: out, shared };
  }, [state.turns]);
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
            const count = counts.byTopic.get(topic.id) ?? 0;
            return (
              <div className="topic-card" key={topic.id}>
                <div className="topic-row">
                  <span className="topic-index">{i + 1}</span>
                  <TopicNameInput
                    label={`Name of topic ${i + 1}`}
                    value={topic.name}
                    onCommit={(name) =>
                      onChange(renameTopic(state, topic.id, name))
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
                  {/*
                    Both numbers, because they mean different things and the
                    exported file contains their sum. A topic showing "23" and
                    exporting hundreds of turns is how a bug hides.
                  */}
                  <span>
                    {count} turn{count === 1 ? '' : 's'}
                    {counts.shared > 0 && ` + ${counts.shared} shared`}
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

          {/*
            A turn can belong to more than one topic without belonging to all
            of them. The extra memberships are listed here so they are visible
            and removable — before this existed the only way to say "two of
            these" was Shared, which meant all fifteen.
          */}
          {turn.alsoIn.length > 0 && (
            <div className="assign also-in">
              <span className="also-in-label">Also in</span>
              {turn.alsoIn.map((id) => {
                const topic = state.topics.find((t) => t.id === id);
                if (!topic) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    className="chip"
                    title={`Take this turn out of ${topic.name}`}
                    onClick={() =>
                      onChange(removeTurnFromTopic(state, turn.id, id))
                    }
                  >
                    {topic.name}
                    <span aria-hidden="true"> ×</span>
                    <span className="sr-only">
                      {` — remove from ${topic.name}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {turn.included &&
            turn.assignment !== UNASSIGNED &&
            turn.assignment !== SHARED &&
            addable(state, turn).length > 0 && (
              <div className="assign also-in">
                <label
                  htmlFor={`also-${turn.id}`}
                  style={{ flex: 'none' }}
                  className="also-in-label"
                >
                  Add to
                </label>
                <select
                  id={`also-${turn.id}`}
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    onChange(addTurnToTopic(state, turn.id, e.target.value));
                  }}
                >
                  <option value="">Another topic…</option>
                  {addable(state, turn).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
        </TurnCard>
      ))}
    </>
  );
}

/** Topics this turn is not already in, for the "Add to" list. */
function addable(state: WorkingState, turn: Turn) {
  return state.topics.filter(
    (t) => t.id !== turn.assignment && !turn.alsoIn.includes(t.id),
  );
}

/**
 * A topic name box that stays responsive on a long conversation.
 *
 * Renaming a topic through `onChange` on every keystroke re-renders the whole
 * turn list — 876 cards, each with a fifteen-option dropdown — so typing a
 * word could take seconds to appear. The text lives here while it is being
 * typed and is handed up when the user pauses or leaves the field, which
 * changes nothing about the result and everything about how it feels.
 */
function TopicNameInput({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // Follow the outside world when it changes for another reason — a proposal
  // being applied, or Reset Changes — but never while the user is mid-word.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  const commit = (next: string) => {
    if (next === committed.current) return;
    committed.current = next;
    onCommit(next);
  };

  // A pause counts as finishing: the name updates as you would expect, without
  // a render for every letter.
  useEffect(() => {
    if (draft === committed.current) return;
    const timer = setTimeout(() => commit(draft), 400);
    return () => clearTimeout(timer);
  });

  return (
    <input
      type="text"
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(draft);
      }}
    />
  );
}
