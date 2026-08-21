# Microsoft Edge Add-ons submission

Chat Threads is live-tested in Microsoft Edge, so the Edge Add-ons listing is
worth having alongside the Chrome one. Almost everything is shared with
[CHROME-WEB-STORE.md](CHROME-WEB-STORE.md); this file records only what
Microsoft does differently.

**Prepared for:** version 1.0.0
**Last reviewed:** 20 August 2026

---

## 1. The package — no changes needed

Edge is Chromium, and Partner Center takes the same Manifest V3 archive Chrome
takes. Upload the identical file:

```
chat-threads-1.0.0.zip
```

Rebuild it with `npm run package` if it is not to hand. Nothing in the manifest
needs an Edge-specific edit: `sidePanel` is supported in Edge 114 and later, and
`minimum_chrome_version: "116"` is read correctly by Edge, whose version numbers
track Chromium's.

There is one thing to know before uploading. Partner Center reads the
`name` and `description` fields **out of the manifest** and makes them
read-only on the listing page. So on Edge the short description is fixed at the
manifest's:

> Reshape your AI conversations. Clean, edit and split long ChatGPT and Claude
> chats, then copy them into a new chat.

Changing it later means editing `manifest.json`, rebuilding, and re-uploading
the package — not editing a form field. It reads well as-is, so leave it.

---

## 2. Registration — the one owner-only step

Partner Center registration for the Microsoft Edge program is **free**; there is
no fee of the kind Chrome charges. It needs either a Microsoft account
(outlook.com / live.com / hotmail.com) or a **personal** GitHub account as the
Primary Owner, and someone has to accept the developer agreement in person.

Start at: <https://partner.microsoft.com/dashboard/microsoftedge/public/login>

---

## 3. Assets

Microsoft's requirements differ from Google's in two places: the logo is
300 × 300 rather than 128 × 128, and screenshots may be 640 × 480 as well as
1280 × 800.

| Field | Requirement | File in `docs/assets/store/` |
| --- | --- | --- |
| Extension logo | Required. 1:1, 300 × 300 recommended, 128 × 128 minimum | `edge-logo-300.png` |
| Small promotional tile | Optional. Exactly 440 × 280 | `promo-small-440x280.png` |
| Large promotional tile | Optional. Exactly 1400 × 560 | `promo-marquee-1400x560.png` |
| Screenshots | Optional, up to 6. 1280 × 800 or 640 × 480 | `screenshot-1.png` … `screenshot-5.png` |
| YouTube video | Optional | None. Nothing to link. |

`edge-logo-300.png` is drawn by the same code as the extension's own icons
(`scripts/make-icons.mjs`), so the store logo and the toolbar icon are the same
mark at different sizes rather than two drawings that happen to look alike.

Chrome's 128 × 128 store icon is not used here; Edge wants the larger one.

---

## 4. Listing fields

| Field | Value |
| --- | --- |
| Extension name | `Chat Threads` (read-only, from the manifest) |
| Short description | Read-only, from the manifest — see §1 |
| Description | The detailed description in [CHROME-WEB-STORE.md §2](CHROME-WEB-STORE.md). 3,558 characters, inside Edge's 250–10,000 range. |
| Category | **Productivity**. Edge's category list is shorter than Chrome's and is only visible in the Partner Center dropdown; Productivity is the closest fit for a tool that reorganises material you already have. |
| Website | `https://github.com/onyourmark/chat-threads` |
| Support contact | `https://github.com/onyourmark/chat-threads/issues` |
| Mature content | No |
| Visibility | Public |
| Markets | All |

**Do not use the "Generate with AI" button** on the description field. The
description in `CHROME-WEB-STORE.md` was written against the code and is
accurate; a regenerated one would have to be re-checked claim by claim.

### Search terms

Edge allows up to seven terms, 21 words in total, 30 characters each. These fit:

```
ChatGPT conversation cleanup
Claude conversation
split conversation
remove chat turns
AI context management
conversation export
side panel
```

Seventeen words, longest term 28 characters.

---

## 5. Privacy page

Identical in substance to Chrome's, and Partner Center asks for the same five
things. Paste from [CHROME-WEB-STORE.md §4](CHROME-WEB-STORE.md):

- **Single purpose** — §4, *Single purpose*.
- **Permission justification** — §4, one box each for `sidePanel`, `storage`,
  `activeTab`, `scripting`, and the optional host permissions.
- **Are you using remote code?** — **No, I am not using remote code.**
  Microsoft notes that MV3 does not permit remotely hosted code at all.
- **Data usage** — the same four categories: authentication information,
  personal communications, website content; nothing else.
- **Privacy policy URL** —
  `https://github.com/onyourmark/chat-threads/blob/main/PRIVACY.md`

Microsoft states plainly that inconsistent or incomplete disclosure here is a
policy violation in its own right, so keep the two stores' answers identical.
If one changes, change both.

---

## 6. Notes for certification

Partner Center's **Notes for certification** box is the equivalent of Chrome's
reviewer notes. Paste the same text from
[CHROME-WEB-STORE.md §5](CHROME-WEB-STORE.md), with one substitution: where it
says `chrome://extensions`, Edge testers will use `edge://extensions`.

Worth adding at the top of the box:

```
This extension is developed and tested in both Chrome and Microsoft Edge. The
package is unchanged between the two stores.
```

---

## 7. Timing

Certification takes **up to seven business days** after submission. The listing
goes live automatically once it passes; the Partner Center status changes to
*In the Store*.
