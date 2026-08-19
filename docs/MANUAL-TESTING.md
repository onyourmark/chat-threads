# Manual testing procedure

The automated tests cover normalization, editing, splitting, transcript
generation, AI proposal handling and security against fixtures. They
deliberately never touch a live account.

**This procedure has not been run.** At the time of writing, no signed-in
ChatGPT or Claude session was available to the author, so everything below is
unverified. If you have accounts and half an hour, working through this and
reporting the results is the single most valuable contribution you can make.

Record results as: step, expected, actual, pass/fail. Please redact
conversation content in anything you post publicly.

## Setup

1. `npm install && npm run icons && npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select `dist/`.
4. Note the Chrome version from `chrome://version`. Must be 116+.
5. Open a ChatGPT tab and a Claude tab, signed in. **Reload both** — content
   scripts only reach pages loaded after the extension was installed.

## 1. Side panel opens

1. On any page, click the Chat Threads toolbar icon.
2. **Expect:** the side panel opens, headed "Chat Threads / Reshape your AI
   conversations."

## 2. Unsupported site is handled

1. Open the panel on a page that is not ChatGPT or Claude (e.g. example.com).
2. **Expect:** "Open a ChatGPT or Claude conversation". No error, no spinner.
3. **Expect:** nothing in the browser console from the extension.

## 3. Provider detection and "no conversation"

1. Go to `https://chatgpt.com/` with no conversation open.
2. **Expect:** "No active conversation found", naming ChatGPT, with a
   "Check again" button.
3. Repeat at `https://claude.ai/`.

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

## Reporting

Post results as an issue. Include Chrome version, provider, rough conversation
size, and the exact text of any warning or error. **Do not paste conversation
content.**
