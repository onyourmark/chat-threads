/**
 * Session identity and the guards around it.
 *
 * These are the pure half of the tab-binding fix. The panel decides *what to
 * show* with `resolveTarget` and *what to accept* with `applyToSession`, and
 * both are ordinary functions, so the awkward orderings — a result arriving
 * after the user has moved on, a tab navigating mid-request — can be written
 * down exactly rather than approximated with timers.
 */

import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import type { ActiveTabInfo } from '../src/model/messages';
import {
  createWorkingState,
  setIncluded,
  type WorkingState,
} from '../src/operations/working';
import {
  applyToSession,
  dropTab,
  putSession,
  reloadSession,
  resolveTarget,
  sessionKey,
  setProposalNotes,
  updateSession,
  type Session,
  type Sessions,
} from '../src/sidepanel/sessions';
import { chatgptMixedTopics } from './fixtures/chatgpt';
import { chatgptVenting } from './fixtures/chatgpt-venting';

function working(which: 'mixed' | 'venting' = 'mixed'): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(
        which === 'mixed' ? chatgptMixedTopics : chatgptVenting,
        { url: 'https://chatgpt.com/c/x', method: 'test' },
      ),
    ),
  );
}

function session(
  tabId: number,
  conversationId: string,
  which: 'mixed' | 'venting' = 'mixed',
): Session {
  return {
    key: sessionKey(tabId, 'chatgpt', conversationId),
    tabId,
    provider: 'chatgpt',
    conversationId,
    working: working(which),
    epoch: 0,
    proposalNotes: null,
  };
}

function tabInfo(over: Partial<ActiveTabInfo> = {}): ActiveTabInfo {
  return {
    tabId: 1,
    url: 'https://chatgpt.com/c/conv-a',
    provider: 'chatgpt',
    conversationId: 'conv-a',
    supported: true,
    invoked: true,
    contentScriptReady: false,
    ...over,
  };
}

const empty: Sessions = new Map();

describe('session identity', () => {
  it('separates the same conversation open in two tabs', () => {
    expect(sessionKey(1, 'chatgpt', 'conv-a')).not.toBe(
      sessionKey(2, 'chatgpt', 'conv-a'),
    );
  });

  it('separates two conversations in the same tab', () => {
    expect(sessionKey(1, 'chatgpt', 'conv-a')).not.toBe(
      sessionKey(1, 'chatgpt', 'conv-b'),
    );
  });

  it('separates the same ids on different providers', () => {
    expect(sessionKey(1, 'chatgpt', 'x')).not.toBe(sessionKey(1, 'claude', 'x'));
  });

  it('is stable for the same tab, provider and conversation', () => {
    expect(sessionKey(7, 'claude', 'abc')).toBe(sessionKey(7, 'claude', 'abc'));
  });
});

