/**
 * One conversation turn.
 *
 * Turn text is rendered as React text children, so it reaches the DOM as
 * `textContent` and never as markup. Nothing in a conversation — including a
 * code block containing HTML or a script tag — can execute here.
 */

import { useEffect, useRef, useState } from 'react';
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
  /** True when a new chat was branched out of this turn. */
  branchPoint?: boolean;
  /**
   * Changes to a new number when the panel is asked to go to this turn.
   *
   * A number rather than a boolean because the user can press "Go to branch
   * point" twice: a boolean would already be true the second time and nothing
   * would happen. Scrolling is done here, by the card that knows where it is,
   * so it works the same in every view and in a conversation of any length —
   * the whole list is rendered, so the turn is always a real element.
   */
  focus?: number | null;
}

export function TurnCard({
  turn,
  displayNumber,
  collapsible = true,
  children,
  actions,
  badges,
  branchPoint = false,
  focus = null,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focus === null) return;
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 2400);
    return () => clearTimeout(timer);
  }, [focus]);
  const text = turn.workingText;
  // Only offer "Show more" when there is meaningfully more to show, so short
  // turns do not sprout a useless control.
  const isLong = text.length > 320 || text.split('\n').length > 5;
  const clamped = collapsible && isLong && !expanded;
  const time = formatTimestamp(turn.timestamp);

  return (
    <article
      ref={ref}
      className={[
        'turn',
        turn.role === 'assistant' ? 'assistant' : 'user',
        turn.included ? '' : 'excluded',
        branchPoint ? 'branch' : '',
        flash ? 'flash' : '',
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
        {branchPoint && (
          <span className="badge branch" title="A new chat was branched from this turn">
            Branch point
          </span>
        )}
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
