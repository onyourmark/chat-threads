/**
 * "I branched this conversation a long time ago. Show me exactly where."
 *
 * When ChatGPT records that a conversation was started by branching out of
 * another one, this puts that fact where it can be acted on: which turn the
 * branch was taken from, what the turn says, and a button that goes there.
 *
 * ## Why it is this small
 *
 * The first version said everything at once — turn number, a full excerpt, the
 * whole source title, and a sentence explaining how the point was worked out.
 * On a real 876-turn conversation that filled a large part of a side panel
 * roughly 400px wide, and the Split workspace underneath was squeezed into
 * almost nothing. Page zoom is no answer: this is its own document and does
 * not shrink with the ChatGPT page.
 *
 * So the default is three short lines — number and button, one clamped line of
 * the turn, one truncated line naming the source — and everything that is
 * explanation rather than action sits behind Details. The button that does the
 * thing the user came for is never behind the disclosure.
 *
 * It renders nothing at all unless a branch was actually found. A conversation
 * that was never branched, a provider that cannot record branching, and a
 * transcript read from the page rather than from provider data all produce
 * silence here rather than a reassuring notice nobody asked for — the
 * difference between those cases is kept in `source.branches.status` for the
 * places that need it.
 */

import { useState } from 'react';
import type { BranchPoint } from '../../model/branch';
import type { Turn } from '../../model/types';
import { preview } from '../../model/conversation';
import type { WorkingState } from '../../operations/working';

interface Props {
  state: WorkingState;
  /** Take the user to this turn. */
  onGoToTurn: (turnId: string) => void;
}

/** ChatGPT's own route for a conversation, which is also the one we parse. */
function conversationUrl(id: string): string {
  return `https://chatgpt.com/c/${encodeURIComponent(id)}`;
}

function turnFor(state: WorkingState, point: BranchPoint): Turn | undefined {
  if (point.turnSequence === undefined) return undefined;
  return state.turns.find((t) => t.sequence === point.turnSequence);
}

export function BranchBanner({ state, onGoToTurn }: Props) {
  const branches = state.source.branches;
  if (branches.status !== 'found' || branches.points.length === 0) return null;

  return (
    <section className="branch-banner" aria-label="Branch points">
      {branches.points.map((point, i) => (
        <BranchRow
          key={`${point.sourceConversationId ?? ''}-${point.turnSequence ?? i}`}
          point={point}
          turn={turnFor(state, point)}
          onGoToTurn={onGoToTurn}
        />
      ))}
    </section>
  );
}

interface RowProps {
  point: BranchPoint;
  turn: Turn | undefined;
  onGoToTurn: (turnId: string) => void;
}

function BranchRow({ point, turn, onGoToTurn }: RowProps) {
  const [showDetails, setShowDetails] = useState(false);

  // The number the turn cards themselves show, so the two agree.
  const displayNumber =
    point.turnSequence !== undefined ? point.turnSequence + 1 : null;
  const canOpenSource =
    point.sourceConversationId !== undefined && !point.sourceConversationOwner;

  return (
    <div className="branch-point">
      <div className="branch-line">
        <strong className="branch-title">
          {displayNumber === null
            ? 'Branched from another chat'
            : `Branch point: Turn ${displayNumber}`}
        </strong>
        {turn && (
          <button
            type="button"
            className="btn small branch-go"
            onClick={() => onGoToTurn(turn.id)}
          >
            Go to branch point
          </button>
        )}
      </div>

      {turn && (
        <p className="branch-excerpt">
          <span className="branch-role">
            {turn.role === 'user' ? 'You' : 'Assistant'}:
          </span>{' '}
          {preview(turn.workingText, 120)}
        </p>
      )}

      <div className="branch-line">
        <span className="branch-source">
          {point.sourceConversationTitle
            ? `Branched from “${point.sourceConversationTitle}”`
            : 'Branched from another conversation'}
        </span>
        <button
          type="button"
          className="btn link branch-details-toggle"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? 'Hide' : 'Details'}
        </button>
      </div>

      {/*
        Explanation, not action. Collapsed by default so a sentence about how
        the point was worked out cannot take permanent space away from the
        workspace below.
      */}
      {showDetails && (
        <div className="branch-details">
          <p className="hint">{point.detail}</p>
          {point.sourceConversationOwner && (
            <p className="hint">
              That conversation belongs to another account, so Chat Threads
              cannot open it for you.
            </p>
          )}
          {canOpenSource && (
            <a
              className="btn link"
              href={conversationUrl(point.sourceConversationId!)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open original conversation
            </a>
          )}
        </div>
      )}
    </div>
  );
}