describe('deciding what to show', () => {
  it('asks for an invocation when the tab cannot be read', () => {
    expect(resolveTarget(tabInfo({ url: undefined }), empty).kind).toBe(
      'needs-invocation',
    );
    expect(resolveTarget(null, empty).kind).toBe('needs-invocation');
    expect(resolveTarget(tabInfo({ tabId: undefined }), empty).kind).toBe(
      'needs-invocation',
    );
  });

  it('reports an unsupported site', () => {
    const target = resolveTarget(
      tabInfo({ url: 'https://example.com/', supported: false, provider: undefined }),
      empty,
    );
    expect(target.kind).toBe('unsupported');
  });

  it('reports a provider page that is not a conversation', () => {
    const target = resolveTarget(
      tabInfo({ url: 'https://chatgpt.com/', conversationId: undefined }),
      empty,
    );
    expect(target).toEqual({ kind: 'no-conversation', provider: 'chatgpt' });
  });

  it('shows the session belonging to this tab and conversation', () => {
    const a = session(1, 'conv-a');
    const target = resolveTarget(tabInfo(), putSession(empty, a));

    expect(target).toEqual({ kind: 'session', key: a.key });
  });

  it('offers to load a conversation it has never seen', () => {
    const target = resolveTarget(tabInfo(), empty);

    expect(target.kind).toBe('offer-load');
    if (target.kind !== 'offer-load') return;
    expect(target.reason).toBe('never-loaded');
  });

  it('never shows another tab session for this tab', () => {
    // Tab 2 holds a session; the active tab is 1. Tab 1 must not inherit it.
    const other = session(2, 'conv-b');
    const target = resolveTarget(tabInfo({ tabId: 1 }), putSession(empty, other));

    expect(target.kind).toBe('offer-load');
    if (target.kind !== 'offer-load') return;
    expect(target.reason).toBe('never-loaded');
    expect(target.key).not.toBe(other.key);
  });

  it('says so when the tab has moved to a different conversation', () => {
    const a = session(1, 'conv-a');
    const target = resolveTarget(
      tabInfo({ conversationId: 'conv-b', url: 'https://chatgpt.com/c/conv-b' }),
      putSession(empty, a),
    );

    expect(target.kind).toBe('offer-load');
    if (target.kind !== 'offer-load') return;
    expect(target.reason).toBe('changed-conversation');
  });

  it('finds the original session again when the tab goes back', () => {
    const a = session(1, 'conv-a');
    const sessions = putSession(empty, a);

    // A -> B -> A within one tab.
    expect(
      resolveTarget(tabInfo({ conversationId: 'conv-b' }), sessions).kind,
    ).toBe('offer-load');
    expect(resolveTarget(tabInfo({ conversationId: 'conv-a' }), sessions)).toEqual(
      { kind: 'session', key: a.key },
    );
  });
});

