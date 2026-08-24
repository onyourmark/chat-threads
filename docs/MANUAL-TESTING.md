# Manual testing procedure

The automated tests cover normalization, editing, splitting, transcript
generation, AI proposal handling and security against fixtures. They
deliberately never touch a live account.

Record results as: step, expected, actual, pass/fail. Please redact
conversation content in anything you post publicly.

---

## Current status

| Area | Status |
| --- | --- |
| ChatGPT retrieval and the full reshaping workflow | **Passed** — tested live, see below |
| Claude retrieval | **Passed** — tested live against a real signed-in conversation |
| The `activeTab` permission model and tab binding | **Passed** — tested live in Microsoft Edge |
| OpenAI Find Topics | **Passed** — real API calls produced usable topics, including on a Claude conversation |
| Find Topics on a conversation too long for one request | **Not yet tested live** — covered end to end by tests against a generated 866-turn fixture; never run against a real conversation of that size with a key |
| Anthropic Find Topics | **Not yet tested** — needs a real Anthropic key |
| Raw file-reference markers | **Fixed, not yet re-tested live** |

### What was tested live, and passed

Tested in Microsoft Edge (Chromium) as an unpacked extension, against a real
signed-in ChatGPT account, on real conversations.

- ChatGPT was detected and a long conversation of roughly **449 turns** loaded.
- Retrieval reported itself **complete**.
- Messages that ChatGPT collapses in its own interface were present in full;
  **Show full text** recovered the whole prompt.
- **My Prompts** listed the user's own turns, expanded them fully, and
  **Show reply** produced the matching assistant response.
- **Excluding** turns greyed them out, reduced the kept count, and removed them
  from Preview and from the copied transcript.
- **Editing** a turn put the edited text in the output; **Restore** and
  **Reset changes** both returned the working copy to the original.
- **Manual splitting** produced separate topic conversations, and unassigned
  turns were correctly reported as belonging to none of them.
- **Copy** produced a transcript with `User:` / `Assistant:` labels that pasted
  correctly elsewhere.
- **The original ChatGPT conversation was unchanged throughout.**
- **The whole point of the product worked**: a topic-specific transcript was
  pasted as the first message of a brand-new ChatGPT conversation, and that new
  conversation treated it as prior context — it identified the subject, kept the
  continuation details, and answered a question about what the earlier
  conversation had covered.

### Claude, tested and passed

Chat Threads was run against a real signed-in Claude conversation. Claude was
recognised, the conversation loaded, and the normal workflow ran on it.

No API key was involved. Claude retrieval rides the Claude session the browser
already holds, exactly as ChatGPT retrieval does.

### The permission model and tab binding, tested and passed

Verified by hand in Microsoft Edge, a Chromium browser:

1. Chat Threads was invoked explicitly on Conversation A, which loaded.
2. Switching to Conversation B did **not** load it.
3. The side panel stayed visibly open — Chromium gives a window one side panel
   — but showed the neutral "Ready when you are" state rather than reading the
   new conversation.
4. Returning to Conversation A preserved Conversation A's working state.
5. Invoking Chat Threads on Conversation B loaded it independently.
6. Returning to Conversation A still showed its own earlier state.

State is isolated by tab and conversation, as intended. Note what is and is not
being claimed: the panel does not disappear on a tab switch, and it is not
meant to. What matters is that no conversation is read or replaced without an
explicit invocation.

### What was tested live with reservations

**OpenAI Find Topics.** With a real OpenAI API key, Find Topics completed and
proposed sensible topics with turn assignments, and Output produced a
conversation per topic — including for a conversation that came from Claude,
since the Find Topics provider is chosen independently of the source. One run
was slow and appeared to hit a temporary retry or reload condition before
succeeding, and on a very long conversation a request may take several minutes.
Treat latency and transient failures as open questions.

**A very long conversation failed on 1.0.0.** A real ChatGPT conversation of
866 turns — roughly 688,000 characters after per-turn shortening — was refused
by OpenAI, because the whole thing went out as a single request. The panel
reported it as a bad model name, which it was not. Version 1.0.1 divides a
conversation that size into sections before sending anything; that is covered
by tests but has not been repeated against the live conversation.

### What this does not establish

