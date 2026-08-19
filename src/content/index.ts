/**
 * The content script.
 *
 * Runs on ChatGPT and Claude pages and does exactly three things: say it is
 * there, say which conversation is open, and retrieve that conversation when
 * the side panel asks. It never writes to the page, never sends anything
 * anywhere except back to this extension's own side panel, and only acts when
 * asked.
 *
 * Retrieval lives here rather than in the service worker because a content
 * script's requests go out on the page's own origin, so they ride the session
 * the user is already signed in with and no credential ever has to be read,
 * copied, or stored.
 */

import { adapterForUrl } from '../adapters/registry';
import { parsePanelRequest, type PanelResponse } from '../model/messages';

/**
 * This script is injected on demand rather than declared in the manifest, so
 * it can be asked to run again in a tab it is already in. The isolated world
 * persists for the life of the page, so a flag there is enough to make a
 * second injection a no-op instead of a second set of listeners.
 */
const GUARD = '__chatThreadsListenerInstalled';
const world = globalThis as unknown as Record<string, boolean | undefined>;

if (!world[GUARD]) {
  world[GUARD] = true;
  install();
}

function install(): void {
  chrome.runtime.onMessage.addListener(handleMessage);
}

function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: PanelResponse) => void,
): boolean {
  // Ignore anything that did not come from this extension.
  if (sender.id !== chrome.runtime.id) return false;

  const request = parsePanelRequest(message);
  if (!request) return false;

  switch (request.type) {
    case 'ct:ping':
      sendResponse({ type: 'ok:pong' } satisfies PanelResponse);
      return false;

    case 'ct:identify': {
      const adapter = adapterForUrl(location.href);
      const identity = adapter
        ? adapter.getConversationIdentity(location.href)
        : null;
      sendResponse({ type: 'ok:identity', identity } satisfies PanelResponse);
      return false;
    }

    case 'ct:load': {
      const adapter = adapterForUrl(location.href);
      if (!adapter) {
        sendResponse({
          type: 'ok:conversation',
          result: {
            ok: false,
            adapter: 'chatgpt',
            code: 'unsupported-page',
            message:
              'Open a ChatGPT or Claude conversation to use Chat Threads.',
          },
        } satisfies PanelResponse);
        return false;
      }

      void adapter
        .loadConversation(location.href)
        .then((result) => {
          sendResponse({
            type: 'ok:conversation',
            result,
          } satisfies PanelResponse);
        })
        .catch(() => {
          // An adapter should describe its own failures; reaching here means
          // one threw unexpectedly, which is still not a reason to crash.
          sendResponse({
            type: 'ok:conversation',
            result: {
              ok: false,
              adapter: adapter.id,
              code: 'unknown',
              message: 'Chat Threads could not retrieve this conversation.',
              diagnostics: { adapterFile: `src/adapters/${adapter.id}/` },
            },
          } satisfies PanelResponse);
        });
      return true; // response is asynchronous
    }

    default:
      return false;
  }
}
