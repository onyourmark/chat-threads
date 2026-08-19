/**
 * One conversation turn.
 *
 * Turn text is rendered as React text children, so it reaches the DOM as
 * `textContent` and never as markup. Nothing in a conversation — including a
 * code block containing HTML or a script tag — can execute here.
 */

import { useState } from 'react';
import type { Turn } from '../../model/types';
import { formatTimestamp } from '../../model/conversation';

interface Props {
  turn: Turn;
  /** Shown as "Turn 3"; usually the display index, not the raw sequence. */
  displayNumber: number;
  /** Collapse long text to a few lines until the user expands it. */
  collapsible?: boolean;
  children?: React.ReactNode;
  /** Extra controls rendered under the text. */
  actions?: React.ReactNode;
  /** Badges rendered in the header, after the role. */
  badges?: React.ReactNode;
}

export function TurnCard({
  turn,
  displayNumber,
  collapsible = true,
  children,
  actions,
  badges,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const text = turn.workingText;
  // Only offer "Show more" when there is meaningfully more to show, so short
  // turns do not sprout a useless control.
  const isLong = text.length > 320 || text.split('\n').length > 5;
  const clamped = collapsible && isLong && !expanded;
  const time = formatTimestamp(turn.timestamp);

  return (
    <article
      className={[
        'turn',
        turn.role === 'assistant' ? 'assistant' : 'user',
        turn.included ? '' : 'excluded',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="turn-head">
        <span className="turn-role">
          {turn.role === 'user' ? 'User' : 'Assistant'}
        </span>
        <span className="turn-num">Turn {displayNumber}</span>
        {time && <span>{time}</span>}
        {turn.edited && <span className="badge edited">Edited</span>}
        {!turn.included && <span className="badge excluded">Excluded</span>}
        {badges}
      </header>

      <div className="turn-body">
        <p className={clamped ? 'turn-text clamped' : 'turn-text'}>{text}</p>
        {turn.attachments.length > 0 && (
          <p className="attachments">
            Attached: {turn.attachments.map((a) => a.name).join(', ')}
          </p>
        )}

        {/*
          Files the turn's text points at. The text already carries a readable
          replacement for the provider's private marker; these chips just make
          the same information easier to scan.
        */}
        {turn.references.length > 0 && (
          <ul className="refs" aria-label="Files referenced in this message">
            {turn.references.map((r, i) => (
              <li className="ref-chip" key={`${r.raw}-${i}`}>
                {r.kind === 'file'
                  ? r.name
                    ? `Attached file: ${r.name}`
                    : 'Refers to an attachment'
                  : (r.name ?? 'Refers to a source')}
              </li>
            ))}
          </ul>
        )}
        {collapsible && isLong && (
          <button
            type="button"
            className="btn link"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show full text'}
          </button>
        )}
        {children}
      </div>

      {actions && <div className="turn-actions">{actions}</div>}
    </article>
  );
}
