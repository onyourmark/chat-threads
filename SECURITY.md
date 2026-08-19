# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a
vulnerability** button on the Security tab of
https://github.com/onyourmark/chat-threads, rather than opening a public issue.

Include what you did, what happened, and what you expected. If a proof of
concept involves a conversation, please redact it — see the note on real
conversation data in [CONTRIBUTING.md](CONTRIBUTING.md).

This is a small unfunded project; expect a best-effort response rather than a
guaranteed timeline.

## Threat model

Chat Threads runs inside a page it does not control, handles text written by
other people, and can be asked to talk to a model API. The assumptions are:

1. **Conversation text is untrusted.** A conversation may contain markup,
   scripts, control characters, or text engineered to look like part of the
   extension's own output.
2. **The provider's response is untrusted.** It may be malformed, may change
   shape without warning, or may not be what we expect at all.
3. **Model output is untrusted.** A model may return prose instead of JSON,
   invent turn numbers, or emit hostile strings.
4. **The page is untrusted.** Anything running on chatgpt.com or claude.ai
   shares the DOM with the content script.

The user's own provider session is trusted — Chat Threads rides it but never
reads, stores or transmits it.

## How each risk is handled

### Cross-site scripting and HTML injection

Conversation text never becomes markup. The side panel renders every piece of
conversation text as React text children, which reach the DOM as `textContent`.
There is no `dangerouslySetInnerHTML` anywhere in the codebase, and no Markdown
renderer — the preview shows the transcript source in a `<pre>` block, which is
also exactly the text that gets copied.

Markdown is *preserved* in the output (fences, tables and emphasis survive
verbatim) but is never *rendered* as HTML. That removes the entire class of
Markdown-renderer injection bugs rather than trying to sanitize around it.

Covered by `tests/security.test.ts`.

### Malformed provider responses

Adapters validate the payload's shape before use and throw a typed format error
naming what was missing. Unknown message types are counted and reported to the
user as a warning rather than silently dropped, so a format change is visible
instead of producing a quietly-truncated transcript.

### Malformed AI output

The model's reply is parsed as JSON — never evaluated — and then validated
against an explicit contract in `src/ai/schema.ts`. Topic ids must be unique
and must not use the reserved `shared` value; turn numbers must be ones we
actually sent; topic names are stripped of control characters and length
capped. A reply that fails validation is rejected wholesale with a readable
error and changes nothing. Assignments that are individually bad are dropped
and reported.

### Extension messaging

Every message crossing an extension boundary is validated in
`src/model/messages.ts` before it is dispatched or used. Both the background
worker and the content script check `sender.id === chrome.runtime.id` and
ignore anything else. Objects rebuilt from a message are constructed field by
field, so unexpected properties — including `__proto__` payloads — are dropped
rather than passed along.

### Secrets

No API key is ever placed in a content script, a service worker, or a message
between extension contexts. The key lives only in the side panel and in
`chrome.storage.session` unless the user opts into persistence. The ChatGPT
access token the adapter fetches to authorize its request stays inside one
function scope in `src/adapters/chatgpt/api.ts` and is never returned, logged,
or stored.

Inside the analyzers the key is held in a genuine private field (`#apiKey`),
not TypeScript's `private`, which is only a compile-time marker. That makes it
non-enumerable and absent from `JSON.stringify`, so serialising or logging an
analyzer cannot reveal it. `tests/api-key-security.test.ts` drives the real
provider clients against a stubbed `fetch` and asserts that the key reaches
exactly one host, in exactly one header, never the URL or body, and appears in
no error message on any failure path.

There are no `console` calls anywhere in `src/`, so there is no logging channel
for a secret to escape through.

No secret is committed to the repository, and there are no `.env` files.
`*.pem`, `*.crx` and `*.p12` are gitignored so release signing material cannot
be committed by accident — see [docs/RELEASE-SECURITY.md](docs/RELEASE-SECURITY.md).

### Remote code

None is loaded. The manifest's `content_security_policy.extension_pages`
restricts scripts to `'self'`, and `connect-src` is limited to the two model
API hosts. There is no `eval`, no `new Function`, and no remote script tag;
`no-eval` and `no-implied-eval` are enforced by lint.

### Permissions

The extension requests `sidePanel`, `storage`, `activeTab` and `scripting`, and
**no host permissions at all**. It therefore has no standing ability to read
any website; access to a provider tab begins when the user clicks the toolbar
icon and ends when they navigate away.

Ongoing access to the provider sites, and access to the model API hosts, are
*optional* permissions — declared so they can be requested, never held unless
the user grants them. There is no `<all_urls>`, no `tabs`, no `cookies`, no
`webRequest`, no `history` and no `downloads`.

`scripting` grants nothing by itself: it only allows injection into tabs the
extension already has access to, which is the invoked tab.

### The original conversation

The extension issues read requests only. The retrieved conversation is frozen
so that a write throws rather than corrupting the record of what the provider
actually said.

## Known accepted risks

- **Retrieval uses undocumented provider endpoints.** This is a functional
  fragility rather than a security hole — the requests are the same ones the
  page itself makes, on the user's own session — but it is stated plainly in
  [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- **The DOM fallback trusts page markup.** If structured retrieval fails, the
  extension reads rendered turns from the page. A hostile page could put
  arbitrary text into a turn. That text is still only ever handled as text, and
  the result is always flagged as incomplete.
- **File-reference names come from provider metadata.** ChatGPT supplies the
  file name that replaces a private marker. It is treated as untrusted input:
  control characters and marker delimiters are stripped, the length is capped,
  and it is rendered as text, never as markup. It is not otherwise verified —
  a name is what the provider said it was.
- **The `activeTab` retrieval path has not been exercised in a browser.**
  Neither Chrome 151 nor Edge 151 still honours `--load-extension`, so it could
  not be tested automatically. The permission reduction is verifiable by reading
  `manifest.json`; that the injection works end to end is not yet confirmed.
- **A user who opts into "remember this key" accepts on-disk storage** of their
  API key in `chrome.storage.local`, readable by anyone with access to the
  Chrome profile. The default is not to do this, and the interface says so.
