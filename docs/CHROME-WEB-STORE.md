# Chrome Web Store submission

Everything the Chrome Web Store asks for, written out so it can be pasted
rather than improvised, and kept in the repository so that what was submitted
stays checkable against the code that was submitted.

**Prepared for:** version 1.0.1
**Last reviewed:** 24 August 2026

Version 1.0.0 is published and live. This document now describes the 1.0.1
update. It fixes two things and adds one: Find Topics could not analyse a very
long conversation and the error it showed pointed at the wrong cause, and there
is now a branch-point indicator for ChatGPT conversations created with "Branch
in new chat". No permission changes, no new hosts, and no change to what leaves
the machine — branch detection is entirely local and needs no API key.

Nothing here is a claim the code does not already support. Where a statement
could be doubted, the file that makes it true is named.

---

## 1. The package

Build it with:

```bash
npm run package
```

That produces `chat-threads-<version>.zip` at the repository root. The script
(`scripts/package-store.mjs`) builds with source maps disabled, then refuses to
write the archive unless `dist/` contains exactly ten expected files and
nothing else — no source, no maps, no tests, no keys, no `node_modules`. The
archive uses a fixed timestamp, so the same commit produces a byte-identical
file and a submission can be checked against the source it claims to come from.

Contents of the 1.0.1 package (339,094 bytes uncompressed, 97,566 bytes
archived — 95 KB):

| File | Bytes |
| --- | --- |
| `manifest.json` | 1,203 |
| `sidepanel.html` | 379 |
| `background.js` | 47,635 |
| `content.js` | 47,104 |
| `assets/index.js` | 231,241 |
| `assets/index.css` | 9,813 |
| `icons/icon-16.png` | 149 |
| `icons/icon-32.png` | 236 |
| `icons/icon-48.png` | 335 |
| `icons/icon-128.png` | 999 |

SHA-256 of `chat-threads-1.0.1.zip`:
`ab2a52b0087f3c32bb59ff8de7773320ea9dc0fe03f30657e8ef5d3a37838535`

The zip file is not committed: `.gitignore` excludes `*.zip`, because a build
artifact that can be reproduced from source does not belong in history.

---

## 2. Store listing

### Item name

```
Chat Threads
```

12 characters (limit 75).

### Summary — the short description

```
Clean, edit and split long ChatGPT and Claude conversations, then copy the result into a new chat. Your original is untouched.
```

126 characters (limit 132).

### Description — the detailed description

```
Chat Threads is a side panel that reshapes a long ChatGPT or Claude conversation into something you can carry forward.

Long chats drift. You start on one thing, wander into two others, paste something you would rather not keep, and lose patience with the model somewhere in the middle. When you want to continue that work in a fresh chat, you have to bring the context with you — including the parts you do not want.

Chat Threads gives you a working copy of the conversation and four views of it.

PROMPTS
Read back only what you asked, in order, with each reply one click away. A quick way to find your place in a conversation of several hundred turns.

CLEAN
Exclude whole turns, or edit a turn to cut one paragraph and keep the rest.

SPLIT
Assign each turn to a topic, so one conversation becomes several. Mark a turn Shared to put it in every topic; leave one Unassigned to drop it from all of them. Review a topic before you take it out.

OUTPUT
Copy the result to the clipboard, or download it as Markdown, plain text or JSON — either the whole cleaned conversation or one topic on its own. Paste it into a new chat and continue from there.

FIND WHERE A CHAT WAS BRANCHED
If you started a ChatGPT conversation with "Branch in new chat", Chat Threads shows which turn it branched from and takes you straight there, with a badge on the turn itself. Hundreds of turns later that boundary is very hard to find by hand, and the browser's own Find cannot reach it. This reads ChatGPT's own record of the branch, runs entirely on your machine, and needs no API key.

YOUR ORIGINAL CONVERSATION IS NEVER CHANGED
Chat Threads only ever reads from ChatGPT and Claude. The conversation it retrieves is frozen in memory the moment it loads, and every edit applies to a separate copy. Nothing is written back.

NO SERVER, NO ACCOUNT, NO TELEMETRY
There is no Chat Threads server and no Chat Threads account. Reading, cleaning and splitting all run in your browser and make no network requests at all. No analytics, no crash reporting, no usage counters, no advertising, no third-party scripts.

NO STANDING ACCESS TO ANY SITE
Chat Threads asks for no host permissions when you install it. It cannot read ChatGPT, Claude or anything else until you click its toolbar icon on a tab, and that access ends when you navigate away. If you would rather not click each time, you can grant ongoing access to the two provider sites from inside the panel, and take it back from Chrome's extension settings.

FIND TOPICS IS OPTIONAL
Everything above works with no API key. Find Topics is a separate button that asks a model to propose the topic split for you. It runs only when you press it, only with an API key you supply, and it sends the turns you have kept to Anthropic or OpenAI — whichever you chose. A conversation too long to fit in one request is divided into sections and sent in several requests to that same provider, and the panel tells you how many before you press the button. Before you press it, the panel also names the host it will contact and roughly how many characters it will send, and a run can be stopped while it is going. Your key is held in session storage and forgotten when you close Chrome, unless you tick the box to remember it.

WHAT IT DOES NOT DO
It does not read attachment or image contents, only file names. It does not read model reasoning, system prompts or custom instructions. It does not save your working copy — copy what you want before you close the panel.

A NOTE ON RELIABILITY
Chat Threads reads conversations through interfaces that ChatGPT and Claude do not publish, so a change on their side can break retrieval. When that happens the panel names the part that failed rather than showing you a conversation with pieces missing.

OPEN SOURCE
The source is public and the privacy policy names the file behind each claim.
https://github.com/onyourmark/chat-threads

Chat Threads is an independent project. It is not affiliated with, endorsed by or connected to OpenAI or Anthropic. ChatGPT and Claude are the trademarks of their respective owners.

Certain technology implemented in Chat Threads is the subject of a U.S. provisional patent application filed August 20, 2026.
```

