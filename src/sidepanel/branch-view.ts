/**
 * Turning branch information into something the turn list can render.
 *
 * Kept out of the components because the answer is the same in every view and
 * because "which turns are branch points" is a question worth being able to
 * ask in a test without mounting React.
 */

import type { BranchInfo } from '../model/branch';
import type { Turn } from '../model/types';

/**
 * A request to put a particular turn on screen.
 *
 * `nonce` changes on every request, including a repeat one for the same turn,
 * so pressing "Go to branch point" twice scrolls twice.
 */
export interface TurnFocus {
  turnId: string;
  nonce: number;
}

/** The turn sequences a new chat was branched out of. */
export function branchPointSequences(branches: BranchInfo): Set<number> {
  const out = new Set<number>();
  if (branches.status !== 'found') return out;
  for (const point of branches.points) {
    if (point.turnSequence !== undefined) out.add(point.turnSequence);
  }
  return out;
}

/** The focus value to hand one turn card: a nonce, or null. */
export function focusFor(
  focus: TurnFocus | null,
  turn: Turn,
): number | null {
  return focus && focus.turnId === turn.id ? focus.nonce : null;
}
