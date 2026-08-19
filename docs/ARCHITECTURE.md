# Architecture

Chat Threads has one structural idea, and everything else follows from it:

> The conversation you retrieved is a record. The conversation you are editing
> is a copy. They are different objects, and the first one is frozen.

That is what makes "your original chat is never touched", "reset changes" and
"restore original text" true by construction rather than by carefulness.

## The four layers

```
        ChatGPT page                  Claude page
              │                             │
   ┌──────────┴─────────┐        ┌──────────┴─────────┐
   │  ChatGptAdapter    │        │   ClaudeAdapter    │   Layer 1
   │  api / normalize   │        │  api / normalize   │   provider-specific
   │  / dom fallback    │        │  / dom fallback    │
   └──────────┬─────────┘        └──────────┬─────────┘
              └─────────────┬───────────────┘
                            ▼
              ┌───────────────────────────┐
              │   SourceConversation      │             Layer 2
              │   Turn[]  (frozen)        │             common model
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │   WorkingState            │             Layer 3
              │   turns, topics           │             operations
              │   exclude / edit / assign │
              │   generate transcripts    │
              └─────────────┬─────────────┘
                            ▼
              ┌───────────────────────────┐
              │   Side panel (React)      │             Layer 4
              │  Prompts Clean Split Out  │
              └───────────────────────────┘
```

Below the line marked "common model", code knows about ChatGPT and Claude.
Above it, nothing does. The only trace of origin that survives is the
`provider` field on a turn, used for a label and for naming the adapter in an
error message.

## Layer 1 — adapters

`src/adapters/types.ts` defines the contract:

```ts
canHandle(url)                  // is this my site?
getConversationIdentity(url)    // which conversation, without loading it
loadConversation(url)           // retrieve + normalize, or describe the failure
getRetrievalStatus()            // how the last load went
```

Each adapter is three files plus an entry point:

- `api.ts` — how to ask the provider for a conversation.
- `normalize.ts` — a **pure** function from the provider's payload to the
  common representation. This is what the tests drive; it needs no browser and
  no network.
- `dom.ts` — a last-resort read of the rendered page.
- `index.ts` — ties them together and converts every failure into an
  `AdapterFailure` that names the file to repair.

Adding a provider means adding a folder and one line in `registry.ts`.

### How retrieval actually works

The content script runs on the provider's own origin. Chrome's documented
behaviour is that a content script's `fetch` goes out on the host page's
origin, so a request to the provider's own conversation endpoint is same-origin
and carries the session the user is already signed in with.

That choice has two consequences worth stating:

- **No credential is ever read, stored or moved.** The browser attaches the
  session itself. For ChatGPT, an access token is fetched from the page's own
  session endpoint, used for exactly one request, and never leaves the function
  scope in `api.ts`.
- **The service worker stays trivial.** It opens the panel and reports the
  active tab. It never touches conversation data, so there is nothing sensitive
  in the most broadly-scoped part of the extension.

Both endpoints are undocumented. See [LIMITATIONS.md](LIMITATIONS.md).

### Active branch reconstruction

Both providers store a conversation as a message tree plus a pointer to the
leaf currently on screen. `src/adapters/branch.ts` walks from that leaf to the
root and reverses the path.

The important part is what it does when it *cannot*: a missing leaf pointer, a
dangling parent or a cycle produce `reliable: false` and a warning, and the
adapter downgrades completeness from `complete` to `unverified`. A guessed
branch is a real conversation, but not necessarily the one the user is looking
at, so it is never reported as complete.

### What is deliberately not retrieved

Model reasoning (ChatGPT `thoughts` / `reasoning_recap`, Claude `thinking`),
tool calls and their results, system messages, and anything the provider marks
as hidden from the transcript. These are listed explicitly in each
`normalize.ts` as *known* skips, which means an *unknown* message type still
produces a warning. That distinction is what stops a future format change from
looking like normal operation.

## Layer 2 — the common model

`src/model/types.ts`. A `Turn` carries both `originalText` (written once, never
again) and `workingText` (what the user edits), along with `included`,
`assignment`, `edited`, `uncertain` and `assignmentOverridden`.

Keeping edit state on the turn rather than in a side table means there is one
place to look for "what will happen to this turn", and no way for two
structures to disagree.

`RetrievalStatus` is part of the model rather than an afterthought, because
"how much of this conversation do we actually have" is information the user
needs, and burying it would make it easy to quietly stop reporting.

`src/model/messages.ts` validates everything crossing an extension boundary.
Objects are rebuilt field by field rather than cast, so nothing unexpected
travels with them.

## Layer 3 — operations

`src/operations/working.ts` holds `WorkingState` and every operation on it. All
of them are pure: take a state, return a new one. There is no store, no
observable, no reducer framework — the side panel keeps one `WorkingState` in
`useState` and replaces it.

That is deliberate. The state is small, the operations are total, and a pure
function is far easier to test than a subscription graph.

`src/operations/transcript.ts` turns a `WorkingState` into one or more
`GeneratedConversation`s and renders them. Rendering only ever selects, orders
and prints working text verbatim; it never summarizes or rewrites. The preview
and the clipboard call the same renderer with the same options, which is why
what you read is what you paste.

### The Shared rule

A turn has exactly one assignment. `Shared` means "include this complete turn
in every topic conversation", `Unassigned` means "include it in none". Both are
documented in the README because they are the two places a user could otherwise
lose material without noticing — which is why the Output tab warns when
included turns are unassigned.

## Layer 4 — AI, and why it is a peer rather than a foundation

`src/ai/` is a leaf, not a dependency. `operations/` does not import it. The
entire manual workflow — load, inspect, exclude, edit, split, generate, copy —
runs with the AI code never executing.

The contract is `TopicAnalyzer`: one method, in, out. `MockAnalyzer` implements
it for tests, so the whole proposal path is covered without credentials.

A proposal is not a separate state. `applyProposal` writes into the same topic
list and the same per-turn assignments the manual controls use, namespacing the
model's topic ids so they cannot collide. Manual edits therefore override the
model by simply being later writes, and `assignmentOverridden` records that a
person made the call.

Validation lives in `src/ai/schema.ts` and is strict: unknown turn numbers,
unproposed topics, duplicate or reserved ids, and control characters in names
are all handled explicitly. Anything that fails wholesale is rejected without
touching the conversation.

## Layer 5 — the side panel

React, because four views over one state object with inline editing is exactly
the case where hand-rolled DOM updates get fiddly. No state-management library:
one `useState` holding a phase union, and pure operations to produce the next
value.

The panel's job in the failure cases is to be specific — "Open a ChatGPT or
Claude conversation", "No active conversation found", "Reload the page to
continue", or a named adapter failure with diagnostics — rather than to show a
spinner and hope.

## Build

Chrome wants three different shapes, so the build produces three:

- Vite bundles the React panel to `dist/sidepanel.html` + `assets/`.
- esbuild bundles the service worker and content script as classic IIFE
  scripts, because content scripts cannot be ES modules.
- `manifest.json` and the icons are copied across, with the version taken from
  `package.json` so there is one number to bump.

Icons are generated by `scripts/make-icons.mjs` rather than committed as
opaque binaries, so the artwork is reviewable and reproducible.
