# Chat Threads

**Reshape your AI conversations.**

Long AI chats get messy. Chat Threads lets you keep the useful context while
removing tangents, editing out material you would rather not carry forward, or
splitting one sprawling conversation into several clean ones — then copy the
result into a new ChatGPT or Claude chat.

Your original conversation is never touched.

---

## What it does

Chat Threads is a Chrome side panel that opens next to ChatGPT or Claude. It
reads the conversation you are looking at, makes its own working copy, and lets
you reshape that copy:

- **Prompts** — read back only what *you* said, in order. The fastest way to
  remember how a long conversation actually developed.
- **Clean** — go through every turn and exclude the ones you do not want, or
  edit a turn's text when most of it is worth keeping and one part is not.
- **Split** — create topics, put each turn into one, and get a separate clean
  conversation per topic.
- **Output** — preview the result, copy it, or download it as Markdown, plain
  text or JSON. Paste it into a new chat and carry on.

Everything above works with no account, no API key and no network requests.

There is one optional extra: **Find Topics** asks a model of your choosing to
suggest how the conversation divides up. It only runs when you press the
button, and it fills in the same controls you would use by hand, so you can
change anything it proposes.

## Why it exists

ChatGPT and Claude both have branching, but branching answers a different
question. Branching asks "what if I had said something else here?" Chat Threads
answers "I want to keep going, but not with *all* of this."

That comes up constantly:

- You went on a tangent and it is now polluting every reply.
- You asked about three unrelated things in one thread and want them separate.
- You pasted something you would rather not carry into the next conversation.
- You wrote a prompt badly, got a poor answer, and both are still in context.

The usual workaround is to select the whole page, copy it and hand-edit the
mess. That breaks on long conversations, because the page only renders part of
them.

## Features

| | |
| --- | --- |
| Reads the whole conversation | From ChatGPT's and Claude's own conversation data, not from the visible page — collapsed and not-yet-rendered turns are included |
| Follows the branch you are on | Reconstructs the branch currently displayed, and says so when it cannot confirm which one that is |
| Never edits the original | Everything happens on a working copy the extension holds in memory |
| Prompts-only view | User turns in order, with the matching reply one click away |
| Exclude and restore | Leave a turn out of the result, put it back at any time |
| Edit working copies | Change a turn's text; the original is kept so you can compare and restore |
| Manual topic splitting | Any number of topics, editable names, per-turn assignment, plus Shared and Unassigned |
| Optional AI topic suggestions | Bring your own API key; nothing is sent until you press the button |
| Honest about retrieval | Reports "complete", "unconfirmed" or "incomplete" and never passes off a partial transcript as a whole one |
| Preview, copy, download | Markdown, plain text and JSON; the preview is the exact text that gets copied |

## Screenshots

Not yet included. The interface is four tabs — Prompts, Clean, Split, Output —
in a standard Chrome side panel. Screenshots will be added once the extension
has been exercised against live accounts; see
[docs/MANUAL-TESTING.md](docs/MANUAL-TESTING.md).

## Privacy

Chat Threads has no server, no analytics and no telemetry. It does not collect,
store or transmit your conversations.

- Reading, viewing, editing, excluding, splitting and generating transcripts
  all happen locally in your browser.
- The only outbound request the extension can ever make is the optional
  **Find Topics** call, to the model provider *you* configure, using *your* API
  key, and only when you press the button and grant permission.
- Your API key is held in memory for the browser session by default and is
  never written to disk unless you explicitly tick "remember this key".
- Nothing is sent merely because you opened the side panel.

The full statement is in [PRIVACY.md](PRIVACY.md), and it describes what the
code actually does.

## Installation

Chat Threads is not in the Chrome Web Store yet. To run it:

```bash
git clone https://github.com/onyourmark/chat-threads.git
cd chat-threads
npm install
npm run icons     # generates the extension icons
npm run build     # writes the unpacked extension to dist/
```

Then, in Chrome:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Open a ChatGPT or Claude conversation.
5. Click the Chat Threads toolbar icon to open the side panel.

If you had a ChatGPT or Claude tab open before installing, reload it — content
scripts are only injected into pages loaded after the extension.

Requires Chrome 116 or later (the side panel API).

## Development

```bash
npm run build      # build the unpacked extension into dist/
npm run test       # run the test suite
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run check      # all of the above, in order
```

