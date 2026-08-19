# Contributing

Thanks for looking. This is a small, deliberately narrow project: it takes an
existing AI conversation and lets someone reshape a copy of it. Contributions
that make that work better are very welcome. Contributions that turn it into a
general-purpose AI client are not — see the scope note at the end.

## Never commit real conversation data

This matters more here than in most projects, because the natural way to debug
a retrieval bug is to paste the conversation that broke it. Please don't.

- Test fixtures are hand-written and synthetic. `tests/fixtures/` contains no
  real conversation, and must continue not to.
- When reporting a bug, redact. The adapter tells you which file failed and why
  without needing the text — paste that instead.
- If you need a fixture for a new case, write one that demonstrates the
  *structure*, with invented content.

## Getting set up

```bash
npm install
npm run icons
npm run build
npm run check    # lint, typecheck, test, build
```

Load `dist/` as an unpacked extension at `chrome://extensions` with Developer
mode on. After each rebuild, press reload on the extension card, then reload the
ChatGPT or Claude tab.

## Reporting a retrieval failure

This is the most useful bug report you can file, and the most likely one.

When retrieval fails, the side panel shows the adapter that failed, a reason
code, and the source file to look at. Please include:

1. Which provider, and roughly what the conversation contained (long? branched?
   attachments? code?) — **not** the conversation itself.
2. The full text of the error box, including the diagnostics list.
3. Whether the panel said the result was complete, unconfirmed or incomplete.
4. Your Chrome version.

If retrieval *succeeded* but the transcript was wrong — missing turns, the wrong
branch, jumbled order — say what you expected and what you got, again without
pasting the conversation.

## Where to make a change

The layering is the point of the codebase, so please keep changes in the right
place:

| Change | Where |
| --- | --- |
| A provider changed its format | `src/adapters/<provider>/` only |
| Supporting a new provider | A new folder under `src/adapters/`, plus one line in `registry.ts` |
| How turns are excluded, edited, assigned | `src/operations/working.ts` |
| How transcripts are produced | `src/operations/transcript.ts` |
| The model-proposal contract | `src/ai/schema.ts` |
| A new model provider | `src/ai/providers/` |
| Interface | `src/sidepanel/` |

Two rules hold everywhere:

1. **Nothing above `src/adapters/` may know which provider a conversation came
   from**, beyond the `provider` field on a turn. If you find yourself writing
   `if (provider === 'chatgpt')` in `operations/` or `sidepanel/`, the fix
   belongs in an adapter.
2. **Never mutate a `SourceConversation`.** It is frozen; write to the working
   copy. Every guarantee the product makes about the original conversation
   depends on this.

## Style

- TypeScript, strict mode. No `any` — the lint rule is an error, not a warning.
- Comments explain *why*, not *what*. Match the density of the surrounding file.
- Prefer a pure function returning new state over a mutation.
- User-facing strings are plain English. No jargon, no error codes shown as
  prose, no blame. "Reload the page to continue", not "Content script handshake
  failed".

## Tests

`npm run test`. New behaviour needs a test; a bug fix needs a test that fails
before it.

Tests must never require a live account, a network connection, or an API key.
The AI path is exercised end to end with `MockAnalyzer`, and provider retrieval
is exercised through the pure `normalize*` functions against fixtures. If you
add a case a fixture does not cover — a new content type, a new branching
shape — add the fixture too.

If you have a live account and can run the manual procedure in
[docs/MANUAL-TESTING.md](docs/MANUAL-TESTING.md), reporting the results is
genuinely valuable; those steps are currently unverified.

## Commits and pull requests

- Conventional-ish prefixes: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- One coherent change per commit; please don't mix a refactor with a fix.
- Run `npm run check` before opening a PR. CI runs the same thing.
- Say what you tested, and be explicit about what you could not test.

## Scope

In scope: retrieval, the working copy, cleaning, editing, splitting, transcript
generation, adapters for more chat sites, accessibility, and honesty about
failure.

Out of scope: accounts, cloud sync, a backend, analytics, billing,
collaboration, summarizing a conversation *instead of* preserving it, or
anything that writes back to the user's ChatGPT or Claude account.

If you are unsure whether an idea fits, open an issue before building it.
