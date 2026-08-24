/**
 * The side panel.
 *
 * Chrome gives a window one side panel document, shared by every tab in it.
 * The panel therefore cannot hold "the conversation" in a single variable —
 * that variable would belong to whichever tab was looked at last, and
 * switching tabs would silently hand one conversation's edits to another.
 *
 * Instead it keeps a session per tab-and-conversation (see `sessions.ts`) and
 * only ever *displays* the one belonging to the active tab. Loading is never a
 * side effect of switching tabs: it happens when the user clicks the toolbar
 * icon, or presses a button that says it will.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providerLabel } from '../adapters/registry';
import type { AdapterFailure, RetrievalStatus } from '../model/types';
import type { ActiveTabInfo } from '../model/messages';
import type { TopicProposal } from '../ai/schema';
import { applyProposal } from '../ai/apply';
import {
  createWorkingState,
  hasChanges,
  resetAll,
  stats,
  type WorkingState,
} from '../operations/working';
import {
  applyToSession,
  dropTab,
  putSession,
  reloadSession,
  resolveTarget,
  sessionKey,
  setProposalNotes,
  updateSession,
  type Sessions,
} from './sessions';
import {
  ensureContentScript,
  getActiveTab,
  hasProviderAccess,
  loadConversation,
  requestProviderAccess,
} from './chrome';
import { CleanView } from './components/CleanView';
import { OutputView } from './components/OutputView';
import { PromptsView } from './components/PromptsView';
import { SplitView } from './components/SplitView';
import { BranchBanner } from './components/BranchBanner';
import type { TurnFocus } from './branch-view';

type View = 'prompts' | 'clean' | 'split' | 'output';

/** Transient states that are about the panel, not about a session. */
type Busy =
  | { kind: 'checking' }
  | { kind: 'idle' }
  | { kind: 'loading'; key: string }
  | { kind: 'failed'; key: string; failure: AdapterFailure }
  /** The tab would not accept the reader script; the grant has lapsed. */
  | { kind: 'not-ready'; key: string };