After a rebuild, press the reload button on the Chat Threads card in
`chrome://extensions`, then reload the ChatGPT or Claude tab.

Tests never touch a live account. Everything runs against hand-written fixtures
in `tests/fixtures/`. Please do not commit real conversation data — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## How topic splitting works

You create topics and assign each turn to one of:

- **a topic** — the turn appears in that topic's conversation only;
- **Shared** — the turn appears, in full, in *every* topic conversation. Use it
  for an opening instruction or a piece of context that all the topics need;
- **Unassigned** — the turn appears in *no* topic conversation. It is still in
  the cleaned conversation.

Excluding a turn overrides all of that: an excluded turn appears nowhere.

A turn belongs to exactly one topic. `Shared` is how a turn reaches more than
one, and it always carries the complete turn rather than a fragment of it. The
Output tab warns you when included turns are left unassigned, so nothing goes
missing without your noticing.

Generated conversations always keep the original chronological order, including
shared turns, which slot back into the position they originally occupied.

### Find Topics

Pressing **Find Topics** sends the turns you have kept — shortened to the first
1,500 characters each — to the model provider you configured, and asks it to
return a strict JSON structure: a list of topics, and one assignment per turn,
with an "uncertain" flag it is told to set whenever it is unsure.

That reply is validated before anything happens. A malformed reply, an invented
turn number, a topic that was not proposed, or a name containing control
characters is rejected or dropped, and you are told what happened. A rejected
proposal changes nothing.

An accepted proposal writes into the same topic list and the same per-turn
dropdowns you use manually. There is no separate AI state — changing a dropdown
simply overrides what the model said, and turns you have overridden are marked
so you can see which choices were yours.

## Current limitations

Be aware of these before relying on it:

- **Retrieval depends on undocumented behaviour.** ChatGPT and Claude do not
  publish the interfaces their own web apps use to load a conversation. Chat
  Threads uses them from within the page, on your existing session. If either
  provider changes them, retrieval will break until the relevant adapter is
  updated. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- **Not yet tested against live accounts.** The adapters are tested thoroughly
  against fixtures, but at the time of writing they have not been run against a
  signed-in ChatGPT or Claude session. The procedure to do that is written up
  in [docs/MANUAL-TESTING.md](docs/MANUAL-TESTING.md).
- **Live AI topic proposals are unverified.** The provider clients are
  implemented and the whole path is tested with a mock, but no request has been
  made against a real API key.
- **Attachments are referenced, not included.** A transcript notes that
  `spec.pdf` was attached; it does not contain the file.
- **Artifacts and canvas documents are not retrieved.** Only the conversation
  text is.
- **Model reasoning is deliberately not retrieved.** Extended thinking and
  chain-of-thought blocks are skipped by design.
- **Working state is not persisted.** Closing the panel or reloading the
  conversation discards your edits. Generate and copy before you leave.
- **Chrome only.** No Firefox or Safari build.

## Architecture

Four layers, with the provider-specific code confined to the first:

```
src/adapters/       ChatGPT and Claude adapters — the only provider-aware code
src/model/          The common conversation representation + message validation
src/operations/     Working copy, exclusion, editing, topics, transcripts
src/ai/             Topic-analysis interface, schema, validation, providers
src/sidepanel/      The React side panel
src/background/     Service worker (opens the panel, reports the active tab)
src/content/        Content script (runs an adapter in the page)
```

Once a conversation has been normalized, nothing above `src/adapters/` knows
or cares which provider it came from. Adding a provider means writing one
adapter and adding it to `src/adapters/registry.ts`.

The distinction the whole design rests on: a `SourceConversation` is frozen at
retrieval and never written to; a `WorkingState` holds editable copies. That is
what makes "reset", "restore original" and "your original chat is untouched"
true rather than aspirational.

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

Bug reports and adapter fixes are especially welcome — provider changes are the
most likely thing to break. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to
report a retrieval failure usefully, and please read the note about never
committing real conversation data.

## Roadmap

Ideas, not commitments:

- Live testing against real ChatGPT and Claude accounts, and screenshots.
- Remembering the working state across a panel close.
- Reordering turns within a generated conversation.
- Search within a loaded conversation.
- More providers, once the adapter contract has proven itself against two.

Deliberately out of scope: a Chat Threads account, cloud storage, a backend,
analytics, or turning this into a general-purpose AI chat client.

## Licence

MIT — see [LICENSE](LICENSE).
