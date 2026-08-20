/**
 * One Chat Threads session per tab and conversation.
 *
 * Chrome gives a window a single side panel document, which survives tab
 * switches. That is convenient — returning to a tab finds its work still
 * there — but it means the panel cannot keep "the conversation" in one
 * variable: whatever is in that variable would belong to whichever tab the
 * user last looked at.
 *
 * So state is keyed. A session is identified by the tab it was opened in
 * *and* the conversation that tab was showing, because both can change
 * independently: the user can switch tabs, or navigate one tab from one
 * conversation to another. Neither may carry work across.
 *
 * Everything here is pure, so the awkward cases — a slow analysis landing
 * after the user has moved on — are testable without a browser.
 */

import type { ProviderId } from '../model/types';
import type { ActiveTabInfo } from '../model/messages';
import type { WorkingState } from '../operations/working';

export interface Session {
  /** `sessionKey(tabId, provider, conversationId)`. */
  readonly key: string;
  readonly tabId: number;
  readonly provider: ProviderId;
  readonly conversationId: string;
  readonly working: WorkingState;
  /**
   * Bumped whenever the session is reloaded from the provider. Work started
   * against an older epoch is stale and must not be applied — a reload
   * replaces the conversation the analysis was describing.
   */
  readonly epoch: number;
  /** Notes from the most recent accepted proposal, shown in Split. */
  readonly proposalNotes: readonly string[] | null;
}

export type Sessions = ReadonlyMap<string, Session>;

/**
 * Identify a session.
 *
 * The tab id alone is not enough: a tab can be navigated to a different
 * conversation, and that must not inherit the previous one's edits. The
 * conversation id alone is not enough either: the same conversation open in
 * two tabs is two independent pieces of work.
 */
export function sessionKey(
  tabId: number,
  provider: ProviderId,
  conversationId: string,
): string {
  return `${tabId}|${provider}|${conversationId}`;
}

/** What the panel should be showing right now. */
export type PanelTarget =
  /** No access to this tab, so we cannot even tell what it is. */
  | { kind: 'needs-invocation' }
  | { kind: 'unsupported' }
  | { kind: 'no-conversation'; provider: ProviderId }
  /** A session exists for this exact tab and conversation. */
  | { kind: 'session'; key: string }
  /**
   * The tab holds a conversation we could load, but have not. `reason` is
   * `changed-conversation` when this tab had a session for a *different*
   * conversation, which is worth saying out loud rather than silently
   * showing an empty panel.
   */
  | {
      kind: 'offer-load';
      key: string;
      tabId: number;
      reason: 'never-loaded' | 'changed-conversation';
    };

/**
 * Decide what to show, given the active tab and the sessions we hold.
 *
 * Deliberately total and side-effect free: it never loads anything. Loading
 * only ever happens because the user asked for it, which is what stops a tab
 * switch from pulling a conversation into the panel on its own.
 */
export function resolveTarget(
  tab: ActiveTabInfo | null,
  sessions: Sessions,
): PanelTarget {
  if (!tab || tab.tabId === undefined || !tab.url) {
    return { kind: 'needs-invocation' };
  }
  if (!tab.supported || !tab.provider) {
    return { kind: 'unsupported' };
  }
  if (!tab.conversationId) {
    return { kind: 'no-conversation', provider: tab.provider };
  }

  const key = sessionKey(tab.tabId, tab.provider, tab.conversationId);
  if (sessions.has(key)) return { kind: 'session', key };

  // Did this tab have a session for something else? Then the user navigated,
  // and should be told rather than shown a blank slate.
  const hadOther = [...sessions.values()].some((s) => s.tabId === tab.tabId);
  return {
    kind: 'offer-load',
    key,
    tabId: tab.tabId,
    reason: hadOther ? 'changed-conversation' : 'never-loaded',
  };
}

/** Add or replace a session. */
export function putSession(sessions: Sessions, session: Session): Sessions {
  const next = new Map(sessions);
  next.set(session.key, session);
  return next;
}

/**
 * Change one session's working state.
 *
 * Returns the same map when the session is gone, so an update aimed at a
 * closed or discarded session quietly does nothing instead of resurrecting it.
 */
export function updateSession(
  sessions: Sessions,
  key: string,
  change: (working: WorkingState) => WorkingState,
): Sessions {
  const session = sessions.get(key);
  if (!session) return sessions;
  const next = new Map(sessions);
  next.set(key, { ...session, working: change(session.working) });
  return next;
}

/**
 * Apply the result of something that took a while.
 *
 * This is the guard that keeps a slow Find Topics honest. The caller passes
 * the key and epoch captured when the request *started*; if either no longer
 * matches, the answer describes a conversation that is no longer there and is
 * dropped. Without it, a result would land in whatever the panel happened to
 * be showing when the network finally replied.
 */
export function applyToSession(
  sessions: Sessions,
  key: string,
  epoch: number,
  change: (working: WorkingState) => WorkingState,
  notes: readonly string[] | null = null,
): Sessions {
  const session = sessions.get(key);
  if (!session || session.epoch !== epoch) return sessions;

  const next = new Map(sessions);
  next.set(key, {
    ...session,
    working: change(session.working),
    proposalNotes: notes,
  });
  return next;
}

/** Forget every session belonging to a tab, once that tab has gone. */
export function dropTab(sessions: Sessions, tabId: number): Sessions {
  const next = new Map(sessions);
  let changed = false;
  for (const [key, session] of sessions) {
    if (session.tabId === tabId) {
      next.delete(key);
      changed = true;
    }
  }
  return changed ? next : sessions;
}

/** Replace a session's conversation after an explicit reload. */
export function reloadSession(
  sessions: Sessions,
  key: string,
  working: WorkingState,
): Sessions {
  const session = sessions.get(key);
  if (!session) return sessions;
  const next = new Map(sessions);
  next.set(key, {
    ...session,
    working,
    // Anything already in flight against the old epoch is now stale.
    epoch: session.epoch + 1,
    proposalNotes: null,
  });
  return next;
}

/** Set or clear the notes shown beside an accepted proposal. */
export function setProposalNotes(
  sessions: Sessions,
  key: string,
  notes: readonly string[] | null,
): Sessions {
  const session = sessions.get(key);
  if (!session) return sessions;
  const next = new Map(sessions);
  next.set(key, { ...session, proposalNotes: notes });
  return next;
}