- Nothing about **Find Topics on a conversation long enough to need sections**,
  which is new in 1.0.1. The 866-turn case is reproduced by a generated fixture
  and tested end to end, but no request has been made for a real conversation
  of that size since the fix.
- Nothing about **Anthropic Find Topics**, which still needs a real Anthropic
  key. That key is only ever needed for Find Topics, never to read a
  conversation.
- Nothing about **other account types** on either provider — one account each,
  of one type. Team, Enterprise and Edu are untested, as are Claude accounts
  belonging to several organizations.
- Nothing about **future versions** of either site, whose internals can change
  without notice.
- Nothing about the **file-reference fix**, which is covered only by automated
  tests so far.

## Setup

1. `npm install && npm run icons && npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select `dist/`.
4. Note the browser version. Chrome or Edge 116+.
5. Open a ChatGPT tab and a Claude tab, signed in.

There is no longer any need to reload those tabs after installing. Chat Threads
declares no content scripts and injects its reader on demand instead.

## 0. Permissions are as small as claimed

Do this first; it is the step most likely to catch a regression that matters.

1. On `chrome://extensions`, open **Details** for Chat Threads.
2. **Expect** under *Permissions*: **no** "Read and change your data on" entry
   for any site. Chat Threads should request no site access at install time.
3. **Expect** *Site access* to show that it runs only **on click**.
4. **Expect** no entry for browsing history, tabs, or any site other than the
   ones you may later grant.
5. Open a ChatGPT conversation. **Without clicking the Chat Threads icon**,
   open the side panel from Chrome's own side-panel menu.
6. **Expect:** "Click the Chat Threads icon to begin". It must **not** load the
   conversation, and must not claim to know what page you are on.

## 1. Side panel opens on invocation

1. With a ChatGPT conversation open, click the Chat Threads toolbar icon.
2. **Expect:** the side panel opens, headed "Chat Threads / Reshape your AI
   conversations", and the conversation loads.
3. This single click both opens the panel and grants access to that tab. If the
   panel opens but then says it needs to be invoked, that is a **failure** —
   report it, because it means the `activeTab` grant is not arriving.

## 2. Unsupported site is handled

1. Open a page that is not ChatGPT or Claude (e.g. example.com) and click the
   Chat Threads icon.
2. **Expect:** "Open a ChatGPT or Claude conversation". No error, no spinner.
3. **Expect:** nothing in the browser console from the extension.

## 3. Provider detection and "no conversation"

1. Go to `https://chatgpt.com/` with no conversation open, click the icon.
2. **Expect:** "No active conversation found", naming ChatGPT, with a
   "Check again" button.
3. Repeat at `https://claude.ai/`.

## 3b. Access lapses safely

1. Load a conversation, then reload the ChatGPT page.
2. Press **Reload** in the panel.
3. **Expect:** either it reloads cleanly, or it says "Click the Chat Threads
   icon again" and explains that permission lapsed. Both are acceptable; a
   silent failure or a raw error is not.
4. Click the icon again. **Expect:** it loads.

## 3c. Optional standing access

1. From the "Click the Chat Threads icon to begin" screen, use
   **Allow Chat Threads to read chatgpt.com and claude.ai**.
2. **Expect:** Chrome's own permission prompt, naming those sites and no others.
3. Accept it. **Expect:** the conversation loads without clicking the icon, and
   switching between provider tabs now loads automatically.
4. Revoke it from `chrome://extensions` → Details → Site access.
5. **Expect:** the panel returns to asking for the icon, and still works that
   way.

## 4. ChatGPT — a complete conversation loads

Use a **long** conversation: at least 40 turns, ideally one you have scrolled
back through, containing at least one code block and one collapsed/long
message.

1. Open the conversation, then open the panel.
2. **Expect:** provider "ChatGPT", the conversation title, "N turns loaded",
   and a green "Complete" pill.
3. **Check the count.** Scroll the actual conversation and count turns.
   Does N match? If ChatGPT shows 84 turns, the panel must say 84.
4. **Check the ends.** In Clean, is the very first turn the real first turn?
   Is the last turn the real last one?
5. **Check the middle.** Find a turn you know was long and collapsed in the
   page. Expand it in the panel. **Expect:** the complete text, not a preview.
6. **Check a code block.** **Expect:** the fenced block appears with its
   language and indentation intact.
