/**
 * My Prompts.
 *
 * Only what the user themselves said, in order — usually the fastest way to
 * remember how a long conversation actually developed. Works entirely from
 * the loaded conversation; no model is involved.
 */

import { useState } from 'react';
import type { WorkingState } from '../../operations/working';
import { TurnCard } from './TurnCard';

interface Props {
  state: WorkingState;
}

export function PromptsView({ state }: Props) {
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const prompts = state.turns.filter((t) => t.role === 'user');

  if (prompts.length === 0) {
    return (
      <div className="empty">
        <strong>No prompts in this conversation</strong>
        Chat Threads did not find any turns you wrote.
      </div>
    );
  }

  const toggleReply = (id: string) =>
    setOpenReplies((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <>
      <p className="hint" style={{ marginBottom: 8 }}>
        Everything you said, in order. {prompts.length} of {state.turns.length}{' '}
        turns.
      </p>

      {prompts.map((turn, i) => {
        // The reply is the next assistant turn after this prompt.
        const reply = state.turns.find(
          (t) => t.sequence > turn.sequence && t.role === 'assistant',
        );
        const showing = openReplies[turn.id] === true;

        return (
          <TurnCard
            key={turn.id}
            turn={turn}
            displayNumber={i + 1}
            actions={
              reply ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => toggleReply(turn.id)}
                  aria-expanded={showing}
                >
                  {showing ? 'Hide reply' : 'Show reply'}
                </button>
              ) : null
            }
          >
            {showing && reply && (
              <div className="original">
                <h4>Assistant reply</h4>
                <p className="turn-text">{reply.workingText}</p>
              </div>
            )}
          </TurnCard>
        );
      })}
    </>
  );
}