### Category

**Workflow & Planning.** The extension exists to reorganise material a user
already has into a form they can work from next. *Tools* is the reasonable
second choice if that reads better in the dashboard's own wording.

### Language

**English (United Kingdom)**, matching the spelling used throughout the
listing and the documentation. English (United States) would be equally
acceptable; the choice sets the default locale, not who can see the listing.

### URLs

| Field | Value |
| --- | --- |
| Homepage URL | `https://github.com/onyourmark/chat-threads` |
| Support URL | `https://github.com/onyourmark/chat-threads/issues` |
| Privacy policy URL | `https://github.com/onyourmark/chat-threads/blob/main/PRIVACY.md` |

All three were checked anonymously and returned HTTP 200 on 20 August 2026.

### Mature content

No.

---

## 3. Graphics

All prepared, in `docs/assets/store/`.

| Asset | Size | File | Required? |
| --- | --- | --- | --- |
| Store icon | 128 × 128 | `store-icon-128.png` | Required |
| Screenshot 1 | 1280 × 800 | `screenshot-1.png` | At least one required |
| Screenshot 2 | 1280 × 800 | `screenshot-2.png` | Optional |
| Screenshot 3 | 1280 × 800 | `screenshot-3.png` | Optional |
| Screenshot 4 | 1280 × 800 | `screenshot-4.png` | Optional |
| Screenshot 5 | 1280 × 800 | `screenshot-5.png` | Optional |
| Small promo tile | 440 × 280 | `promo-small-440x280.png` | Needed for any store promotion |
| Marquee promo tile | 1400 × 560 | `promo-marquee-1400x560.png` | Needed only for featured placement |

All are 8-bit RGB PNGs with no alpha channel.

The screenshots show the real side panel. Each was captured from the built
extension bundle (`dist/assets/index.js`, the same file that ships in the
package) driven against a synthetic conversation, at the width the panel
actually opens at. The interface in the image is unretouched; only the
surrounding canvas and the caption beside it were added. The conversation shown
is invented for the purpose — no real chat appears in any asset.

---

## 4. Privacy practices

### Single purpose

```
Chat Threads has one purpose: to let a user reshape a ChatGPT or Claude conversation they are already viewing, and export the result so they can continue it in a new chat.

That means reading back their own prompts, excluding or editing individual turns, and dividing one conversation into separate topic conversations. Every feature in the extension serves that one purpose, and the extension does nothing at all on any other website.

It reads from ChatGPT and Claude and never writes to them. The retrieved conversation is frozen in memory when it loads (freezeConversation in src/model/conversation.ts); all editing happens on a separate working copy.
```

### Permission justifications

**`sidePanel`**

```
The extension's entire interface is Chrome's side panel, opened next to the conversation being reshaped. This permission is what lets the extension open it.
```

**`storage`**

```
Used only by the optional Find Topics feature, for two small values: the model provider and model name the user chose, and the user's own API key.

The key is written to chrome.storage.session by default, so Chrome discards it when the browser closes. It goes to chrome.storage.local only if the user ticks "remember this key on this computer", and a "Forget key" button removes it. The key is never synced, never passed to the service worker or a content script, and never included in any internal message (src/sidepanel/settings.ts).

No conversation content is ever stored. If the user never opens Find Topics, the extension writes nothing at all.
```

