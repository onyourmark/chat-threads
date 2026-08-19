# Privacy

Chat Threads is built so that this document can be short and specific. Where a
claim is made here, the code that makes it true is named.

**Last reviewed:** 19 August 2026, against version 1.0.0.

## The short version

Chat Threads has no server. It does not collect, store, sell or transmit your
conversations. The only outbound request it can make is one you trigger
yourself, to a model provider you configure, with an API key you supply.

## What data the extension reads

When you open the side panel on a ChatGPT or Claude conversation and it loads,
Chat Threads reads:

- the conversation's messages — role, text, timestamps, message ids, and the
  parent links it needs to work out which branch you are viewing;
- attachment metadata: file name, and where available MIME type and size;
- the conversation's title and id;
- the URL of the tab, in order to tell which provider it is.

It does **not** read:

- attachment or image contents;
- model reasoning — extended thinking and chain-of-thought blocks are skipped
  by design (`src/adapters/*/normalize.ts`);
- system prompts, developer messages, or custom instructions;
- messages the provider hides from the transcript;
- your other tabs, your browsing history, your bookmarks, or any site other
  than the two providers.

Nothing is read until the panel loads a conversation. Opening the panel on an
unsupported page reads nothing but the tab's URL.

## Where processing happens

In your browser, on your computer. There is no Chat Threads server and no
Chat Threads account.

- Retrieval runs in a content script on the provider's own page
  (`src/content/index.ts`), so the request goes to ChatGPT or Claude exactly as
  the page's own requests do, on the session you are already signed in with.
- Normalizing, viewing, excluding, editing, topic assignment and transcript
  generation are all pure functions in `src/model/` and `src/operations/`. None
  of them performs any network access.

## What is stored

**Your conversation is not stored.** The working copy lives in the side panel's
memory. Closing the panel or reloading discards it — that is why the README
tells you to copy before you leave.

Two small things are stored, both only if you use the optional AI feature:

| What | Where | Persists? |
| --- | --- | --- |
| Chosen model provider and model name | `chrome.storage.local` | Yes |
| Your API key | `chrome.storage.session` by default | No — cleared when you close Chrome |
| Your API key, if you tick "remember this key on this computer" | `chrome.storage.local` | Yes, until you press "Forget key" |

The key is never synced to your Google account, never sent to the background
service worker or a content script, and never included in any message the
extension passes internally. See `src/sidepanel/settings.ts`.

If you never open the Find Topics section, the extension stores nothing at all.

## What happens when you use Find Topics

This is the only feature that sends anything anywhere. It requires an explicit
press of the button. When you press it:

1. Chrome asks your permission to contact the provider's host. Chat Threads
   does not hold that permission until you grant it — it is declared as an
   *optional* host permission in the manifest.
2. The turns you have **kept** are collected. Excluded turns are not sent. The
   **edited** text is sent, never the original — so if you edited something out
   of a turn, the removed text is not transmitted.
3. Each turn is shortened to its first 1,500 characters. Only the turn number,
   the role, and that text are sent, plus the conversation title
   (`src/ai/prompt.ts` — `buildAnalysisInput` selects these fields explicitly,
   so a new field added elsewhere cannot start being transmitted by accident).
4. That payload goes to `https://api.anthropic.com` or `https://api.openai.com`
   — whichever you chose — with your API key.

Before you press the button, the panel tells you which host will be contacted
and roughly how many characters will be sent.

Your conversation is then subject to that provider's own privacy policy, not
this one. No telemetry, identifier, or usage data is attached to the request,
and Chat Threads receives no copy of it.

## Analytics and telemetry

There are none. No analytics, no crash reporting, no usage counters, no remote
logging, no advertising, no third-party scripts. The extension loads no remote
code — its content security policy restricts scripts to the extension's own
files.

This is not a promise about future intentions; it is a description of the
current code. If it ever changes, this document changes in the same commit.

## Permissions, and why each is needed

| Permission | Why |
| --- | --- |
| `sidePanel` | To show the interface in Chrome's side panel |
| `storage` | To hold your AI provider choice, and your API key if you opt in |
| Host access to `chatgpt.com`, `chat.openai.com`, `claude.ai` | To run the content script that reads the conversation you are viewing |
| *Optional* host access to `api.anthropic.com`, `api.openai.com` | Only requested when you first use Find Topics; declined or unused otherwise |

Chat Threads does not request `<all_urls>`, `tabs`, `history`, `cookies`,
`downloads`, `webRequest`, or access to any site beyond the four above.

It reads the active tab's URL through the host permissions it already has, so
no separate `tabs` permission is needed. Downloads are offered through an
ordinary link rather than the downloads API, so no `downloads` permission is
needed either.

## Your original conversation

Chat Threads never writes to ChatGPT or Claude. It issues read requests only.
The retrieved conversation object is frozen in memory at the moment it is
loaded (`freezeConversation` in `src/model/conversation.ts`), so even a bug
could not modify it — an attempted write throws. Every edit you make applies to
a separate working copy.

## Questions

Open an issue at https://github.com/onyourmark/chat-threads/issues.
