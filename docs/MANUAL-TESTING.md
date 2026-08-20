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
| OpenAI Find Topics | **Passed once** — a real API call produced usable topics |
| Claude retrieval | **Not yet tested** against a live account |
| The `activeTab` permission model | **Not yet tested** — changed after the live run |
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

### What was tested live with reservations

**OpenAI Find Topics.** With a real OpenAI API key, Find Topics completed and
proposed several sensible topics with turn assignments, and Output produced a
conversation per topic. One run was slow and appeared to hit a temporary retry
or reload condition before succeeding. That is a single successful run, not
evidence of reliability; treat latency and transient failures as open questions.

### What this does not establish

- Nothing about **Claude**. Claude retrieval has never run against a live
  account.
- Nothing about **other ChatGPT account types** — the run was one account, of
  one type. Team, Enterprise and Edu accounts are untested.
- Nothing about the **current permission model**. The live run used a build with
  standing host access to the provider sites. That was replaced afterwards with
  `activeTab` and on-demand injection, so steps 0 and 4 below need re-running.
- Nothing about the **file-reference fix**, which was written in response to the
  live run and is covered only by automated tests so far.

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
11. Repeat with a deliberately invalid key. **Expect:** "The … API rejected
    that key", and nothing changes.

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

1. **Step 0 and step 1** — the permission model changed after the last live
   run and has never been exercised in a browser.
2. **Steps 4–7 on Claude** — Claude retrieval has never run against a live
   account at all.
3. **Step 8b** — the file-reference fix has only been tested against fixtures.
4. **Step 4 on ChatGPT again** — confirming the permission change did not
   disturb the retrieval path that previously worked.
5. Everything else, which passed on ChatGPT before and is unlikely to have
   regressed.

## Reporting

Post results as an issue. Include browser and version, provider, rough
conversation size, and the exact text of any warning or error. **Do not paste
conversation content**, and remember that a screenshot of the panel is a
screenshot of your conversation.
