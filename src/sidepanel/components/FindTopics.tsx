/**
 * Find Topics — the optional AI step.
 *
 * Nothing in this component runs on its own. The conversation is only sent
 * after the user has entered a key, read what will be sent and to whom, and
 * pressed the button. Everything else in Chat Threads works with this section
 * left untouched.
 *
 * A long conversation cannot go out in one request, so it is sent in sections
 * (see `ai/plan.ts`). That is planned before anything is sent, which is what
 * lets this panel say how many requests the user is about to authorise rather
 * than discovering it as they go — and what lets the button stay honest when a
 * conversation is too long to analyse at all.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createAnalyzer } from '../../ai/apply';
import type { TopicProposal } from '../../ai/schema';
import { buildAnalysisInput, payloadSize } from '../../ai/prompt';
import { planAnalysis } from '../../ai/plan';
import {
  DEFAULT_MODELS,
  PROVIDER_ORIGINS,
  type AnalysisProgress,
  type AnalyzerConfig,
} from '../../ai/types';
import type { WorkingState } from '../../operations/working';
import {
  clearApiKey,
  ensureHostPermission,
  loadApiKey,
  loadPrefs,
  savePrefs,
  saveApiKey,
  type AiPrefs,
  DEFAULT_PREFS,
} from '../settings';

interface Props {
  state: WorkingState;
  /**
   * Hand back the validated proposal rather than an updated conversation.
   *
   * The request can outlive the screen that started it — the user may switch
   * tabs while it runs — so applying it here, to the conversation captured in
   * this closure, would write an answer about one conversation into whichever
   * one happened to be on display when the network replied. The panel owns
   * that decision and knows which session asked.
   */
  onProposal: (proposal: TopicProposal) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; progress: AnalysisProgress | null }
  | { kind: 'cancelled' }
  | { kind: 'error'; errors: string[] }
  | { kind: 'done'; topics: number };

/**
 * What the panel says it is doing.
 *
 * Plain words on purpose: a person watching this should be able to tell that
 * it is moving and roughly how far along it is, without being told anything
 * about how the work is divided up internally.
 */
function progressText(progress: AnalysisProgress | null): string {
  if (!progress) return 'Finding topics…';
  switch (progress.phase) {
    case 'single':
      return 'Finding topics: asking the model…';
    case 'discover':
      return `Finding topics: reading section ${progress.section} of ${progress.sections}…`;
    case 'merge':
      return 'Finding topics: reconciling topics across the conversation…';
    case 'classify':
      return `Finding topics: sorting section ${progress.section} of ${progress.sections}…`;
  }
}