7. **Expect:** no warning banner. If one appears, record its exact text — this
   is the most important thing to report.

## 5. ChatGPT — the correct branch is shown

1. In a conversation, edit one of your earlier prompts, or regenerate a reply,
   so at least two branches exist.
2. Note which version the page is currently showing.
3. Reload the panel.
4. **Expect:** the transcript contains the branch on screen and **not** the
   discarded one.

## 6. Claude — a complete conversation loads

Repeat step 4 against a long Claude conversation, including one with an
attachment and one with an artifact.

- **Expect:** attachment file names appear under the relevant turn.
- **Expect:** artifact *contents* do **not** appear — this is a documented
  limitation, not a bug.
- **Expect:** extended-thinking blocks do **not** appear.

## 7. Claude — the correct branch is shown

As step 5. Claude branches when you edit a message; make sure the panel follows
the version on screen.

## 8. My Prompts

1. Open the **Prompts** tab.
2. **Expect:** only your own turns, in order, numbered 1..n.
3. **Expect:** the count matches the number of prompts you actually sent.
4. Expand a long prompt. **Expect:** the full text, nothing truncated.
5. Press "Show reply" on a prompt. **Expect:** the assistant's answer to *that*
   prompt appears.

## 8b. File references read as English

This is the defect found during the first live run, so it is worth doing
deliberately. You need a conversation where you attached or pasted a file and
the assistant referred back to it.

1. Find an assistant reply that cites an attached file.
2. **Expect** in the panel: readable text such as
   `[Reference to attached file: Pasted markdown.md]`, and a small chip under
   the message naming the file.
3. **Expect:** no stray marker syntax anywhere — no `filecite`, no `turn0file0`,
   no invisible or replacement characters mid-sentence.
4. Check the same message in **My Prompts → Show reply**, in **Split**, and in
   **Output → Preview**. All four must agree.
5. Copy the transcript and paste it into a plain-text editor. **Expect** the
   same readable text, and nothing unprintable.
6. If a reference appears whose file name could not be recovered, **expect**
   `[Reference to an attachment from the original conversation]` — a neutral
   note, never an invented file name and never silent deletion.

## 9. Excluding turns

1. In **Clean**, press Exclude on a turn.
2. **Expect:** it dims, is marked "Excluded", and the footer count drops.
3. Open **Output** → Preview. **Expect:** that turn is absent.
4. Go back and press Include. **Expect:** it returns to the transcript.
5. **Expect:** the ChatGPT/Claude page itself is completely unchanged.

## 10. Editing turns

1. Press Edit on a turn, remove a sentence, press Save.
2. **Expect:** the turn is marked "Edited", and shows your text.
3. Press **Compare**. **Expect:** the original text is shown, unchanged.
4. Check the transcript in Output. **Expect:** your edited text, not the
   original.
5. Press **Restore original**. **Expect:** the original text returns and the
   "Edited" badge disappears.
6. Press **Reset changes** in the footer. **Expect:** every edit and exclusion
   is undone.

## 11. The original conversation is untouched

This is the one that matters most.

1. After doing all of the above, switch to the ChatGPT/Claude tab.
2. Reload the page.
3. **Expect:** every message is exactly as it was. Nothing deleted, nothing
   edited, no new messages, no change to branches.
4. Check the conversation from a different browser or device if you can.

## 12. Manual splitting

Use a conversation that genuinely covers two or three subjects.

1. In **Split**, press "Add topic" three times.
2. Rename them to something meaningful.
3. Assign turns using each turn's dropdown. Mark a general opening instruction
   as **Shared**. Leave at least one turn **Unassigned**.
4. Open **Output**.
5. **Expect:** "Cleaned Conversation" plus "Conversation 1: …", "Conversation
   2: …", "Conversation 3: …".
6. **Expect:** a warning that some included turns are in no topic.
7. **Expect:** the Shared turn appears in all three, in its original position.
8. **Expect:** the Unassigned turn appears in none of them, but is in the
   cleaned conversation.
9. **Expect:** each topic conversation is in chronological order.

## 12b. The built-in topic

1. Open **Split** on any conversation. **Expect:** a topic called
   **Why is AI so stupid?** is already there, with nothing assigned to it.
