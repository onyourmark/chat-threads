# Limitations

This document is deliberately blunt. If you are deciding whether to depend on
Chat Threads, read it before the README's feature list.

## Retrieval depends on undocumented provider behaviour

This is the project's central fragility and it cannot be engineered away.

Neither OpenAI nor Anthropic publishes a supported interface for reading your
own conversations out of their web app. Chat Threads therefore uses the same
internal endpoints the web apps use, from inside the page, on the session you
are already signed in with.

**What that means in practice:** these endpoints can change at any time, with
no notice and no deprecation period. When one does, retrieval for that provider
stops working until the adapter is updated. There is no version to pin to and
no contract being broken — it was never a public interface.

### What Chat Threads depends on

**ChatGPT** (`src/adapters/chatgpt/api.ts`, `normalize.ts`)

| Dependency | Used for |
| --- | --- |
| `GET /api/auth/session` returning `{ accessToken }` | Authorizing the conversation request |
| `GET /backend-api/conversation/{id}` | The conversation itself |
| A `mapping` object of `{ id, message, parent, children }` nodes | Rebuilding the message tree |
| `current_node` | Knowing which branch is on screen |
| `message.author.role`, `message.content.content_type`, `content.parts` | Roles and text |
| `message.metadata.attachments`, `.is_visually_hidden_from_conversation` | Attachments; hidden messages |
| A `/c/<id>` URL path | Identifying the open conversation |

**Claude** (`src/adapters/claude/api.ts`, `normalize.ts`)

| Dependency | Used for |
| --- | --- |
| `GET /api/organizations` returning objects with `uuid` | Finding the organization a conversation belongs to |
| `GET /api/organizations/{org}/chat_conversations/{id}?tree=True&rendering_mode=messages` | The conversation itself |
| `chat_messages[]` with `uuid`, `parent_message_uuid`, `sender`, `content[]` | Rebuilding the message tree |
| `current_leaf_message_uuid` | Knowing which branch is on screen |
| A sentinel parent uuid that is not itself a message | Recognising the first message |
| `attachments[].file_name`, `files[].file_name` | Attachments |
| A `/chat/<id>` URL path | Identifying the open conversation |

### How the damage is contained

- Every dependency above is inside one adapter folder. Nothing else in the
  codebase knows these field names exist.
- A format change produces a named failure — the adapter, a reason code, and
  the source file to edit — rather than a crash or a silent half-transcript.
- Unknown message types are counted and surfaced as a warning, and downgrade
  the conversation from "complete" to "unconfirmed". A provider adding a new
  message type therefore becomes visible immediately instead of quietly
  removing turns.
- If structured retrieval fails entirely, the DOM fallback may still produce
  something — always labelled **incomplete**, never presented as the whole
  conversation.

If you hit a break, the report that helps most is described in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## What has and has not been tested live

### ChatGPT: tested, and it worked

ChatGPT retrieval has been run against a real signed-in account in Microsoft
Edge. A conversation of roughly 449 turns loaded, reported itself complete, and
included messages that ChatGPT's own interface collapses. The full workflow —
prompts view, exclusion, editing, restore, reset, manual splitting, preview,
copy — worked, the original conversation was untouched, and a topic-specific
transcript pasted into a new ChatGPT conversation was correctly treated as
prior context.

That is one account, of one type, on one browser. It does **not** establish
compatibility across ChatGPT account types (Team, Enterprise, Edu are all
untested), nor that every conversation shape behaves the same.

### Claude: tested, and it worked

Claude retrieval has been run against a real signed-in Claude conversation.
Claude was recognised, the conversation loaded, and the normal Chat Threads
workflow ran on it.

Reading a Claude conversation needs no API key. It goes out on the Claude
session the browser already holds, exactly as ChatGPT retrieval does.

That is one account, on one browser. It does **not** establish compatibility
across Claude account types, across organizations, or with future versions of
the site. These in particular remain untested rather than disproven:

