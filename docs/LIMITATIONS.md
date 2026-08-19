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

## Not yet verified against live accounts

At the time of writing, the adapters have been tested extensively against
hand-written fixtures but **have not been run against a signed-in ChatGPT or
Claude session**. The endpoint shapes above are implemented from their
documented-by-observation behaviour, not from a live capture during
development.

Concretely, these remain unverified:

- that the ChatGPT session and conversation endpoints respond as expected on a
  current account;
- that the Claude organization lookup picks the right organization for accounts
  that have more than one;
- that a very long real conversation loads completely;
- that the branch reconstruction matches what a real page displays after an
  edit or a regeneration.

The procedure to check all of this is written up in
[MANUAL-TESTING.md](MANUAL-TESTING.md). Until someone runs it, treat live
retrieval as "implemented and unit-tested, not yet field-tested".

## Live AI topic proposals are unverified

The OpenAI and Anthropic clients are implemented, and the full path — building
the payload, sending it, parsing, validating, applying, correcting — is tested
with a mock analyzer. No request has been made with a real API key, so the
exact request and response shapes are unconfirmed in practice.

## Other limitations

**Attachments are referenced, not included.** A transcript records that
`spec.pdf` was attached. It does not contain the file, and the model you paste
into will not be able to read it.

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
