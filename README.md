# Chat Threads

**Reshape your AI conversations.**

Long AI chats get messy. You start on one thing, drift into two others, paste
something you would rather not keep — and somewhere in the middle you lose
patience and tell the model exactly what you think of it. Chat Threads
untangles one long AI conversation into separate topic conversations. Clean up
your act on the way out: remove the rant, keep the useful context.

**Your original ChatGPT or Claude conversation is never changed.**

![Four-step walkthrough of Chat Threads: a ChatGPT conversation mixing a book proposal, a browser extension and travel plans; the side panel finding those as three separate topics; the user reviewing one topic and choosing which turns to remove; and the finished clean conversations ready to copy.](docs/assets/chat-threads-demo.gif)

**What the demo shows.** A long conversation holds several unrelated
discussions. Chat Threads finds them. You review a topic and remove what you do
not want. You copy out clean conversations and carry on. The conversation in
the demo is invented for it — no real chat appears anywhere in this repository.

---

## What you can do

Chat Threads is a Chrome side panel that opens next to ChatGPT or Claude. It
reads the conversation you are looking at, makes its own working copy, and lets
you reshape that copy:

- **See only your prompts** — read a long conversation back through your own
  side of it, with the matching reply one click away.
- **Remove what you do not want** — leave out whole turns, or edit a turn to
  cut one paragraph and keep the rest.
- **Find the separate discussions** inside one long thread. Do it by hand, or
  press **Find Topics** and have a model you choose propose the split.
- **Review and correct any suggestion** — a proposal fills in the same controls
  you would use yourself, so you can rename a topic, move any turn, or throw
  the whole thing away. Nothing is removed until you say so.
- **Pull one topic out** into its own conversation, ready to continue
  separately.
- **Or cut one topic out** of the cleaned conversation — open it on its own,
  untick anything worth keeping, and remove the rest in one go.
- **Copy the result into a new ChatGPT or Claude chat** and pick up where you
  left off, with the context you wanted and none of the rest.

Everything except Find Topics works with no account, no API key, and no network
requests at all.

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
| Reads the whole conversation | From ChatGPT's and Claude's own conversation data, not from the visible page — collapsed and not-yet-rendered turns are included. Tested live on a 449-turn ChatGPT conversation |
| Asks before it reads anything | No standing site access; it can only read a tab you point it at with the toolbar icon |
| Readable file references | ChatGPT's private "attached file" markers become `[Reference to attached file: notes.md]` rather than raw syntax |
| Follows the branch you are on | Reconstructs the branch currently displayed, and says so when it cannot confirm which one that is |
| Never edits the original | Everything happens on a working copy the extension holds in memory |
| Prompts-only view | User turns in order, with the matching reply one click away |
| Exclude and restore | Leave a turn out of the result, put it back at any time |
| Edit working copies | Change a turn's text; the original is kept so you can compare and restore |
| Manual topic splitting | Any number of topics, editable names, per-turn assignment, plus Shared and Unassigned |
| One topic made for you | "Why is AI so stupid?" — for turns spent cursing at, arguing with or venting at the AI. Rename it, remove it, or ignore it |
| Review a topic and cut it | Open any topic on its own, tick the turns that really belong, and take them out of the cleaned conversation in one go |
| Optional AI topic suggestions | Bring your own API key; nothing is sent until you press the button |
| Honest about retrieval | Reports "complete", "unconfirmed" or "incomplete" and never passes off a partial transcript as a whole one |
| Preview, copy, download | Markdown, plain text and JSON; the preview is the exact text that gets copied |

## Privacy

Chat Threads has no server, no analytics and no telemetry. It does not collect,
store or transmit your conversations.

- **It holds no standing access to any website.** Out of the box it cannot read
  ChatGPT, Claude or anything else until you click its toolbar icon on a tab,
  and that access ends when you navigate away. Chrome's extension page should
  show no site permissions and site access set to *on click*.
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
5. Click the Chat Threads toolbar icon. That one click both opens the side
   panel and gives Chat Threads permission to read that tab.

You will click the icon again after reloading the page, or on a different tab.
If you would rather not, the panel offers to let you grant ongoing access to
chatgpt.com and claude.ai, which you can revoke at any time.

Requires Chrome or Edge 116 or later (the side panel API).

## Development

```bash
npm run build      # build the unpacked extension into dist/
npm run test       # run the test suite
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run check      # all of the above, in order
```

After a rebuild, press the reload button on the Chat Threads card in
`chrome://extensions`, then click the Chat Threads icon on the provider tab
again. There is no need to reload the page itself — the reader script is
injected on demand rather than declared in the manifest.

Tests never touch a live account. Everything runs against hand-written fixtures
in `tests/fixtures/`. Please do not commit real conversation data — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## How topic splitting works

Every conversation starts with one topic already made: **Why is AI so stupid?**
— for turns spent cursing at, arguing with, or venting at the AI rather than
getting anything done. Those are usually the first thing you want out of a
transcript you are about to carry forward, and picking them out by hand is
tedious.

