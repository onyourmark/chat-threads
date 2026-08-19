/** Helpers for building and inspecting the common conversation model. */

import type {
  Attachment,
  ProviderId,
  Role,
  SourceConversation,
  Turn,
  TurnReference,
} from './types';
import { UNASSIGNED } from './types';

/** What an adapter hands over per turn, before ids and sequencing are added. */
export interface RawTurnInput {
  role: Role;
  text: string;
  providerMessageId?: string;
  parentMessageId?: string;
  timestamp?: string;
  attachments?: Attachment[];
  references?: TurnReference[];
}

/**
 * Build the canonical turn list from an adapter's ordered raw turns.
 *
 * Turns arrive already ordered along the active branch. This assigns Chat
 * Threads ids and sequence numbers and seeds the working copy from the
 * original text — the single place that relationship is established.
 */
export function buildTurns(
  provider: ProviderId,
  conversationId: string | undefined,
  raw: RawTurnInput[],
): Turn[] {
  return raw.map((r, index) => ({
    id: `${provider}-${index}`,
    provider,
    providerMessageId: r.providerMessageId,
    providerConversationId: conversationId,
    sequence: index,
    role: r.role,
    originalText: r.text,
    workingText: r.text,
    timestamp: r.timestamp,
    parentMessageId: r.parentMessageId,
    attachments: r.attachments ?? [],
    references: r.references ?? [],
    included: true,
    assignment: UNASSIGNED,
    edited: false,
    uncertain: false,
    assignmentOverridden: false,
  }));
}

/**
 * Freeze a source conversation so an accidental write throws instead of
 * silently corrupting the record of what the provider said.
 */
export function freezeConversation(c: SourceConversation): SourceConversation {
  c.turns.forEach((t) => {
    Object.freeze(t.attachments);
    t.references.forEach((r) => Object.freeze(r));
    Object.freeze(t.references);
    Object.freeze(t);
  });
  Object.freeze(c.turns);
  Object.freeze(c.retrieval.warnings);
  Object.freeze(c.retrieval);
  return Object.freeze(c);
}

/** A short preview of a turn, for list rows. Never used as the stored text. */
export function preview(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/** Rough word count, for display only. */
export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Format an ISO timestamp for a list row, or return undefined if unusable. */
export function formatTimestamp(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
