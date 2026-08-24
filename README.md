# Chat Threads

**Reshape your AI conversations.**

Long AI chats get messy. You start on one thing, drift into two others, paste
something you would rather not keep — and somewhere in the middle you lose
patience and tell the model exactly what you think of it.

Chat Threads is a side panel for Chrome and Edge that untangles one long AI
conversation into separate topic conversations. Clean up your act on the way
out: remove the rant, keep the useful context.

**Your original ChatGPT or Claude conversation is never changed.** Chat Threads
works on a copy.

**[Install from the Chrome Web Store](https://chrome.google.com/webstore/detail/hihenbieafdpckdchglnpidlgeiecpmm)** — or [build it from source](#for-developers-build-from-source).

![Four-step walkthrough of Chat Threads: a ChatGPT conversation mixing a book proposal, a browser extension and travel plans; the side panel finding those as three separate topics; the user reviewing one topic and choosing which turns to remove; and the finished clean conversations ready to copy.](docs/assets/chat-threads-demo.gif)

**What the demo shows.** A long conversation holds several unrelated
discussions. Chat Threads finds them. You review a topic and remove what you do
not want. You copy out clean conversations and carry on. The conversation in
the demo is invented for it — no real chat appears anywhere in this repository.

---

## Three things it does

### See only your prompts

Scan a long conversation quickly by reading only what *you* asked, with the
assistant's reply one click away when you want it.

### Remove unwanted context

Exclude whole turns, or edit the working copy of a turn to cut one paragraph
and keep the rest. Removing turns from a ChatGPT or Claude conversation here
never changes the conversation itself — only the copy you are about to carry
forward.

### Split one conversation into separate discussions

Assign turns to topics by hand, or press **Find Topics** and have a model you
choose propose the split. Review its choices, move anything it got wrong, and
generate separate conversations that are ready to continue.

Manual cleaning and splitting need no account, no API key and no network
requests. Find Topics is the one optional extra, and it only runs when you
press the button.

## How it works

**Open conversation → Reshape → Review → Copy → Continue**

1. Open a ChatGPT or Claude conversation.
2. Click the Chat Threads icon to open the side panel on that tab.
3. Read back your prompts, remove what you do not want, or separate the topics
   in a long AI chat.
4. Preview the result.
5. Copy the cleaned conversation, or one topic-specific conversation.
6. Paste it into a new AI chat and continue from clean context.

## Installation

### From the Chrome Web Store

**[Add Chat Threads to Chrome](https://chrome.google.com/webstore/detail/hihenbieafdpckdchglnpidlgeiecpmm)**

One click, and it updates itself. This is the way to install it unless you have
a reason to build from source. It works in Microsoft Edge too: Edge installs
Chrome Web Store extensions once you allow it from the banner Edge shows.

Then:

1. Open a ChatGPT or Claude conversation.
2. Click the Chat Threads toolbar icon. That one click both opens the side
   panel and gives Chat Threads permission to read that tab.

You will click the icon again after reloading the page, or on a different tab.
If you would rather not, the panel offers to let you grant ongoing access to
chatgpt.com and claude.ai, which you can revoke at any time.

Requires Chrome or Edge 116 or later (the side panel API).

### For developers: build from source

The extension also loads unpacked, which is what you want if you are changing
it or would rather run something you compiled yourself. About a minute, and
needs Node.js.

```bash
git clone https://github.com/onyourmark/chat-threads.git
cd chat-threads
npm install
npm run icons     # generates the extension icons
npm run build     # writes the unpacked extension to dist/
```

Or take the built `chat-threads-<version>.zip` from the
[latest release](https://github.com/onyourmark/chat-threads/releases/latest)
and unzip it — no Node.js, nothing to compile. The archive is reproducible:
running `npm run package` on the tagged commit produces a byte-identical file,
so you can check what you downloaded against the source it claims to come from.
The SHA-256 is published with the release.

Either way, load it:

1. Go to `chrome://extensions` — or `edge://extensions` in Microsoft Edge.
2. Turn on **Developer mode** (top right in Chrome, left sidebar in Edge).
3. Click **Load unpacked** and choose the folder — the one you unzipped, or
   the `dist/` folder the build created.

An unpacked extension does not update itself, and Chrome will remind you now
and again that developer mode is on. The Web Store install has neither.

## Private by design

Chat Threads has no backend, no analytics and no telemetry. It has no permanent
access to your browsing: it reads a conversation only after you explicitly
invoke it on that tab, and that access ends when you navigate away. Ordinary
cleaning and splitting happen entirely in your browser.

- **No standing access to any website.** Out of the box it cannot read ChatGPT,
  Claude or anything else until you click its toolbar icon on a tab. The
  browser's extension page should show no site permissions, and site access set
  to *on click*.
- **Nothing leaves your machine for ordinary use.** Reading, viewing, editing,
  excluding, splitting and generating transcripts are all local.
- **One optional outbound feature.** Find Topics sends the turns you kept to the
  model provider *you* choose, using *your* API key, and only when you press the
  button and grant permission. A conversation too long for one request is sent
  in several bounded requests to that same provider and nowhere else; the panel
  tells you how many before you press it. Nothing is sent because you opened the
  panel.
- **Your API key stays in memory** for the browser session unless you explicitly
  tick "remember this key".

[PRIVACY.md](PRIVACY.md) describes exactly what is read, stored and sent, and
names the code that makes each claim true. [SECURITY.md](SECURITY.md) covers the
threat model and how untrusted conversation text is handled.

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

Think of Chat Threads as a ChatGPT and Claude conversation editor that never
edits the original. You reshape a copy — clean the AI conversation context you
want to keep, split AI conversations that drifted into separate subjects — and
then continue a cleaned AI conversation in a fresh chat.

## Everything else it does

The three above are the reason to install it. The rest of what it does, in one
table:

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

**Long conversations.** A very long chat does not fit in one request — an
866-turn conversation is around 688,000 characters, well past what a model can
read at once. Chat Threads works this out before it sends anything and divides
the conversation into sections, then does three things: each section reports
the topics it contains, one request reconciles those lists into a single set
for the whole conversation, and each section is read again and sorted into that
set. That middle step is why you get one coherent list rather than "Chrome
extension publishing", "Web Store submission" and "Chrome Store setup" as three
separate topics.

You do not have to do anything differently: press the button and wait. The
panel says how many sections and roughly how many requests before you press it,
shows which section it is on while it runs, and has a Stop button. The 866-turn
example above comes to 15 sections and 31 requests. A conversation so large
that even this would be unreasonable is refused before anything is sent, rather
than turning into a hundred paid requests.

**Which key you need, and when.** Reading a conversation never needs one:
Chat Threads uses the ChatGPT or Claude session you are already signed in with.
An API key is only for Find Topics, and only for the provider you pick there.
The two choices are independent of where the conversation came from — you can
analyse a Claude conversation with an OpenAI key, and an Anthropic key is
required only if you choose Anthropic as the Find Topics provider.

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
- **Both providers are live-tested, on one account each.** ChatGPT retrieval and
  the whole reshaping workflow ran against a real account on a 449-turn
  conversation, and the transcript was successfully continued in a new ChatGPT
  chat. Claude retrieval has since been run against a real signed-in Claude
  conversation: Claude was recognised, the conversation loaded, and the normal
  workflow worked. That is one account per provider — it does not establish
  compatibility with every account type (Team, Enterprise and Edu are untested)
  or with future versions of either site.
- **AI topic proposals: OpenAI tested, Anthropic not.** A real OpenAI request
  produced usable topics, including for a conversation that came from Claude.
  One run was slow and appeared to retry before succeeding, and there is no
  retry logic of our own. The Anthropic client is implemented and unit-tested
  but has not been used with a real Anthropic key.
- **Find Topics can be slow on a long conversation.** A conversation that has
  to go in sections makes one request after another, which can take several
  minutes and costs more than a single request would. The panel says how many
  requests that will be before you start, shows progress, and can be stopped.
  It stays usable throughout, and the result is applied to the conversation it
  was started on even if you move around in the meantime.
- **Sectioned analysis is tested synthetically, not against a live long chat.**
  The 866-turn case is reproduced by a generated fixture and covered by tests
  end to end; the multi-request path has not been re-run against a real
  conversation of that size with a live key.
- **Attachments are referenced, not included.** A transcript notes that
  `spec.pdf` was attached, and an inline mention becomes
  `[Reference to attached file: spec.pdf]`; it does not contain the file.
- **Artifacts and canvas documents are not retrieved.** Only the conversation
  text is.
- **Model reasoning is deliberately not retrieved.** Extended thinking and
  chain-of-thought blocks are skipped by design.
- **Working state is not persisted.** Each tab and conversation keeps its own
  work, so moving between them is safe, but closing the panel or reloading a
  conversation discards it. Generate and copy before you finish.
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

Reports, on the other hand, are very welcome:

- **[Report a bug](https://github.com/onyourmark/chat-threads/issues/new?template=bug_report.yml)**
  when something behaves wrongly.
- **[Report a retrieval failure](https://github.com/onyourmark/chat-threads/issues/new?template=retrieval_failure.yml)**
  when a conversation will not load, or loads wrongly. This is the most useful
  report there is: ChatGPT and Claude can change their internals without
  notice, and the panel tells you exactly which part gave up.
- **Security problems go privately**, through GitHub's security advisories
  rather than a public issue — see [SECURITY.md](SECURITY.md).

Whichever you use, please do not include conversation content. Both templates
are written so you never need to, and a screenshot of the side panel is a
screenshot of your own conversation. [CONTRIBUTING.md](CONTRIBUTING.md) has the
detail.

Forks are welcome under the licence. A fork is your software, not an official
Chat Threads release, and it cannot alter anyone's installed copy. What counts
as an official release is set out in
[docs/RELEASE-SECURITY.md](docs/RELEASE-SECURITY.md).

## Roadmap


Ideas, not commitments:

- Live testing of Find Topics against the Anthropic provider, against more
  account types on both providers, and against a real conversation long enough
  to need the sectioned path.
- Still images of individual views, alongside the demo at the top.
- Remembering the working state across a panel close.
- Reordering turns within a generated conversation.
- Search within a loaded conversation.
- More providers — the adapter contract has now held up against two.

Deliberately out of scope: a Chat Threads account, cloud storage, a backend,
analytics, or turning this into a general-purpose AI chat client.

## Patent Pending


Certain technology implemented in Chat Threads is the subject of a U.S.
provisional patent application filed August 20, 2026.

## Licence


MIT — see [LICENSE](LICENSE).
