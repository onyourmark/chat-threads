/**
 * Clean.
 *
 * The whole conversation with an include/exclude switch and an editor for
 * each turn. Every control here changes only Chat Threads' working copy — the
 * conversation on ChatGPT or Claude is never touched, and the panel says so.
 */

import { useState } from 'react';
import type { Turn } from '../../model/types';
import {
  restoreOriginalText,
  setWorkingText,
  toggleIncluded,
  type WorkingState,
} from '../../operations/working';
import { TurnCard } from './TurnCard';

interface Props {
  state: WorkingState;
  onChange: (next: WorkingState) => void;
}

export function CleanView({ state, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showOriginalId, setShowOriginalId] = useState<string | null>(null);

  const startEdit = (turn: Turn) => {
    setEditingId(turn.id);
    setDraft(turn.workingText);
  };

  const commit = (turn: Turn) => {
    onChange(setWorkingText(state, turn.id, draft));
    setEditingId(null);
  };

  const included = state.turns.filter((t) => t.included).length;

  return (
    <>
      <p className="hint" style={{ marginBottom: 8 }}>
        {included} of {state.turns.length} turns will be included. Excluding or
        editing here changes only your copy — the original conversation is left
        exactly as it is.
      </p>

      {state.turns.map((turn, i) => {
        const editing = editingId === turn.id;
        const showingOriginal = showOriginalId === turn.id;

        return (
          <TurnCard
            key={turn.id}
            turn={turn}
            displayNumber={i + 1}
            collapsible={!editing}
            actions={
              <>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => onChange(toggleIncluded(state, turn.id))}
                  aria-pressed={!turn.included}
                >
                  {turn.included ? 'Exclude' : 'Include'}
                </button>

                {editing ? (
                  <>
                    <button
                      type="button"
                      className="btn small primary"
                      onClick={() => commit(turn)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => startEdit(turn)}
                  >
                    Edit
                  </button>
                )}

                {turn.edited && !editing && (
                  <>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        onChange(restoreOriginalText(state, turn.id))
                      }
                    >
                      Restore original
                    </button>
                    <button
                      type="button"
                      className="btn link"
                      onClick={() =>
                        setShowOriginalId(showingOriginal ? null : turn.id)
                      }
                      aria-expanded={showingOriginal}
                    >
                      {showingOriginal ? 'Hide original' : 'Compare'}
                    </button>
                  </>
                )}
              </>
            }
          >
            {editing && (
              <>
                <label
                  className="section-title"
                  htmlFor={`edit-${turn.id}`}
                  style={{ display: 'block', marginTop: 6 }}
                >
                  Working copy
                </label>
                <textarea
                  id={`edit-${turn.id}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                />
              </>
            )}

            {showingOriginal && !editing && (
              <div className="original">
                <h4>Original, as it appears in the conversation</h4>
                <p className="turn-text">{turn.originalText}</p>
              </div>
            )}
          </TurnCard>
        );
      })}
    </>
  );
}
