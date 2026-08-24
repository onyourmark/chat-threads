/**
 * "I branched this conversation a long time ago. Show me exactly where."
 *
 * When ChatGPT records that a conversation was started by branching out of
 * another one, this puts that fact where it can be acted on: which turn the
 * branch was taken from, what the turn says, and a button that goes there.
 *
 * It renders nothing at all unless a branch was actually found. A conversation
 * that was never branched, a provider that cannot record branching, and a
 * transcript read from the page rather than from provider data all produce
 * silence here rather than a reassuring notice nobody asked for — the
 * difference between those cases is kept in `source.branches.status` for the
 * places that need it.
 */

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

function turnFor(
  state: WorkingState,
  point: BranchPoint,
): Turn | undefined {
  if (point.turnSequence === undefined) return undefined;
  return state.turns.find((t) => t.sequence === point.turnSequence);
}

export function BranchBanner({ state, onGoToTurn }: Props) {
  const branches = state.source.branches;
  if (branches.status !== 'found' || branches.points.length === 0) return null;

  return (
    <section className="branch-banner" aria-label="Branch points">
      {branches.points.map((point, i) => {
        const turn = turnFor(state, point);
        const key = `${point.sourceConversationId ?? ''}-${point.turnSequence ?? i}`;
        // The number the turn cards themselves show, so the two agree.
        const displayNumber =
          point.turnSequence !== undefined ? point.turnSequence + 1 : null;

        return (
          <div className="branch-point" key={key}>
            <div className="row">
              <strong style={{ fontSize: 12 }}>
                {displayNumber === null
                  ? 'Branched from another chat'
                  : `Branch point: Turn ${displayNumber}`}
              </strong>
              <span className="spacer" />
              {turn && (
                <button
                  type="button"
                  className="btn small"
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
                {preview(turn.workingText, 140)}
              </p>
            )}

            <p className="hint">
              {point.sourceConversationTitle
                ? `This chat was branched from “${point.sourceConversationTitle}”.`
                : 'This chat was branched from another conversation.'}{' '}
              {point.confidence !== 'confirmed' && point.detail}
            </p>

            {/*
              Offered only when ChatGPT gave a conversation id and did not say
              the source belongs to someone else. The address is ChatGPT's own
              route for a conversation — the same one Chat Threads reads to
              identify which chat a tab is showing — not a guess.
            */}
            {point.sourceConversationId && !point.sourceConversationOwner && (
              <a
                className="btn link"
                href={conversationUrl(point.sourceConversationId)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open original conversation
              </a>
            )}
          </div>
        );
      })}
    </section>
  );
}