**`activeTab`**

```
The extension must read the conversation from the ChatGPT or Claude page the user is looking at.

activeTab is used deliberately in place of standing host permissions, so that access begins at the user's click on the toolbar icon and ends when they navigate away. Before that click the extension cannot read the page or even see its address.

activeTab is also how the extension learns the tab's URL, which is what tells it whether ChatGPT or Claude is open. This is why the extension does not request the "tabs" permission.
```

**`scripting`**

```
Used to inject the reader script (content.js) into the one tab on which the user has just invoked the extension. The script asks the provider's own page for the conversation the user is viewing and hands it back to the side panel.

Nothing is injected until the user clicks the toolbar icon. On its own this permission grants no access to any site.
```

**Host permissions**

```
The extension requests no host permissions at install time. Chrome's extension details page shows no "read and change your data on" entry for any site, and site access set to "on click".

Five origins are declared as optional_host_permissions and requested only at the moment they are needed:

https://chatgpt.com/*, https://chat.openai.com/*, https://claude.ai/* — requested only if the user chooses, from inside the panel, to grant ongoing access so they no longer have to click the toolbar icon on every visit. The extension is fully usable without this; it is a convenience the user opts into and can revoke from chrome://extensions.

https://api.anthropic.com/*, https://api.openai.com/* — requested the first time the user uses the optional Find Topics feature, so the side panel can send the conversation to the model provider the user selected, with the user's own API key. That is one request for an ordinary conversation; a conversation too long for a single request is divided into sections and sent in several bounded requests to the same host, and the panel states how many before the user confirms. Not requested at any other time, and not requested at all if the feature is never used.

The extension does not request <all_urls>, tabs, history, cookies, downloads, webRequest or bookmarks.
```

### Remote code

**Answer: No, I am not using remote code.**

Supporting statement, if a justification field is offered:

```
All JavaScript in the package is bundled from the project's own source at build time. The extension loads no script from any remote server.

Its extension_pages content security policy is "script-src 'self'; object-src 'self'". The package contains no eval(), no new Function(), no importScripts() and no dynamically created script elements.

The extension does make network requests, but they fetch data, never code: (a) same-origin JSON reads issued from inside the provider's own page to load the conversation the user is viewing, and (b) the optional Find Topics request to api.anthropic.com or api.openai.com.
```

### Data use — what to declare

| Category | Answer | Why |
| --- | --- | --- |
| Personally identifiable information | **No** | No name, address, email, age or identifier is read, stored or sent. |
| Health information | **No** | — |
| Financial and payment information | **No** | No payment path of any kind. |
| Authentication information | **Yes** | Two things fall under this and both should be declared. The user's own model-provider API key is stored locally and transmitted to the provider they chose. Separately, on ChatGPT the extension asks that page's own `/api/auth/session` endpoint for the short-lived access token the ChatGPT web app itself uses, and attaches it to the single request that loads the conversation; it is held in one local variable and discarded, never stored and never sent anywhere but back to ChatGPT. |
| Personal communications | **Yes** | Conversation turns are personal communications. They are read into the side panel, and the kept turns are transmitted if — and only if — the user presses Find Topics. |
| Location | **No** | — |
| Web history | **No** | The extension reads the URL of the one tab it was invoked on, transiently, to identify the provider. It does not read, store or transmit a list of visited pages, and holds no history permission. |
| User activity | **No** | No click, keystroke, scroll or network monitoring. |
| Website content | **Yes** | Conversation text and titles are read from chatgpt.com, chat.openai.com and claude.ai. |

### Certifications — all three apply

- I do not sell or transfer user data to third parties, apart from the
  approved use cases. **Yes.**
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose. **Yes.**
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes. **Yes.**

The one outbound transfer of conversation content — Find Topics — is initiated
by the user, goes to a provider the user names, uses a key the user supplies,
and exists to serve the item's single purpose. No data of any kind reaches the
developer.

---

## 5. Notes for the reviewer

To be pasted into the reviewer-notes or test-instructions field at submission.

