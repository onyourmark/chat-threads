/**
 * Find Topics — the optional AI step.
 *
 * Nothing in this component runs on its own. The conversation is only sent
 * after the user has entered a key, read what will be sent and to whom, and
 * pressed the button. Everything else in Chat Threads works with this section
 * left untouched.
 */

import { useEffect, useState } from 'react';
import { createAnalyzer } from '../../ai/apply';
import type { TopicProposal } from '../../ai/schema';
import { buildAnalysisInput, payloadSize } from '../../ai/prompt';
import { DEFAULT_MODELS, PROVIDER_ORIGINS, type AnalyzerConfig } from '../../ai/types';
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
  | { kind: 'working' }
  | { kind: 'error'; errors: string[] }
  | { kind: 'done'; topics: number };

export function FindTopics({ state, onProposal }: Props) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<AiPrefs>(DEFAULT_PREFS);
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    void loadApiKey().then(setApiKey);
  }, []);

  const updatePrefs = (next: AiPrefs) => {
    setPrefs(next);
    void savePrefs(next);
  };

  const input = buildAnalysisInput(state);
  const characters = payloadSize(input);

  const run = async () => {
    if (!apiKey.trim()) {
      setStatus({ kind: 'error', errors: ['Enter an API key first.'] });
      return;
    }
    setStatus({ kind: 'working' });

    const origin = PROVIDER_ORIGINS[prefs.providerId];
    // Asked for here, inside the click, because Chrome only grants optional
    // permissions during a user gesture.
    const granted = await ensureHostPermission(origin);
    if (!granted) {
      setStatus({
        kind: 'error',
        errors: [
          `Chat Threads needs your permission to contact ${origin} before it can do this.`,
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

    const result = await createAnalyzer(config).analyze(input);
    if (!result.ok) {
      setStatus({ kind: 'error', errors: result.errors });
      return;
    }

    onProposal(result.proposal);
    setStatus({ kind: 'done', topics: result.proposal.topics.length });
  };

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
            <strong>{PROVIDER_ORIGINS[prefs.providerId]}</strong> using your
            key. Excluded turns and your edits-out are not sent. Nothing is sent
            anywhere else, and nothing is sent until you press it.
          </p>

          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => void run()}
              disabled={status.kind === 'working' || input.turns.length === 0}
            >
              {status.kind === 'working'
                ? 'Asking the model…'
                : 'Send and find topics'}
            </button>
            {apiKey && (
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
