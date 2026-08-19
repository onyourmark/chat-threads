# Contributing

Thanks for looking at Chat Threads. Please read the first section before
opening anything — it will save you time.

## How this project accepts contributions

**Chat Threads is public source, but it is not currently accepting pull
requests or other external code contributions.**

That is a decision about maintainer time, not about the quality of anyone's
work. Reviewing, testing and taking responsibility for other people's changes
to an extension that reads private conversations is a real ongoing commitment,
and the owner is not in a position to make it. Rather than leave pull requests
sitting unanswered for months, the project says so up front.

Concretely:

| You want to | Please |
| --- | --- |
| Read, audit or learn from the code | Go ahead — that is why it is public |
| Fork it and change it | Go ahead, under the terms of the [licence](LICENSE) |
| Report a security problem | Yes please — see [SECURITY.md](SECURITY.md) |
| Report a reproducible bug | Yes please — see below |
| Send a pull request | Please don't; it will be closed unread, with no offence meant |
| Become a maintainer | The project is not adding maintainers |

Pull requests may be closed without review. This is not a judgement on the
change; it is the policy applying evenly.

### Forks

Forks are welcome and are what the licence is for. Two things to be clear
about:

- **A fork is not Chat Threads.** It is your software, published under your
  name, and it is not an official release. Please do not present it as one.
- **A fork cannot change anyone's installed copy of Chat Threads.** Chrome ties
  an installed extension to whoever published it. A fork you publish is a
  separate extension that a user would have to choose to install. There is no
  route by which forked code reaches an existing installation.

What counts as an official release, and who authorises one, is written down in
[docs/RELEASE-SECURITY.md](docs/RELEASE-SECURITY.md).

## Never send real conversation data

This matters more here than in most projects, because the natural way to
describe a retrieval bug is to paste the conversation that broke it. Please
don't.

- Test fixtures are hand-written and synthetic. `tests/fixtures/` contains no
  real conversation, and must continue not to.
- When reporting a bug, redact. The extension tells you which adapter failed
  and why without needing the text — paste that instead.
- The same applies to screenshots. A screenshot of the side panel is a
  screenshot of your conversation.

## Reporting a bug

The most useful report is a retrieval failure, because provider changes are the
likeliest thing to break.

When retrieval fails, the panel shows the adapter that failed, a reason code,
and the source file to look at. Please include:

1. Which provider, and roughly what the conversation contained — long?
   branched? attachments? code? — **not** the conversation itself.
2. The full text of the error box, including the diagnostics list.
3. Whether the panel said the result was complete, unconfirmed or incomplete.
4. Your browser and version.

If retrieval *succeeded* but the transcript was wrong — missing turns, the
wrong branch, jumbled order, raw provider markers showing through — say what
you expected and what you got, again without pasting the conversation.

## Security reports

Do not open a public issue. Use the process in [SECURITY.md](SECURITY.md).

## Building it yourself

```bash
npm install
npm run icons
npm run build       # writes the unpacked extension to dist/
npm run check       # lint, typecheck, test, build
```

Load `dist/` as an unpacked extension with Developer mode on. After each
rebuild, reload the extension, then reload the ChatGPT or Claude tab.

## If you are reading the code

The layering is the point, so here is the map:

| Concern | Where |
| --- | --- |
| A provider changed its format | `src/adapters/<provider>/` only |
| Provider-private marker syntax | `src/adapters/chatgpt/references.ts` |
| Exclusion, editing, topic assignment | `src/operations/working.ts` |
| Transcript generation | `src/operations/transcript.ts` |
| The model-proposal contract | `src/ai/schema.ts` |
| Interface | `src/sidepanel/` |

Two invariants hold everywhere:

1. **Nothing above `src/adapters/` knows which provider a conversation came
   from**, beyond the `provider` field on a turn.
2. **A `SourceConversation` is never mutated.** It is frozen; edits go to the
   working copy. Every guarantee the product makes about leaving the original
   conversation alone depends on this.

If either of those looks violated, that is worth reporting as a bug.

## Scope

In scope: retrieval, the working copy, cleaning, editing, splitting, transcript
generation, accessibility, and honesty about failure.

Out of scope: accounts, cloud sync, a backend, analytics, billing,
collaboration, summarising a conversation *instead of* preserving it, or
anything that writes back to the user's ChatGPT or Claude account.
