# Privacy

Chat Threads is built so that this document can be short and specific. Where a
claim is made here, the code that makes it true is named.

**Last reviewed:** 24 August 2026, against version 1.0.1.

## The short version

Chat Threads has no server. It does not collect, store, sell or transmit your
conversations. The only outbound requests it can make are ones you trigger
yourself, to a model provider you configure, with an API key you supply.

It also holds **no standing access to any website**. Out of the box it cannot
read ChatGPT, Claude, or anything else until you click its toolbar icon on a
tab — and that grant covers only that tab, until you navigate away.

## What data the extension reads

When you open the side panel on a ChatGPT or Claude conversation and it loads,
Chat Threads reads:

- the conversation's messages — role, text, timestamps, message ids, and the
  parent links it needs to work out which branch you are viewing;
- attachment metadata: file name, and where available MIME type and size;
- the conversation's title and id;
- the URL of the tab, in order to tell which provider it is.

On ChatGPT there is one further step. The ChatGPT web app authenticates its
own requests with a short-lived access token, which it obtains from
`/api/auth/session` on the page it is already running in. Chat Threads asks
the same address for the same token, from inside that page, and attaches it to
the single request that loads your conversation. The token is held in a local
variable for the length of that call and then discarded: it is never written to
storage, never passed between extension components, and never sent anywhere
except back to ChatGPT (`getAccessToken` in `src/adapters/chatgpt/api.ts`).
Claude needs no equivalent step — its requests are authenticated by the cookies
the browser already sends. Chat Threads does not read cookies itself; it has no
`cookies` permission.

It does **not** read:

- attachment or image contents;
- model reasoning — extended thinking and chain-of-thought blocks are skipped
  by design (`src/adapters/*/normalize.ts`);
- system prompts, developer messages, or custom instructions;
- messages the provider hides from the transcript;
- your other tabs, your browsing history, your bookmarks, or any site other
  than the two providers.

Nothing is read until you invoke Chat Threads on a tab and the panel loads that
conversation. Before you click the icon, the extension cannot read the page or
even its address.

One further thing is *rewritten* rather than read: ChatGPT marks references to
attached files with private syntax that its own interface hides. Chat Threads
replaces those markers with readable text such as
`[Reference to attached file: notes.md]`, using the file name ChatGPT itself
supplies. It never fetches the file, and never invents a name it was not given.

## Where processing happens

In your browser, on your computer. There is no Chat Threads server and no
Chat Threads account.

- Retrieval runs in a reader script injected into the provider's own page when
  you invoke Chat Threads (`src/content/index.ts`), so the request goes to
  ChatGPT or Claude exactly as the page's own requests do, on the session you
  are already signed in with.
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
   the role, and that text are sent, plus the conversation title and the name
   of the built-in topic — so the model keeps it instead of inventing a
   duplicate. If you renamed that topic, the name you chose is what goes.
   (`src/ai/prompt.ts` — `buildAnalysisInput` selects these fields explicitly,
   so a new field added elsewhere cannot start being transmitted by accident.)
4. That payload goes to `https://api.anthropic.com` or `https://api.openai.com`
   — whichever you chose — with your API key.
5. A conversation too long to fit in one request is divided into sections and
   sent in several requests, one after another, to that same host and nowhere
   else. The number of sections is worked out before anything is sent
   (`src/ai/plan.ts`), and the same rules apply to every one of those requests:
   excluded turns are still not sent, and edited-out text is still not
   reconstructed. Nothing extra is transmitted — the conversation is divided,
   not supplemented.

Before you press the button, the panel tells you which host will be contacted,
roughly how many characters will be sent, and — for a long conversation — how
many sections and roughly how many requests that will take. A run in progress
can be stopped.

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

Chat Threads requests **no host permissions at install time**. Chrome's
extension details page should show no "read and change your data on" entry for
any site, and site access set to *on click*.

| Permission | Why |
| --- | --- |
| `sidePanel` | To show the interface in Chrome's side panel |
| `storage` | To hold your AI provider choice, and your API key if you opt in |
| `activeTab` | Temporary access to the one tab you click the icon on, so the conversation can be read. Granted per invocation, and revoked when you navigate away |
| `scripting` | To place the reader script into that tab at the moment you invoke it. Grants nothing on its own |

Five further origins are **optional** — declared so they can be asked for,
never held unless you say yes:

| Optional permission | Asked for when |
| --- | --- |
| Ongoing access to `chatgpt.com`, `chat.openai.com`, `claude.ai` | Only if you choose "Allow Chat Threads to read…" so the panel stops needing the icon each time. Revocable from Chrome's extension settings |
| Access to `api.anthropic.com`, `api.openai.com` | Only when you first use Find Topics |

Chat Threads does not request `<all_urls>`, `tabs`, `history`, `cookies`,
`downloads`, `webRequest`, `bookmarks`, or access to any site beyond those
above.

Two notes on what is *not* needed:

- The active tab's address is read through `activeTab`, so no `tabs`
  permission is required. Before you invoke it, Chat Threads genuinely cannot
  see what page you are on — which is why the panel asks you to click the icon
  rather than announcing what site you are visiting.
- Downloads are offered through an ordinary link, so no `downloads`
  permission is required.

### Why this matters more than it sounds

An extension with permanent access to a site can read that site whenever it
likes, including in background tabs you are not looking at. Chat Threads gave
that up: with `activeTab`, there is a specific moment — your click — at which
access begins, and it ends when you leave the page. The cost is that you click
the icon; the benefit is that "when could this thing have read my chats?" has a
precise answer.

## Your original conversation

Chat Threads never writes to ChatGPT or Claude. It issues read requests only.
The retrieved conversation object is frozen in memory at the moment it is
loaded (`freezeConversation` in `src/model/conversation.ts`), so even a bug
could not modify it — an attempted write throws. Every edit you make applies to
a separate working copy.

## Questions

Open an issue at https://github.com/onyourmark/chat-threads/issues.