2. Open **Output**. **Expect:** only "Cleaned Conversation" — an empty built-in
   topic should not appear.
3. Back in Split, assign a turn to it, then open Output. **Expect:** it now
   appears as a topic conversation, and Copy works on it.
4. Rename it, then press **Reset changes**. **Expect:** the original name is
   back and nothing is assigned to it.
5. Remove it, then press **Reset changes**. **Expect:** it returns.
6. If you have an API key, run **Find Topics** on a conversation where you did
   in fact lose patience with the model. **Expect:** the built-in topic is
   still there, still named what you called it, and is **not** duplicated by a
   second topic meaning the same thing.
7. **Expect** that ordinary technical criticism — telling the model its code is
   wrong — is *not* swept into it. This is the failure mode worth watching for;
   report it if you see it, with the turn redacted.

## 12c. Reviewing a topic and cutting it out

The main new workflow. Do it on a topic with a handful of turns in it.

1. In **Split**, note that each topic shows a turn count and a **Review**
   button, and that Review is disabled for a topic with nothing in it.
2. Press **Review** on a topic with turns.
3. **Expect:** only that topic's turns, each one ticked, a count reading
   "N selected for removal", **Select all** / **Select none**, and wording
   saying your original AI conversation is never changed.
4. Untick one turn. **Expect:** the count drops by one immediately.
5. Press **Remove selected turns**. **Expect:** you return to the topic list
   and the footer count of kept turns drops by the number you removed.
6. Open **Clean**. **Expect:** the removed turns appear greyed out and marked
   excluded, exactly as if you had excluded them by hand, and the turn you
   unticked is still included.
7. Press **Include** on one of them in Clean, then open **Output**.
   **Expect:** that turn is back in the cleaned transcript. This is the check
   that matters: Review and Clean must be the same switch.
8. Press **Reset changes**. **Expect:** every removed turn returns.
9. Confirm the ChatGPT or Claude page itself is unchanged.

## 12d. Two tabs at once

This is the regression test for a bug found in live use, where switching tabs
appeared to move a conversation into another one. Worth doing every time the
panel changes.

1. Open ChatGPT **Conversation A** in one tab and **Conversation B** in
   another.
2. Click the Chat Threads icon on **A**. It loads.
3. Exclude a turn, so A has a visible change.
4. Switch to the **B** tab *without* clicking the icon.
   **Expect:** "Ready when you are", offering to open Chat Threads for this
   conversation. It must **not** load B on its own, and must **not** show A's
   turn count or A's edit.
5. Switch back to **A**.
   **Expect:** A is exactly as you left it, including the exclusion, and it was
   not re-read.
6. Now click the icon on **B**. It loads B.
7. Exclude a different turn in B, then switch to A.
   **Expect:** A still shows *its* exclusion, and B's is not there.
8. Press **Reset changes** in one of them, switch to the other.
   **Expect:** only the one you pressed it in was reset.

### 12e. A slow Find Topics, with a tab switch

Needs an API key, and is best on a long conversation so the request takes a
while.

1. On **Conversation A**, start **Find Topics**.
2. While it is running, switch to the **B** tab and click the icon to load it.
3. Wait for the request to finish.
4. **Expect:** nothing appears in B. No new topics, no assignments.
5. Switch back to **A**.
   **Expect:** the proposed topics are here, in the conversation that asked
   for them.

If topics ever show up in B, stop and report it — that is the original bug.

### 12f. Changing conversation in one tab

1. Load Chat Threads on **Conversation A** and exclude a turn.
2. In that same tab, click through to a **different** conversation.
3. **Expect:** "This tab is now showing a different conversation", and an
   explicit button to open Chat Threads for it. A's edits must not appear.
4. Press the button. **Expect:** the new conversation loads, with no edits
   carried over.
5. Navigate the tab back to A. **Expect:** A's exclusion is still there.

## 13. Copy and paste — the actual point

1. Tick "Start with a note explaining this is an earlier conversation".
2. Press **Preview** and read it. Is it comprehensible? Would a model
   understand it as prior context?
3. Press **Copy**.
4. Open a **new** ChatGPT or Claude chat and paste.
5. **Expect:** the pasted text matches the preview exactly.
6. **Expect:** code blocks are still fenced, headings and lists intact.
7. Ask a follow-up question that depends on the earlier context.
8. **Expect:** the model answers as though it had the conversation.
9. **Expect:** the model does not respond to the transcript as though the
   historical turns were new instructions to it.