export function App() {
  const [tab, setTab] = useState<ActiveTabInfo | null>(null);
  const [sessions, setSessions] = useState<Sessions>(() => new Map());
  const [busy, setBusy] = useState<Busy>({ kind: 'checking' });
  const [view, setView] = useState<View>('prompts');
  /**
   * The turn the panel has been asked to scroll to, and a nonce so that asking
   * for the same turn twice scrolls twice.
   */
  const [focus, setFocus] = useState<TurnFocus | null>(null);

  /**
   * The invocation we have already acted on. A click on the toolbar icon moves
   * the timestamp forward; anything else must not cause a load.
   */
  const handledInvocation = useRef(0);

  const refreshTab = useCallback(async (): Promise<ActiveTabInfo> => {
    const info = await getActiveTab();
    setTab(info);
    return info;
  }, []);

  /**
   * Retrieve the conversation in a tab and give it a session.
   *
   * Only ever called for an explicit user action. `existingKey` is set when
   * the user asked to reload a session they already had, which bumps the
   * session's epoch so anything already in flight is discarded.
   */
  const load = useCallback(
    async (info: ActiveTabInfo, options: { reload?: boolean } = {}) => {
      if (
        info.tabId === undefined ||
        !info.provider ||
        !info.conversationId ||
        !info.supported
      ) {
        setBusy({ kind: 'idle' });
        return;
      }

      const key = sessionKey(info.tabId, info.provider, info.conversationId);
      setBusy({ kind: 'loading', key });

      if (!(await ensureContentScript(info.tabId))) {
        setBusy({ kind: 'not-ready', key });
        return;
      }

      const result = await loadConversation(info.tabId);
      if (!result.ok) {
        setBusy({ kind: 'failed', key, failure: result });
        return;
      }

      const working = createWorkingState(result.conversation);
      setSessions((prev) =>
        options.reload && prev.has(key)
          ? reloadSession(prev, key, working)
          : putSession(prev, {
              key,
              tabId: info.tabId as number,
              provider: info.provider!,
              conversationId: info.conversationId as string,
              working,
              epoch: 0,
              proposalNotes: null,
            }),
      );
      setBusy({ kind: 'idle' });
    },
    [],
  );

  /** Look at the active tab, and load only if the user just invoked us. */
  const check = useCallback(async () => {
    const info = await refreshTab();
    if (info.invokedAt && info.invokedAt > handledInvocation.current) {
      handledInvocation.current = info.invokedAt;
      await load(info);
      return;
    }
    setBusy({ kind: 'idle' });
  }, [refreshTab, load]);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * Watch the tabs, but only to keep track of *which* tab is in front.
   *
   * Deliberately no loading here. This is the bug that made switching tabs
   * appear to move a conversation: reacting to a tab switch by loading meant
   * the panel replaced whatever it was holding.
   */
  useEffect(() => {
    const onActivated = () => void refreshTab();
    const onUpdated = (_tabId: number, change: chrome.tabs.TabChangeInfo) => {
      // A navigation changes which conversation a tab holds, so re-read it —
      // but still do not load anything. `status` needs no permission, and
      // `url` only arrives for tabs we already have access to.
      if (change.url || change.status === 'complete') void refreshTab();
    };
    const onRemoved = (tabId: number) =>
      setSessions((prev) => dropTab(prev, tabId));

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [refreshTab]);

  /**
   * The toolbar icon is the explicit invocation, and the background records it
   * in session storage. Noticing the change is how a click reaches a panel
   * that is already open.
   */
  useEffect(() => {
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'session' || !changes['chatThreads.invokedTab']) return;
      void check();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [check]);

  const target = useMemo(() => resolveTarget(tab, sessions), [tab, sessions]);
  const session =
    target.kind === 'session' ? (sessions.get(target.key) ?? null) : null;

  /** Edit the session being displayed. Bound to its key, not to "current". */
  const changeSession = useCallback(
    (key: string, next: WorkingState) =>
      setSessions((prev) => updateSession(prev, key, () => next)),
    [],
  );

  /**
   * Apply a proposal that may have taken a long time to arrive.
   *
   * The key and epoch are the ones captured when the request started, so a
   * result cannot land in a conversation the user has since moved to, nor in
   * one that has been reloaded out from under it.
   */
  const acceptProposal = useCallback(
    (key: string, epoch: number, proposal: TopicProposal) =>
      setSessions((prev) =>
        applyToSession(
          prev,
          key,
          epoch,
          (working) => applyProposal(working, proposal),
          proposal.notes,
        ),
      ),
    [],
  );

  /**
   * Show one turn.
   *
   * Switches to Clean first, because that is the only view that shows every
   * turn in order — Prompts hides assistant replies, and a branch point can be
   * either role. The scrolling itself is done by the turn card.
   */
  const goToTurn = useCallback((turnId: string) => {
    setView('clean');
    setFocus((prev) => ({ turnId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  const busyForTarget =
    busy.kind !== 'idle' &&
    busy.kind !== 'checking' &&
    'key' in busy &&
    target.kind !== 'session' &&
    'key' in target &&
    busy.key === target.key
      ? busy
      : null;

  return (
    <div className="app">
      <header className="header">
        <h1>Chat Threads</h1>
        <p className="tagline">Reshape your AI conversations.</p>
        {session && (
          <div className="meta">
            <span className="pill">
              {providerLabel(session.working.source.provider)}
            </span>
            <span className="pill">
              {session.working.source.turns.length} turns loaded
            </span>
            <RetrievalPill status={session.working.source.retrieval} />
            {session.working.source.title && (
              <span className="title">{session.working.source.title}</span>
            )}
          </div>
        )}
      </header>

      {session && (
        <nav className="tabs" role="tablist" aria-label="Chat Threads views">
          {(
            [
              ['prompts', 'Prompts'],
              ['clean', 'Clean'],
              ['split', 'Split'],
              ['output', 'Output'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {session && (
        <BranchBanner state={session.working} onGoToTurn={goToTurn} />
      )}

      <main className="scroll">
        {busy.kind === 'checking' && <p className="empty">Checking this tab…</p>}

        {busy.kind === 'loading' && (
          <p className="empty">Loading the conversation…</p>
        )}

        {busy.kind !== 'loading' && busy.kind !== 'checking' && (
          <>
            {target.kind === 'needs-invocation' && (
              <NeedsInvocation onRetry={() => void check()} />
            )}

            {target.kind === 'unsupported' && (
              <div className="empty">
                <strong>Open a ChatGPT or Claude conversation</strong>
                Chat Threads works on chatgpt.com and claude.ai. Open a
                conversation there, then click the Chat Threads icon.
              </div>
            )}

            {target.kind === 'no-conversation' && (
              <div className="empty">
                <strong>No active conversation found</strong>
                You are on {providerLabel(target.provider)}, but this page is
                not a saved conversation yet. Open one from the sidebar, or send
                a first message in a new chat.
                <div
                  className="row"
                  style={{ justifyContent: 'center', marginTop: 12 }}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void check()}
                  >
                    Check again
                  </button>
                </div>
              </div>
            )}

            {target.kind === 'offer-load' && busyForTarget?.kind === 'failed' && (
              <Failure
                failure={busyForTarget.failure}
                onRetry={() => void refreshTab().then((i) => load(i))}
              />
            )}

            {target.kind === 'offer-load' &&
              busyForTarget?.kind === 'not-ready' && (
                <div className="empty">
                  <strong>Click the Chat Threads icon again</strong>
                  Permission to read this tab lapsed, which normally happens
                  when the page was reloaded. Click the Chat Threads icon in the
                  toolbar to give it access again.
                  <div
                    className="row"
                    style={{ justifyContent: 'center', marginTop: 12 }}
                  >
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void check()}
                    >
                      Check again
                    </button>
                  </div>
                </div>
              )}

            {target.kind === 'offer-load' && !busyForTarget && (
              <OfferLoad
                reason={target.reason}
                onLoad={() => void refreshTab().then((i) => load(i))}
              />
            )}
          </>
        )}

        {session && (
          <>
            <RetrievalWarnings status={session.working.source.retrieval} />
            {view === 'prompts' && <PromptsView state={session.working} />}
            {view === 'clean' && (
              <CleanView
                state={session.working}
                onChange={(next) => changeSession(session.key, next)}
                focus={focus}
              />
            )}
            {view === 'split' && (
              <SplitView
                state={session.working}
                proposalNotes={session.proposalNotes}
                onChange={(next) => changeSession(session.key, next)}
                onProposal={(proposal) =>
                  acceptProposal(session.key, session.epoch, proposal)
                }
                onClearNotes={() =>
                  setSessions((prev) =>
                    setProposalNotes(prev, session.key, null),
                  )
                }
                focus={focus}
              />
            )}
            {view === 'output' && <OutputView state={session.working} />}
          </>
        )}
      </main>

      {session && (
        <footer className="footer-bar">
          <span>
            {stats(session.working).included} of {session.working.turns.length}{' '}
            kept
            {stats(session.working).edited > 0 &&
              `, ${stats(session.working).edited} edited`}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            onClick={() =>
              changeSession(session.key, resetAll(session.working))
            }
            disabled={!hasChanges(session.working)}
          >
            Reset changes
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void refreshTab().then((i) => load(i, { reload: true }))
            }
          >
            Reload
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * This tab holds a conversation we could load, and have not.
 *
 * Loading is a button rather than something that happens on arrival, so that
 * moving between tabs never pulls a conversation into the panel by itself.
 */
function OfferLoad({
  reason,
  onLoad,
}: {
  reason: 'never-loaded' | 'changed-conversation';
  onLoad: () => void;
}) {
  return (
    <div className="empty">
      <strong>
        {reason === 'changed-conversation'
          ? 'This tab is now showing a different conversation'
          : 'Ready when you are'}
      </strong>
      {reason === 'changed-conversation'
        ? 'Your work on the previous conversation is kept separately and is not carried over.'
        : 'Chat Threads has not loaded this conversation yet.'}
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        <button type="button" className="btn primary" onClick={onLoad}>
          Open Chat Threads for this conversation
        </button>
      </div>
    </div>
  );
}

/**
 * The resting state: Chat Threads has no access to this tab and is saying so.
 *
 * It also offers the standing-permission upgrade, because a user who works
 * this way constantly should be able to stop clicking the icon — but that has
 * to be their explicit choice, not the default.
 */
function NeedsInvocation({ onRetry }: { onRetry: () => void }) {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    void hasProviderAccess().then(setGranted);
  }, []);

  return (
    <div className="empty">
      <strong>Click the Chat Threads icon to begin</strong>
      Open a ChatGPT or Claude conversation, then click the Chat Threads icon
      in the toolbar. Chat Threads can only read a page you have pointed it at.
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        <button type="button" className="btn" onClick={onRetry}>
          Check again
        </button>
      </div>
      {!granted && (
        <p className="hint" style={{ marginTop: 16 }}>
          Tired of clicking?{' '}
          <button
            type="button"
            className="btn link"
            onClick={() => {
              void requestProviderAccess().then((ok) => {
                setGranted(ok);
                if (ok) onRetry();
              });
            }}
          >
            Allow Chat Threads to read chatgpt.com and claude.ai
          </button>{' '}
          and it will load conversations without being asked each time. You can
          take this back at any time from Chrome&rsquo;s extension settings.
        </p>
      )}
    </div>
  );
}

function RetrievalPill({ status }: { status: RetrievalStatus }) {
  if (status.completeness === 'complete') {
    return <span className="pill ok">Complete</span>;
  }
  return (
    <span className="pill warn">
      {status.completeness === 'partial' ? 'Incomplete' : 'Unconfirmed'}
    </span>
  );
}

/**
 * Retrieval problems are stated plainly rather than hidden, so a partial
 * transcript is never mistaken for the whole conversation.
 */
function RetrievalWarnings({ status }: { status: RetrievalStatus }) {
  if (status.completeness === 'complete' && status.warnings.length === 0) {
    return null;
  }
  return (
    <div className="notice warn">
      <h3>
        {status.completeness === 'partial'
          ? 'Conversation retrieval may be incomplete'
          : 'Chat Threads could not confirm this is the whole conversation'}
      </h3>
      <p style={{ margin: 0 }}>{status.detail}</p>
      {status.warnings.length > 0 && (
        <ul>
          {status.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Failure({
  failure,
  onRetry,
}: {
  failure: AdapterFailure;
  onRetry: () => void;
}) {
  const diagnostics = Object.entries(failure.diagnostics ?? {});
  return (
    <div className="notice error" role="alert">
      <h3>Chat Threads could not retrieve this conversation</h3>
      <p style={{ margin: '0 0 6px' }}>{failure.message}</p>
      {failure.code === 'not-authenticated' && (
        <p style={{ margin: '0 0 6px' }}>
          Reload the page, make sure you are signed in, then try again.
        </p>
      )}
      {failure.code === 'provider-format-changed' && (
        <p style={{ margin: '0 0 6px' }}>
          {providerLabel(failure.adapter)} appears to have changed how it stores
          conversations. The details below identify which part of Chat Threads
          needs updating.
        </p>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      </div>
      {diagnostics.length > 0 && (
        <ul>
          <li>Adapter: {failure.adapter}</li>
          <li>Reason: {failure.code}</li>
          {diagnostics.map(([k, v]) => (
            <li key={k}>
              {k}: {String(v)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
