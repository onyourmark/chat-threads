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

### Claude: still not tested live

Claude retrieval has **never been run against a signed-in account**. It is
implemented and unit-tested against fixtures, and the endpoint shapes come from
documented-by-observation behaviour rather than a live capture. Treat Claude
support as unverified. In particular these are unknown:

- whether the organization lookup picks the right organization on an account
  that belongs to more than one;
- whether a long real conversation loads completely;
- whether branch reconstruction matches what the page shows after an edit or a
  retry.

### OpenAI topic proposals: one successful live call

A real OpenAI API request has completed successfully with a user-supplied key,
producing sensible topic names and turn assignments that Output turned into
separate conversations.

One successful run is not reliability. One observed run was slow and appeared
to hit a temporary retry or reload condition before it succeeded, so latency
and transient failure handling are open questions. There is no retry logic and
no request timeout beyond the browser's own.

### Anthropic topic proposals: not tested live

The Anthropic client is implemented and unit-tested; no request has been made
with a real Anthropic key.

### The current permission model: not tested live

After the live run, the extension was changed to hold **no standing site
access**: it now uses `activeTab` and injects its reader script on demand. The
live testing above was done with the previous build, which had permanent host
access to the provider sites.

The retrieval mechanism itself is unchanged — the same script, doing the same
same-origin fetch, in the same isolated world — but *how it gets into the page*
is new and has not been exercised in a browser. Neither Chrome 151 nor Edge 151
still honours `--load-extension`, so this could not be automated. It is the
first thing to re-test; see [MANUAL-TESTING.md](MANUAL-TESTING.md).

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
live in the side panel's memory. Closing the panel, reloading the conversation,
or switching to a different conversation discards them. Generate and copy
before you leave.

**Only one conversation at a time.** There is no way to combine turns from two
different conversations.

**Turn order cannot be changed.** Generated transcripts always follow the
original chronological order.

**Multiple organizations on Claude.** If your account belongs to several, the
adapter uses the first one Claude lists with chat enabled. If your conversation
lives in a different organization, retrieval will report that the conversation
was not found.

**Chrome only, 116 or later.** The side panel API is Chrome-specific. Firefox
and Safari are out of scope for version 1.

**Very long conversations are limited by memory and by the clipboard.** There
is no hard cap, but an extremely long transcript may be slow to render and
awkward to paste into a chat with a context limit.

**Find Topics shortens what it sends.** Each turn is cut to its first 1,500
characters before being sent for classification. This is good for privacy and
cost, but a topic shift buried deep inside one very long turn may be missed.
