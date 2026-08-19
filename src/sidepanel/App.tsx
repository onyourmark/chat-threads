/**
 * The side panel.
 *
 * Holds one working conversation and the current view. The source
 * conversation returned by the adapter is kept frozen inside that working
 * state, so Reset always has something true to go back to.
 */

import { useCallback, useEffect, useState } from 'react';
import { providerLabel } from '../adapters/registry';
import type { AdapterFailure, RetrievalStatus } from '../model/types';
import {
  createWorkingState,
  hasChanges,
  resetAll,
  stats,
  type WorkingState,
} from '../operations/working';
import { getActiveTab, loadConversation, pingContentScript } from './chrome';
import { CleanView } from './components/CleanView';
import { OutputView } from './components/OutputView';
import { PromptsView } from './components/PromptsView';
import { SplitView } from './components/SplitView';

type View = 'prompts' | 'clean' | 'split' | 'output';

type Phase =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  /** On a supported site, but no saved conversation is open. */
  | { kind: 'no-conversation'; provider: string }
  /** Content script has not loaded — usually the page needs a reload. */
  | { kind: 'not-ready' }
  | { kind: 'loading' }
  | { kind: 'failed'; failure: AdapterFailure }
  | { kind: 'ready'; working: WorkingState };

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [view, setView] = useState<View>('prompts');

  const load = useCallback(async () => {
    setPhase({ kind: 'checking' });

    const tab = await getActiveTab();
    if (!tab.supported || tab.tabId === undefined) {
      setPhase({ kind: 'unsupported' });
      return;
    }

    if (!(await pingContentScript(tab.tabId))) {
      setPhase({ kind: 'not-ready' });
      return;
    }

    setPhase({ kind: 'loading' });
    const result = await loadConversation(tab.tabId);

    if (!result.ok) {
      if (result.code === 'no-conversation') {
        setPhase({
          kind: 'no-conversation',
          provider: providerLabel(result.adapter),
        });
        return;
      }
      setPhase({ kind: 'failed', failure: result });
      return;
    }

    setPhase({ kind: 'ready', working: createWorkingState(result.conversation) });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow the user as they move between tabs and conversations.
  useEffect(() => {
    const onActivated = () => void load();
    const onUpdated = (
      _id: number,
      change: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (change.url && tab.active) void load();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [load]);

  const working = phase.kind === 'ready' ? phase.working : null;
  const update = (next: WorkingState) => setPhase({ kind: 'ready', working: next });

  return (
    <div className="app">
      <header className="header">
        <h1>Chat Threads</h1>
        <p className="tagline">Reshape your AI conversations.</p>
        {working && (
          <div className="meta">
            <span className="pill">{providerLabel(working.source.provider)}</span>
            <span className="pill">
              {working.source.turns.length} turns loaded
            </span>
            <RetrievalPill status={working.source.retrieval} />
            {working.source.title && (
              <span className="title">{working.source.title}</span>
            )}
          </div>
        )}
      </header>

      {working && (
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

      <main className="scroll">
        {phase.kind === 'checking' && <p className="empty">Checking this tab…</p>}

        {phase.kind === 'loading' && (
          <p className="empty">Loading the conversation…</p>
        )}

        {phase.kind === 'unsupported' && (
          <div className="empty">
            <strong>Open a ChatGPT or Claude conversation</strong>
            Chat Threads works on chatgpt.com and claude.ai. Open a conversation
            there, then come back to this panel.
          </div>
        )}

        {phase.kind === 'no-conversation' && (
          <div className="empty">
            <strong>No active conversation found</strong>
            You are on {phase.provider}, but this page is not a saved
            conversation yet. Open one from the sidebar, or send a first message
            in a new chat.
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => void load()}>
                Check again
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'not-ready' && (
          <div className="empty">
            <strong>Reload the page to continue</strong>
            Chat Threads was installed or updated after this tab was opened.
            Reload the ChatGPT or Claude tab, then check again.
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => void load()}>
                Check again
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'failed' && <Failure failure={phase.failure} onRetry={load} />}

        {working && (
          <>
            <RetrievalWarnings status={working.source.retrieval} />
            {view === 'prompts' && <PromptsView state={working} />}
            {view === 'clean' && <CleanView state={working} onChange={update} />}
            {view === 'split' && <SplitView state={working} onChange={update} />}
            {view === 'output' && <OutputView state={working} />}
          </>
        )}
      </main>

      {working && (
        <footer className="footer-bar">
          <span>
            {stats(working).included} of {working.turns.length} kept
            {stats(working).edited > 0 && `, ${stats(working).edited} edited`}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            onClick={() => update(resetAll(working))}
            disabled={!hasChanges(working)}
          >
            Reset changes
          </button>
          <button type="button" className="btn small" onClick={() => void load()}>
            Reload
          </button>
        </footer>
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
