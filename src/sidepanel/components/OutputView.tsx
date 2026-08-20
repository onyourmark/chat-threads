/**
 * Output.
 *
 * Generates the reshaped conversation or conversations and hands them over:
 * preview, copy, download. The preview is exactly the string that gets
 * copied — they come from the same call, so what you read is what you paste.
 */

import { useMemo, useState } from 'react';
import {
  CONTINUATION_HEADER,
  fileNameFor,
  generateCleaned,
  generateSplit,
  renderJson,
  renderMarkdown,
  renderPlainText,
  unassignedIncludedTurns,
  type GeneratedConversation,
} from '../../operations/transcript';
import type { WorkingState } from '../../operations/working';
import { isPristineDefaultTopic } from '../../model/default-topic';
import { copyText, downloadText } from '../chrome';

interface Props {
  state: WorkingState;
}

export function OutputView({ state }: Props) {
  const [includeHeader, setIncludeHeader] = useState(true);
  const [plainText, setPlainText] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const options = useMemo(
    () => ({ includeHeader, includeAttachments: true }),
    [includeHeader],
  );

  const conversations = useMemo(() => {
    const cleaned = generateCleaned(state);

    // The built-in topic exists on every conversation, so showing an empty
    // card for it by default would put a heading about swearing at the top of
    // everyone's output. It appears once it is used or renamed; a topic the
    // user made themselves always appears, empty or not, so they can see it
    // came out empty.
    const split = generateSplit(state).filter((conversation) => {
      const topic = state.topics.find((t) => t.id === conversation.topicId);
      if (!topic || !isPristineDefaultTopic(topic)) return true;
      return conversation.turns.length > 0;
    });

    return split.length > 0 ? [cleaned, ...split] : [cleaned];
  }, [state]);

  const render = (c: GeneratedConversation) =>
    plainText ? renderPlainText(c, options) : renderMarkdown(c, options);

  // Only worth warning about once topic conversations are actually being
  // produced. Before that, "not in any topic" describes every turn and means
  // nothing.
  const stranded =
    conversations.length > 1 ? unassignedIncludedTurns(state) : [];

  const doCopy = async (c: GeneratedConversation) => {
    const ok = await copyText(render(c));
    setCopied(ok ? c.id : `failed:${c.id}`);
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      <div className="notice">
        <label className="check">
          <input
            type="checkbox"
            checked={includeHeader}
            onChange={(e) => setIncludeHeader(e.target.checked)}
          />
          <span>
            Start with a note explaining this is an earlier conversation
          </span>
        </label>
        {includeHeader && (
          <p className="hint" style={{ marginTop: 4 }}>
            “{CONTINUATION_HEADER}”
          </p>
        )}
        <label className="check" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={plainText}
            onChange={(e) => setPlainText(e.target.checked)}
          />
          <span>Plain text instead of Markdown</span>
        </label>
      </div>

      {stranded.length > 0 && (
        <div className="notice warn">
          <h3>
            {stranded.length} turn{stranded.length === 1 ? '' : 's'} not in any
            topic
          </h3>
          <p style={{ margin: 0 }}>
            They are in the cleaned conversation but will not appear in any of
            the topic conversations below. Assign them in Split, or leave them
            out on purpose.
          </p>
        </div>
      )}

      {conversations.map((c) => {
        const text = render(c);
        const showing = previewId === c.id;
        return (
          <section className="output-card" key={c.id}>
            <div className="output-head">
              <h3>{c.title}</h3>
              <div className="sub">
                {c.turns.length} turn{c.turns.length === 1 ? '' : 's'} ·{' '}
                {text.length.toLocaleString()} characters
              </div>
            </div>
            <div className="output-body">
              <div className="row">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void doCopy(c)}
                  disabled={c.turns.length === 0}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPreviewId(showing ? null : c.id)}
                  aria-expanded={showing}
                  disabled={c.turns.length === 0}
                >
                  {showing ? 'Hide preview' : 'Preview'}
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    downloadText(
                      fileNameFor(c, plainText ? 'txt' : 'md'),
                      text,
                      plainText ? 'text/plain' : 'text/markdown',
                    )
                  }
                  disabled={c.turns.length === 0}
                >
                  {plainText ? 'Download .txt' : 'Download .md'}
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    downloadText(
                      fileNameFor(c, 'json'),
                      renderJson(c, state),
                      'application/json',
                    )
                  }
                  disabled={c.turns.length === 0}
                >
                  .json
                </button>
              </div>

              {copied === c.id && (
                <div className="status ok" role="status">
                  Copied. Paste it into a new chat.
                </div>
              )}
              {copied === `failed:${c.id}` && (
                <div className="status error" role="alert">
                  Chrome would not allow the copy. Use Preview and copy by hand.
                </div>
              )}

              {c.turns.length === 0 && (
                <p className="hint">
                  Nothing is assigned to this topic yet, so there is nothing to
                  copy.
                </p>
              )}

              {showing && <pre className="preview">{text}</pre>}
            </div>
          </section>
        );
      })}
    </>
  );
}