It is a default, not a fixture. Rename it, remove it, or leave it empty and
nothing else changes; it only appears in your output once something is in it.
Reset Changes brings it back.

You create further topics and assign each turn to one of:

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

### Reviewing a topic, and cutting it out

A topic is good for two different things, and you do not have to choose:

- **pull this discussion out** into its own conversation, in Output; or
- **take this discussion out** of the cleaned conversation.

The second is what **Review** is for. Every topic has one — the built-in topic,
topics you made yourself, and topics Find Topics proposed, all through the same
controls.

Review opens that topic on its own, showing only the turns assigned to it, with
every turn ticked. Ticked means "remove this". That default matches the usual
intention — *take this whole thread out* — and leaves you to untick the
exceptions. There is a running count, **Select all** and **Select none**, and
you can move a turn to a different topic from here if it was filed wrongly.

**Remove selected turns** then excludes exactly the ticked ones. "Excluded" here
means the same thing it means in the Clean view: it is the same switch, so a
turn removed through a topic shows as excluded in Clean, can be put back there,
and is restored by Reset Changes. There is no separate idea of deletion, and
nothing is ever removed from your actual ChatGPT or Claude conversation.

Turns marked **Shared** are deliberately not offered in Review. They belong to
every topic, so removing one while looking at a single topic would quietly take
it out of all the others.

### Find Topics

Pressing **Find Topics** sends the turns you have kept — shortened to the first
1,500 characters each — to the model provider you configured, and asks it to
return a strict JSON structure: a list of topics, and one assignment per turn,
with an "uncertain" flag it is told to set whenever it is unsure.

It is also told that **Why is AI so stupid?** already exists, so it keeps that
topic rather than inventing its own version of it, and it is given rules for
what goes in: swearing at the assistant, arguing with it about its own
behaviour, venting at it — along with the assistant's side of that exchange, so
you can lift the whole thing out in one go. The rules it is given are mostly
about what does *not* belong there: ordinary discussion about AI, technical
criticism, corrections, and plain disagreement all stay with the work, even
when you were annoyed at the time.

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
- **ChatGPT is live-tested; Claude is not.** ChatGPT retrieval and the whole
  reshaping workflow have been run against a real account on a 449-turn
  conversation, and the resulting transcript was successfully continued in a
  new ChatGPT chat. **Claude retrieval has never been run against a live
  account.** Treat Claude support as implemented but unverified.
- **One ChatGPT account, of one type.** Team, Enterprise and Edu accounts are
  untested.
- **AI topic proposals: one successful OpenAI call.** A real request produced
  usable topics, but one run was slow and appeared to retry before succeeding.
  There is no retry logic. The Anthropic client has not been used live.
- **The permission model changed after that testing.** Chat Threads now uses
  `activeTab` instead of standing site access. The retrieval mechanism is
  unchanged, but the way the reader gets into the page has not been exercised
  in a browser yet. See [docs/MANUAL-TESTING.md](docs/MANUAL-TESTING.md).
- **Attachments are referenced, not included.** A transcript notes that
  `spec.pdf` was attached, and an inline mention becomes
  `[Reference to attached file: spec.pdf]`; it does not contain the file.
- **Artifacts and canvas documents are not retrieved.** Only the conversation
  text is.
- **Model reasoning is deliberately not retrieved.** Extended thinking and
  chain-of-thought blocks are skipped by design.
- **Working state is not persisted.** Closing the panel or reloading the
  conversation discards your edits. Generate and copy before you leave.
- **Chromium only.** Chrome and Edge. No Firefox or Safari build.

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

**Chat Threads is public source, but is not currently accepting pull requests
or other external code contributions.** That is about maintainer time, not
about anyone's work — reviewing changes to an extension that reads private
conversations is a commitment the owner cannot make right now, and it seems
better to say so than to leave pull requests unanswered.

Bug reports and security reports are very welcome, and reports of a retrieval
failure are the most useful of all. [CONTRIBUTING.md](CONTRIBUTING.md) explains
how to write one — and please read the note about never sending real
conversation data, which applies to screenshots too.

Forks are welcome under the licence. A fork is your software, not an official
Chat Threads release, and it cannot alter anyone's installed copy. What counts
as an official release is set out in
[docs/RELEASE-SECURITY.md](docs/RELEASE-SECURITY.md).

## Roadmap

Ideas, not commitments:

- Live testing against a real Claude account, and against the current
  `activeTab` permission model.
- Still images of individual views, alongside the demo at the top.
- Remembering the working state across a panel close.
- Reordering turns within a generated conversation.
- Search within a loaded conversation.
- More providers, once the adapter contract has proven itself against two.

Deliberately out of scope: a Chat Threads account, cloud storage, a backend,
analytics, or turning this into a general-purpose AI chat client.

## Patent Pending

Certain technology implemented in Chat Threads is the subject of a U.S.
provisional patent application filed August 20, 2026.

## Licence

MIT — see [LICENSE](LICENSE).