describe('sessions do not leak into each other', () => {
  it('changing one leaves the other untouched', () => {
    const a = session(1, 'conv-a');
    const b = session(2, 'conv-b', 'venting');
    let sessions = putSession(putSession(empty, a), b);

    sessions = updateSession(sessions, a.key, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    expect(sessions.get(a.key)?.working.turns[0]?.included).toBe(false);
    expect(sessions.get(b.key)?.working.turns[0]?.included).toBe(true);
    // And B is the very same object it was.
    expect(sessions.get(b.key)).toBe(b);
  });

  it('holds different conversations for different tabs', () => {
    const a = session(1, 'conv-a', 'mixed');
    const b = session(2, 'conv-b', 'venting');
    const sessions = putSession(putSession(empty, a), b);

    expect(sessions.get(a.key)?.working.turns).toHaveLength(8);
    expect(sessions.get(b.key)?.working.turns).toHaveLength(11);
  });

  it('ignores an update aimed at a session that is gone', () => {
    const sessions = putSession(empty, session(1, 'conv-a'));
    const after = updateSession(sessions, 'no-such-key', (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    expect(after).toBe(sessions);
  });

  it('forgets a tab that has closed, and only that tab', () => {
    const a = session(1, 'conv-a');
    const b = session(2, 'conv-b');
    const also = session(1, 'conv-c');
    const sessions = putSession(putSession(putSession(empty, a), b), also);

    const after = dropTab(sessions, 1);
    expect(after.has(a.key)).toBe(false);
    expect(after.has(also.key)).toBe(false);
    expect(after.has(b.key)).toBe(true);
  });

  it('returns the same map when a closed tab had nothing', () => {
    const sessions = putSession(empty, session(1, 'conv-a'));
    expect(dropTab(sessions, 99)).toBe(sessions);
  });
});

describe('a slow result cannot land in the wrong place', () => {
  it('applies to the session that asked, whatever is on screen now', () => {
    const a = session(1, 'conv-a');
    const b = session(2, 'conv-b');
    const sessions = putSession(putSession(empty, a), b);

    // The request started in A. By the time it returns the user is on B.
    const after = applyToSession(sessions, a.key, 0, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    expect(after.get(a.key)?.working.turns[0]?.included).toBe(false);
    expect(after.get(b.key)?.working.turns[0]?.included).toBe(true);
    expect(after.get(b.key)).toBe(b);
  });

  it('drops a result whose session has gone', () => {
    // The tab was closed while the request was in flight.
    const a = session(1, 'conv-a');
    const sessions = dropTab(putSession(empty, a), 1);

    const after = applyToSession(sessions, a.key, 0, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );
    expect(after).toBe(sessions);
    expect(after.has(a.key)).toBe(false);
  });

  it('drops a result from before a reload', () => {
    const a = session(1, 'conv-a');
    let sessions = putSession(empty, a);

    // The user pressed Reload while the analysis was running.
    sessions = reloadSession(sessions, a.key, working());
    expect(sessions.get(a.key)?.epoch).toBe(1);

    const after = applyToSession(sessions, a.key, 0, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    expect(after).toBe(sessions);
    expect(after.get(a.key)?.working.turns[0]?.included).toBe(true);
  });

  it('accepts a result that is still current', () => {
    const a = session(1, 'conv-a');
    const sessions = putSession(empty, a);

    const after = applyToSession(
      sessions,
      a.key,
      0,
      (w) => setIncluded(w, 'chatgpt-0', false),
      ['a note'],
    );

    expect(after.get(a.key)?.working.turns[0]?.included).toBe(false);
    expect(after.get(a.key)?.proposalNotes).toEqual(['a note']);
  });

  it('applies to the live state, not a stale copy', () => {
    // The user kept editing while the request was in flight; those edits must
    // survive the result landing.
    const a = session(1, 'conv-a');
    let sessions = putSession(empty, a);
    sessions = updateSession(sessions, a.key, (w) =>
      setIncluded(w, 'chatgpt-7', false),
    );

    sessions = applyToSession(sessions, a.key, 0, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    expect(sessions.get(a.key)?.working.turns[7]?.included).toBe(false);
    expect(sessions.get(a.key)?.working.turns[0]?.included).toBe(false);
  });

  it('cannot be aimed at a different conversation by key alone', () => {
    // Two conversations in the same tab. A result for A must not touch B even
    // though the tab id matches.
    const a = session(1, 'conv-a');
    const b = session(1, 'conv-b');
    const sessions = putSession(putSession(empty, a), b);

    const after = applyToSession(sessions, a.key, 0, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    expect(after.get(b.key)).toBe(b);
  });
});

describe('reload and notes', () => {
  it('replaces the conversation and bumps the epoch', () => {
    const a = session(1, 'conv-a');
    let sessions = putSession(empty, a);
    sessions = updateSession(sessions, a.key, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    sessions = reloadSession(sessions, a.key, working());

    expect(sessions.get(a.key)?.working.turns[0]?.included).toBe(true);
    expect(sessions.get(a.key)?.epoch).toBe(1);
    expect(sessions.get(a.key)?.proposalNotes).toBeNull();
  });

  it('reloads only the session asked for', () => {
    const a = session(1, 'conv-a');
    const b = session(2, 'conv-b');
    let sessions = putSession(putSession(empty, a), b);
    sessions = updateSession(sessions, b.key, (w) =>
      setIncluded(w, 'chatgpt-0', false),
    );

    sessions = reloadSession(sessions, a.key, working());

    expect(sessions.get(b.key)?.working.turns[0]?.included).toBe(false);
    expect(sessions.get(b.key)?.epoch).toBe(0);
  });

  it('ignores a reload for a session that is gone', () => {
    const sessions = putSession(empty, session(1, 'conv-a'));
    expect(reloadSession(sessions, 'gone', working())).toBe(sessions);
  });

  it('sets and clears notes on one session only', () => {
    const a = session(1, 'conv-a');
    const b = session(2, 'conv-b');
    let sessions = putSession(putSession(empty, a), b);

    sessions = setProposalNotes(sessions, a.key, ['note']);
    expect(sessions.get(a.key)?.proposalNotes).toEqual(['note']);
    expect(sessions.get(b.key)?.proposalNotes).toBeNull();

    sessions = setProposalNotes(sessions, a.key, null);
    expect(sessions.get(a.key)?.proposalNotes).toBeNull();
  });
});