- whether the organization lookup picks the right organization on an account
  that belongs to more than one;
- whether branch reconstruction matches what the page shows after an edit or a
  retry.

### OpenAI topic proposals: successful live calls

Real OpenAI API requests have completed successfully with a user-supplied key,
producing sensible topic names and turn assignments that Output turned into
separate conversations — including for a conversation retrieved from Claude.
The Find Topics provider is chosen independently of where the conversation came
from, so an OpenAI key analyses a Claude conversation perfectly well.

That is not reliability. One observed run was slow and appeared to hit a
temporary retry or reload condition before it succeeded, so latency and
transient failure handling are open questions. There is no retry logic and no
request timeout beyond the browser's own.

A later run, on an 866-turn conversation of roughly 688,000 characters, was
rejected outright: the whole conversation went out as one request and the model
had no room for it. Version 1.0.1 divides a conversation that size into
sections and analyses it in several bounded requests instead.

That path has now been run live, once, on a real 876-turn conversation with
gpt-4o-mini. It sectioned correctly, completed all fifteen discovery requests
in about 55 seconds, and then failed at the merge step: the OpenAI client was
discarding the JSON schema for every request and sending plain JSON mode, so
the model answered with the right information under the wrong property name and
fifteen paid requests were lost. Both halves of that are fixed — the schema now
goes on the wire as Structured Outputs, and a reply that is valid JSON of the
wrong shape is asked once more within a small per-run budget — but **the
corrected path has not yet been re-run end to end against a real
conversation**, so treat a complete sectioned run as tested rather than
field-proven.

A sectioned run makes one request per section twice over plus one to reconcile
them (31 requests for a 15-section conversation), so it takes longer and costs
more than a single request. The panel states both the normal count and a
ceiling that includes the repair budget before it starts, and can be stopped.

### Anthropic topic proposals: not tested live

The Anthropic client is implemented and unit-tested; no request has been made
with a real Anthropic key. An Anthropic key is needed only if Anthropic is
chosen as the Find Topics provider — it is never needed to read a conversation
from either provider.

### The permission model and tab binding: tested, and they work

The extension holds **no standing site access**: it uses `activeTab` and injects
its reader script on demand. That path has now been exercised in Microsoft Edge,
a Chromium browser, and behaves as intended:

- invoking Chat Threads explicitly on a conversation loads it;
- switching to a second conversation does **not** load it — nothing is read
  without an explicit invocation;
- returning to the first conversation still shows its working state;
- invoking on the second conversation loads it independently;
- returning to the first one again still shows its own state.

State is therefore isolated by tab and conversation, which is what the
`activeTab` grant and the session store were built to guarantee.

One point about what this looks like in use: the side panel does **not**
disappear when you switch tabs. Chromium gives a window a single side panel, so
the panel stays visibly open — it simply shows a neutral "Ready when you are"
state for a conversation it has not been pointed at, instead of reading it. The
guarantee is about what is read, not about the panel vanishing.

This could not be automated: neither Chrome 151 nor Edge 151 still honours
`--load-extension`, so it was checked by hand. The procedure is in
[MANUAL-TESTING.md](MANUAL-TESTING.md).

## Provider-private markers may still surprise us

ChatGPT writes references to attached files as private markers built from
Unicode Private Use Area characters, which its own interface swaps for a chip
before the user sees anything. Chat Threads reads the conversation data
directly, so it gets the raw markers and translates them itself.

The translation is driven by ChatGPT's own `content_references` metadata where
that is present, and falls back to the documented marker grammar where it is
not. Two consequences:

- If ChatGPT introduces a marker kind that does not match the grammar, it could
  appear raw. The visible symptom would be stray characters or the word
  `filecite` in a transcript. Report it.
- Where a file name genuinely cannot be recovered, the transcript says a
  reference existed without naming a file. It will never invent one.

## Other limitations