export function FindTopics({ state, onProposal }: Props) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<AiPrefs>(DEFAULT_PREFS);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  /**
   * Held in a ref rather than state so that pressing Stop reaches the run in
   * flight. Deliberately not aborted when this component unmounts: switching
   * tabs while an analysis runs must not cancel it, and the result is still
   * applied to the conversation it was started on.
   */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void loadApiKey().then(setApiKey);
  }, []);

  const updatePrefs = (next: AiPrefs) => {
    setPrefs(next);
    void savePrefs(next);
  };

  const { input, plan } = useMemo(() => {
    const built = buildAnalysisInput(state);
    return { input: built, plan: planAnalysis(built) };
  }, [state]);
  const characters = payloadSize(input);
  const providerOrigin = PROVIDER_ORIGINS[prefs.providerId];

  const run = async () => {
    if (!apiKey.trim()) {
      setStatus({ kind: 'error', errors: ['Enter an API key first.'] });
      return;
    }
    setStatus({ kind: 'working', progress: null });

    // Asked for here, inside the click, because Chrome only grants optional
    // permissions during a user gesture.
    const granted = await ensureHostPermission(providerOrigin);
    if (!granted) {
      setStatus({
        kind: 'error',
        errors: [
          `Chat Threads needs your permission to contact ${providerOrigin} before it can do this.`,
        ],
      });
      return;
    }

    await saveApiKey(apiKey.trim(), prefs.rememberKey);

    const config: AnalyzerConfig = {
      providerId: prefs.providerId,
      apiKey: apiKey.trim(),
      model: prefs.model,
    };

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await createAnalyzer(config).analyze(input, {
      signal: controller.signal,
      onProgress: (progress) => setStatus({ kind: 'working', progress }),
    });
    abortRef.current = null;

    if (!result.ok) {
      setStatus(
        controller.signal.aborted
          ? { kind: 'cancelled' }
          : { kind: 'error', errors: result.errors },
      );
      return;
    }

    onProposal(result.proposal);
    setStatus({ kind: 'done', topics: result.proposal.topics.length });
  };

  const working = status.kind === 'working';

  return (
    <section className="notice" style={{ marginBottom: 10 }}>
      <div className="row">
        <strong style={{ fontSize: 12 }}>Find Topics</strong>
        <span className="spacer" />
        <button
          type="button"
          className="btn small"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Set up'}
        </button>
      </div>

      <p className="hint" style={{ marginTop: 4 }}>
        Optional. Asks a model you choose to suggest the topics in this
        conversation. Everything else in Chat Threads works without it.
      </p>

      {open && (
        <div style={{ marginTop: 8 }}>
          <label htmlFor="ai-provider">Model provider</label>
          <select
            id="ai-provider"
            value={prefs.providerId}
            onChange={(e) => {
              const providerId = e.target.value as AiPrefs['providerId'];
              updatePrefs({
                ...prefs,
                providerId,
                model: DEFAULT_MODELS[providerId],
              });
            }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>

          <label htmlFor="ai-model" style={{ marginTop: 6, display: 'block' }}>
            Model
          </label>
          <input
            id="ai-model"
            type="text"
            value={prefs.model}
            onChange={(e) => updatePrefs({ ...prefs, model: e.target.value })}
            spellCheck={false}
          />

          <label htmlFor="ai-key" style={{ marginTop: 6, display: 'block' }}>
            Your API key
          </label>
          <input
            id="ai-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your own key"
          />

          <label className="check" style={{ marginTop: 6 }}>
            <input
              type="checkbox"
              checked={prefs.rememberKey}
              onChange={(e) =>
                updatePrefs({ ...prefs, rememberKey: e.target.checked })
              }
            />
            <span>
              Remember this key on this computer. Leave it off to keep the key
              in memory only, so it is forgotten when you close Chrome.
            </span>
          </label>

          <p className="hint" style={{ marginTop: 8 }}>
            When you press the button, Chat Threads sends the turns you have
            kept — about {characters.toLocaleString()} characters, shortened to
            the first 1,500 per turn — to{' '}
            <strong>{providerOrigin}</strong> using your key. Excluded turns and
            your edits-out are not sent. Nothing is sent anywhere else, and
            nothing is sent until you press it.
          </p>

          {plan.mode === 'sections' && (
            <p className="hint">
              This conversation is too long for one request, so it goes in{' '}
              {plan.sectionCount} sections — about {plan.requests} requests to
              the same host, one after another, with nothing else in between.
              You still get one set of topics for the whole conversation. It
              will take a few minutes, and you can stop it at any time.
            </p>
          )}

          {plan.mode === 'too-large' && (
            <p className="hint">
              This conversation is too long to analyse automatically: it would
              take {plan.sectionCount} sections and about {plan.requests}{' '}
              requests. Exclude some turns, or split it into topics by hand.
            </p>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void run()}
              disabled={
                working ||
                input.turns.length === 0 ||
                plan.mode === 'too-large'
              }
            >
              {working ? 'Working…' : 'Send and find topics'}
            </button>
            {working && (
              <button
                type="button"
                className="btn small"
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </button>
            )}
            {!working && apiKey && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  setApiKey('');
                  void clearApiKey();
                }}
              >
                Forget key
              </button>
            )}
          </div>

          {status.kind === 'working' && (
            <div className="status" role="status" aria-live="polite">
              {progressText(status.progress)}
            </div>
          )}
          {status.kind === 'cancelled' && (
            <div className="status" role="status">
              Stopped. Nothing was changed.
            </div>
          )}
          {status.kind === 'error' && (
            <div className="status error" role="alert">
              {status.errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
          {status.kind === 'done' && (
            <div className="status ok" role="status">
              Suggested {status.topics} topic
              {status.topics === 1 ? '' : 's'}. Review them below.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