```
Chat Threads is open source: https://github.com/onyourmark/chat-threads

WHAT IT IS
A side panel that reads the ChatGPT or Claude conversation in the current tab, lets the user remove or edit turns and divide the conversation into topics, and exports the result as text to paste into a new chat. It reads only; it never writes back to ChatGPT or Claude.

NO TEST ACCOUNT IS SUPPLIED, AND NONE IS NEEDED FOR MOST OF IT
The extension has no account system of its own. It reads conversations using the browser's existing session on chatgpt.com or claude.ai, so any account you already have works. There is nothing to sign into in the extension.

HOW TO TEST — CHATGPT
1. Sign in at https://chatgpt.com and open any conversation with several turns.
2. Click the Chat Threads toolbar icon. The side panel opens and loads that conversation. (The icon click is required: the extension holds no host permissions and uses activeTab, so it has no access before you click.)
3. The header shows the provider, the number of turns, and a retrieval status.

HOW TO TEST — CLAUDE
Repeat the above at https://claude.ai on any conversation. The panel behaves the same way.

HOW TO TEST CLEANING AND SPLITTING — NO API KEY REQUIRED
This is the whole extension apart from one optional button, and none of it makes any network request.
1. "Prompts" shows only the user's own turns, with "Show reply" beside each.
2. "Clean" — press "Exclude" on any turn, or "Edit" to change the working copy of one. The footer count updates.
3. "Split" — press "Add topic", name it, then use the "Goes to" dropdown on each turn to assign it. "Shared" puts a turn in every topic; "Unassigned" puts it in none. "Review" opens a topic to check before exporting.
4. "Output" — "Copy", "Preview", "Download .md" and ".json" are offered for the cleaned conversation and for each topic.
5. Reload the ChatGPT or Claude tab and confirm the original conversation is unchanged. It always will be: the extension issues read requests only, and the retrieved conversation object is frozen in memory (freezeConversation, src/model/conversation.ts).

FIND TOPICS IS OPTIONAL AND OFF UNLESS YOU SUPPLY A KEY
"Find Topics" is the only feature that sends anything anywhere. It is collapsed by default and labelled Optional.
- With no key: press "Set up" to expand it and then "Send and find topics". The panel replies "Enter an API key first." and makes no network request. Nothing leaves the browser.
- With a key: paste any Anthropic or OpenAI API key of your own into "Your API key". Chrome will then prompt for the optional host permission for api.anthropic.com or api.openai.com — that permission is not held until this point. The panel states, before you press the button, which host it will contact and roughly how many characters it will send. Only kept turns are sent, truncated to 1,500 characters each; excluded turns and text edited out are not sent.
- On a very long conversation, one request would exceed what a model can read. The panel works this out before sending anything, says how many sections and roughly how many requests it will take, and then makes those requests one after another to the same host, showing which section it is on and offering a Stop button. No other host is contacted, and nothing beyond the kept turns is sent.
- No key is embedded in the extension or in the repository, by design. If you would prefer to test with a key we provide rather than one of your own, please ask and we will supply one through the dashboard's test-credentials field.

PERMISSIONS
No host permissions are held at install time. activeTab plus scripting are what let the panel read the one tab you invoked it on. The five origins in optional_host_permissions are requested at the moment of use and are individually declined-able; the extension's core function continues to work if they are declined.

PRIVACY
No server, no account, no analytics, no telemetry, no remote code. Full policy: https://github.com/onyourmark/chat-threads/blob/main/PRIVACY.md

KNOWN LIMITATION, STATED HONESTLY
ChatGPT and Claude do not publish the interfaces this extension reads from, so a change on their side can break retrieval. The panel is built to name the part that failed rather than display a partial conversation. See https://github.com/onyourmark/chat-threads/blob/main/docs/LIMITATIONS.md
```

---

## 6. Distribution

- **Visibility:** Public.
- **Regions:** All.
- **Pricing:** Free.

---

## 7. What was checked before submission

Run on 24 August 2026 against the commit that produced the 1.0.1 package.

| Check | Result |
| --- | --- |
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm test` | 460 tests in 21 files, all passing |
| `npm run package` | 10 files, allow-list and forbid-list both satisfied |
| Source maps in package | None; no `sourceMappingURL` in any shipped file |
| Credential scan, working tree | Nothing found |
| Credential scan, all git blobs in history | Nothing found |
| Credential scan, shipped bundles | Nothing found |
| `.pem` / `.p12` / `.key` / `.env` tracked | None |
| `eval` / `new Function` / `importScripts` / injected scripts in package | None |
| Absolute URLs in package | `api.openai.com`, `api.anthropic.com`, the three provider origins, plus the W3C SVG namespace and React's error-message link. No analytics host. |
| Runtime dependencies shipped | `react`, `react-dom`. Nothing else. |
| Declared permissions all used | Yes — every optional origin has a `permissions.request` call site |
| Listing URLs reachable anonymously | All 200 |