**You have to point it at a tab.** Because Chat Threads holds no standing site
access, it can only read a tab you have invoked it on with the toolbar icon.
After a page reload, or on a different tab, you click the icon again. Granting
the optional site permission removes this, and is offered in the panel.

**Attachments are referenced, not included.** A transcript records that
`spec.pdf` was attached, and an inline reference becomes
`[Reference to attached file: spec.pdf]`. It does not contain the file, and the
model you paste into will not be able to read it.

**Artifacts, canvas documents and rendered tool output are not retrieved.**
Only conversation text is. A Claude artifact's contents will not appear in your
transcript.

**Model reasoning is not retrieved, by design.** Extended thinking and
chain-of-thought blocks are skipped. This is a deliberate scope decision, not
an oversight.

**Working state is not persisted.** Exclusions, edits and topic assignments
live in the side panel's memory, kept separately for each tab and conversation.
Switching tabs or conversations does not lose them — you can come back — but
closing the panel does, and so does reloading a conversation from the provider.
Nothing is written to storage. Generate and copy before you finish.

**Only one conversation at a time.** There is no way to combine turns from two
different conversations.

**Turn order cannot be changed.** Generated transcripts always follow the
original chronological order.

**Multiple organizations on Claude.** If your account belongs to several, the
adapter uses the first one Claude lists with chat enabled. If your conversation
lives in a different organization, retrieval will report that the conversation
was not found.

**Chromium only, 116 or later.** The side panel API is Chromium's. Chrome and
Microsoft Edge both work — the live testing was done in Edge. Firefox and
Safari are out of scope for version 1.

**Very long conversations are limited by memory and by the clipboard.** There
is no hard cap, but an extremely long transcript may be slow to render and
awkward to paste into a chat with a context limit.

**Branch detection only works from the branched side.** ChatGPT records a
"Branch in new chat" on the conversation that was created, as four
`branching_from_*` fields on that chat's first message, pointing back at the
conversation and message it came from. Nothing is recorded on the other side:
there is no field saying "this conversation has branches", no branch count and
no list of child conversations. So Chat Threads can tell you where a branched
conversation came from, and cannot tell you, from an original conversation,
where somebody branched out of it. That is a limit of the provider data, not of
the implementation.

**Branch detection has not been run against a real branched conversation.** The
representation was established by reading ChatGPT's own published web bundle,
and is covered end to end by tests against synthetic payloads built to that
shape. No request has yet been made for a real conversation created with
"Branch in new chat". If ChatGPT renames those fields, detection goes quiet —
it reports nothing rather than guessing — and `src/adapters/chatgpt/branch-metadata.ts`
is the file to repair.

**Claude has no equivalent.** Claude's conversation tree forks for edits and
regenerations exactly as ChatGPT's does, but it has no "branch into a new chat"
feature and records nothing linking one conversation to another. Chat Threads
reports that as unsupported rather than as "no branches found".

**A long conversation makes the panel work hard.** Several hundred turns is
several hundred cards, each with a dropdown of every topic. Off-screen cards
are left undrawn (`content-visibility`), and typing a topic name no longer
rebuilds the list on every keystroke, but a conversation of a thousand turns is
still a large document and the panel will feel heavier than on a short one.

**A sectioned Find Topics run takes minutes, not seconds.** Fifteen sections is
31 requests one after another; on the one measured run, fifteen of them took
about 55 seconds, so a whole run is several minutes. The panel says how long to
expect before it starts, and stays usable while it runs.

**Find Topics shortens what it sends.** Each turn is cut to its first 1,500
characters before being sent for classification. This is good for privacy and
cost, but a topic shift buried deep inside one very long turn may be missed.

**A conversation can be too large even for sectioned analysis.** Beyond about
1.2 million characters of retained text — roughly 24 sections, or 49 requests —
Chat Threads refuses before sending anything rather than making a very large
number of paid requests on your key. Excluding turns brings it back under the
limit.