## 14. Downloads

1. Press "Download .md". **Expect:** a `.md` file whose contents match the
   preview.
2. Untick Markdown, press "Download .txt". **Expect:** plain-text labels.
3. Press ".json". **Expect:** valid JSON with a `messages` array.

## 15. Find Topics (needs an API key)

Only if you have a key you are willing to use. This sends conversation text to
the provider you pick.

The key is only ever for this step — reading a conversation from ChatGPT or
Claude needs none. The provider you pick here is independent of where the
conversation came from, so an OpenAI key analyses a Claude conversation
perfectly well. **The Anthropic path is the one still untested**, so running
this with an Anthropic key is the most valuable version of this step.

1. In **Split**, press "Set up" under Find Topics.
2. Choose a provider, paste a key, leave "remember" **off**.
3. Read the notice. **Expect:** it names the host and the approximate size.
4. Press "Send and find topics".
5. **Expect:** Chrome asks permission to contact the API host. Grant it.
6. **Expect:** topics appear in the topic list, turns get assignments, and
   some may be badged "Unsure".
7. Change one assignment by hand. **Expect:** it is badged "Your choice" and
   the change survives.
8. Open **Output**. **Expect:** the split reflects your correction.
9. Press "Clear all". **Expect:** all topics and assignments are discarded.
10. Restart Chrome, reopen the panel. **Expect:** the key is gone (because
    "remember" was off).
11. Repeat with a deliberately invalid key. **Expect:** a message saying the
    provider rejected that API key — not a message about the model name — and
    nothing changes.
12. Repeat with a deliberately wrong model name. **Expect:** a message about
    the model name, and nothing changes. The two must not say the same thing.

### 15a. A conversation long enough to need sections

Needs a key and a genuinely long conversation — several hundred turns. This is
the path added in 1.0.1 and the one with no live coverage yet.

1. Load a conversation of roughly 500 turns or more and go to **Split**.
2. Press "Set up" under Find Topics. **Expect:** in addition to the host and
   the approximate size, a line saying the conversation is too long for one
   request, how many sections it will take, and roughly how many requests.
3. Note that number before you press anything — it is what you are agreeing to
   pay for.
4. Press "Send and find topics". **Expect:** a progress line that changes as it
   goes: reading section 1 of N, then reconciling topics, then sorting section
   1 of N.
5. **Expect:** one coherent set of topics at the end — not several near-
   duplicates of the same subject with different names.
6. **Expect:** every turn has an assignment, or is listed in the notes as
   left unassigned. No turn should be missing from the conversation.
7. Run it again and press **Stop** partway through. **Expect:** it stops, says
   "Stopped. Nothing was changed.", and the conversation is untouched.
8. Check your provider's usage page. **Expect:** roughly the number of requests
   the panel said, and no more.

## 16. Failure behaviour

1. Sign out of ChatGPT in another tab, then reload the panel on a conversation.
   **Expect:** a clear "signed out" message, not a crash.
2. Go offline and press Reload. **Expect:** a network message naming the
   problem.
3. In both cases, **expect** the panel still offers "Try again".

## 17. Accessibility

1. Tab through the panel. **Expect:** every control is reachable and shows a
   visible focus ring.
2. **Expect:** the tab bar announces as tabs, and dropdowns have labels.
3. Switch the OS between light and dark. **Expect:** the panel follows, and
   text stays legible in both.

## Priority order

If there is only time for some of this, do it in this order — highest
uncertainty first:

1. **Step 8b** — the file-reference fix has only ever been tested against
   fixtures, so it is now the least-verified part of the product.
2. **Step 15 with an Anthropic key** — the Anthropic client has never made a
   real request.
3. **Steps 4–7 on an account of a different type**, or a Claude account in
   several organizations. One account per provider has passed; nothing is known
   about the rest.
4. Everything else, which has passed live and is unlikely to have regressed.

## Reporting

Post results as an issue. Include browser and version, provider, rough
conversation size, and the exact text of any warning or error. **Do not paste
conversation content**, and remember that a screenshot of the panel is a
screenshot of your conversation.
