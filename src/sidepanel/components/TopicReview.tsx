/**
 * Topic Review.
 *
 * One topic at a time, showing only the turns it owns, with every turn ticked
 * to begin with. The expected move is "yes, take this whole thread out" with a
 * couple of exceptions, so the default is the common case and unticking is the
 * correction.
 *
 * The ticks live here and nowhere else. They are a transient selection, not
 * saved state: the only thing that survives pressing the button is the
 * ordinary `included` flag that the Clean view already toggles. That is what
 * keeps "removed through a topic" and "excluded by hand" the same thing.
 */

import { useMemo, useState } from 'react';
import type { Topic } from '../../model/types';
import { UNASSIGNED } from '../../model/types';
import {
  setAssignment,
  setIncludedMany,
  turnsAssignedTo,
  type WorkingState,
} from '../../operations/working';
import { preview } from '../../model/conversation';

interface Props {
  state: WorkingState;
  topic: Topic;
  onChange: (next: WorkingState) => void;
  /** Leave the review and go back to the topic list. */
  onClose: () => void;
}

export function TopicReview({ state, topic, onChange, onClose }: Props) {
  const turns = turnsAssignedTo(state, topic.id);

  // Everything starts ticked. Turns that arrive later — because the user moved
  // one in from elsewhere — are treated the same way, hence the "not
  // explicitly unticked" test rather than a set of ticked ids.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const selected = useMemo(
    () => turns.filter((t) => !unticked.has(t.id)),
    [turns, unticked],
  );

  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = () => {
    onChange(
      setIncludedMany(
        state,
        selected.map((t) => t.id),
        false,
      ),
    );
    onClose();
  };

  const otherTopics = state.topics.filter((t) => t.id !== topic.id);

  return (
    <section className="review" aria-label={`Reviewing ${topic.name}`}>
      <div className="row" style={{ marginBottom: 6 }}>
        <button type="button" className="btn small" onClick={onClose}>
          ← Back to topics
        </button>
      </div>

      <h2 className="review-title">{topic.name}</h2>
      <p className="hint" style={{ marginTop: 2 }}>
        {turns.length} turn{turns.length === 1 ? '' : 's'} in this topic.
        Everything is ticked to start with. Untick anything you want to keep.
      </p>

      <p className="hint" style={{ marginTop: 6 }}>
        This removes the selected turns from your reshaped conversation. Your
        original AI conversation is never changed.
      </p>

      {turns.length === 0 ? (
        <div className="empty">
          <strong>Nothing is in this topic yet</strong>
          Assign some turns to it in the topic list, or run Find Topics.
        </div>
      ) : (
        <>
          <div className="row" style={{ margin: '10px 0 8px' }}>
            <button
              type="button"
              className="btn small"
              onClick={() => setUnticked(new Set())}
            >
              Select all
            </button>
            <button
              type="button"
              className="btn small"
              onClick={() => setUnticked(new Set(turns.map((t) => t.id)))}
            >
              Select none
            </button>
          </div>

          <ul className="review-list">
            {turns.map((turn) => {
              const ticked = !unticked.has(turn.id);
              const open = expanded.has(turn.id);
              return (
                <li
                  key={turn.id}
                  className={ticked ? 'review-item selected' : 'review-item'}
                >
                  <label className="review-check">
                    <input
                      type="checkbox"
                      checked={ticked}
                      onChange={() => toggle(turn.id)}
                    />
                    <span className="review-label">
                      <span className="review-meta">
                        {turn.role === 'user' ? 'User' : 'Assistant'} · Turn{' '}
                        {turn.sequence + 1}
                        {!turn.included && ' · already excluded'}
                      </span>
                      <span className="review-text">
                        {open ? turn.workingText : preview(turn.workingText, 140)}
                      </span>
                    </span>
                  </label>

                  <div className="review-actions">
                    <button
                      type="button"
                      className="btn link"
                      onClick={() => toggleExpanded(turn.id)}
                      aria-expanded={open}
                    >
                      {open ? 'Show less' : 'Show full text'}
                    </button>

                    {otherTopics.length > 0 && (
                      <>
                        <label
                          className="sr-only"
                          htmlFor={`move-${turn.id}`}
                        >
                          Move turn {turn.sequence + 1} to another topic
                        </label>
                        <select
                          id={`move-${turn.id}`}
                          className="review-move"
                          value={topic.id}
                          onChange={(e) =>
                            onChange(
                              setAssignment(state, turn.id, e.target.value),
                            )
                          }
                        >
                          <option value={topic.id}>Stays in this topic</option>
                          {otherTopics.map((t) => (
                            <option key={t.id} value={t.id}>
                              Move to: {t.name}
                            </option>
                          ))}
                          <option value={UNASSIGNED}>
                            Move to: Unassigned
                          </option>
                        </select>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="review-footer">
            <span aria-live="polite">
              {selected.length} selected for removal
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn primary"
              onClick={remove}
              disabled={selected.length === 0}
            >
              Remove selected turns
            </button>
          </div>
        </>
      )}
    </section>
  );
}
