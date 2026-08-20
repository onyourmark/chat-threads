# Release security

How an official Chat Threads build is produced and authorised.

**Nothing has been published yet.** There is no Chrome Web Store listing, no
public repository, no release, and no signing key. This document describes the
process that will be followed before there is one, so the rules exist before
the first release rather than after it.

## What counts as official

An official release is a build that the owner produced from committed source in
this repository and authorised. Nothing else is an official release, whatever
it is called or wherever it is hosted.

Specifically:

- A fork is not an official release. Forks are welcome under the licence, and
  they are somebody else's software.
- A build somebody else produced from this source is not an official release.
- A `.crx` or `.zip` obtained anywhere other than a link the owner published is
  not an official release.

A fork **cannot** modify an installed official Chat Threads. Chrome ties an
installed extension to the identity of whoever published it; a fork published
by someone else is a separate extension with a separate identity, and installing
it is a separate, deliberate act by the user. There is no mechanism by which
forked code reaches an existing installation.

## Release checklist

Every official release goes through all of this, in order. A step that fails
stops the release.

1. **Source is committed.** The release is built from a clean checkout of a
   tagged commit. No local edits, no uncommitted files.
2. **Clean build.** `npm ci` from the committed lockfile, then `npm run build`.
   Never a build from a working tree that has been experimented in.
3. **Automated tests pass.** `npm run test` — the whole suite, not a subset.
4. **Lint and type check pass.** `npm run lint && npm run typecheck`.
5. **Dependency audit.** `npm audit` reports no vulnerabilities, or each one is
   understood and recorded.
6. **Secret scan.** The repository and `dist/` are scanned for API keys,
   tokens, private keys and conversation text. CI does this on every push; it
   is repeated against the exact release artifact.
7. **Permission review.** `dist/manifest.json` is read by hand and every
   permission is checked against [PRIVACY.md](../PRIVACY.md). A permission that
   is not justified there does not ship. Particularly: no `<all_urls>`, no
   `tabs`, no `cookies`, no `webRequest`, no `history`, and no host permission
   for any site that is not a supported provider.
8. **Network review.** Every `fetch` in the built bundle is accounted for. The
   only destinations may be the supported providers and the two optional model
   API hosts.
9. **Documentation matches behaviour.** README, PRIVACY and SECURITY describe
   what this build actually does. If behaviour changed, they changed in the
   same commit.
10. **Versioned.** `package.json` version is bumped, the commit is tagged, and
    the build carries that version — the build script copies it into the
    manifest so the two cannot disagree.
11. **Owner authorisation.** The owner, personally, decides the build is a
    release. This is not delegated and not automated.

Only then is the package uploaded.

## Verified uploads

The Chrome Web Store normally lets anyone with access to the developer account
upload a new package, because Google holds the signing key. That makes the
Google account the single point of failure: an account compromise becomes a
malicious update pushed to every installed copy.

**Verified uploads** closes that. The developer registers an RSA public key with
the store; from then on the store rejects any upload not signed with the
matching private key. An attacker with the account but not the key cannot ship
anything.

Chat Threads will use verified uploads from its first published release.

### How it will be set up

1. Generate a 2048-bit RSA key pair, offline, on a machine the owner controls:

   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out chat-threads-signing.pem
   ```

2. Extract the public key to register with the store:

   ```bash
   openssl rsa -in chat-threads-signing.pem -pubout
   ```

3. In the Chrome Web Store developer dashboard, open the **Package** tab, click
   **Opt in**, and provide that public key.

4. From then on, package and sign each release as a `.crx` rather than
   uploading a `.zip`:

   ```bash
   chrome.exe --pack-extension=dist --pack-extension-key=chat-threads-signing.pem
   ```

   The same thing can be done through `chrome://extensions` with Developer mode
   on, using **Pack Extension**.

5. Upload the signed `.crx` with **Upload New Package**. The store verifies the
   signature, then repackages with its own key for publication, so the
   extension ID does not change.

### Handling the private key

- It is never committed to this repository, and `.gitignore` covers `*.pem`.
- It is never stored in the Google account the store listing lives in — that
  would defeat the point of the mechanism.
- It is never placed in CI, in a secrets store belonging to a third party, or
  in any automated publishing workflow. Signing is a manual step the owner
  performs.
- It is backed up offline, in a place separate from the account credentials.
- **It has not been generated yet, and must not be generated as part of routine
  development work.** It will be created deliberately, by the owner, when the
  first store release is being prepared.

If the key is lost, releases stop until Chrome Web Store support replaces it,
which can take about a week. That is the trade-off being accepted in exchange
for the account no longer being sufficient to ship code.

## Before the first public store release

These are prerequisites, not aspirations:

- [x] Claude live retrieval is tested against a real signed-in account.
- [x] The `activeTab` retrieval path and per-tab state isolation are verified
      live in a Chromium browser.
- [ ] Anthropic Find Topics is tested with a real Anthropic key, or the store
      listing is clear that only the OpenAI path has been exercised.
- [ ] The full procedure in [MANUAL-TESTING.md](MANUAL-TESTING.md) is completed
      and recorded — the file-reference fix in particular is still covered only
      by automated tests.
- [ ] A Chrome Web Store developer account exists and its one-off fee is paid.
- [ ] Store listing copy, screenshots and a privacy disclosure are prepared,
      and the disclosure matches PRIVACY.md.
- [ ] The signing key pair is generated and verified uploads is switched on
      **before** the first upload, so there is never a window in which an
      unsigned upload would be accepted.
- [ ] A security contact is published for the store listing.

## Reporting a problem in a release

Security reports go through the process in [SECURITY.md](../SECURITY.md). If a
released build turns out to contain a vulnerability, the fix follows this same
checklist — there is no expedited path that skips the tests or the permission
review, because those are the steps most likely to catch a mistake made in a
hurry.
