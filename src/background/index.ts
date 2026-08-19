/**
 * The service worker.
 *
 * Deliberately tiny. It opens the side panel and answers one question about
 * the active tab. It holds no conversation data, no API key, and makes no
 * network requests — retrieval happens in the content script, and the
 * optional model call happens in the side panel.
 */

import { providerForUrl } from '../adapters/registry';
import type { ActiveTabInfo } from '../model/messages';
import { parseBackgroundRequest } from '../model/messages';

/**
 * Clicking the toolbar icon opens the panel. Chrome handles this itself,
 * which keeps the open inside the user gesture `sidePanel.open()` requires.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome builds without the behavior API: the panel can still be
      // opened from Chrome's own side-panel menu.
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only messages from this extension's own pages are served. A content
  // script has a `tab`; the side panel does not.
  if (sender.id !== chrome.runtime.id) return false;

  const request = parseBackgroundRequest(message);
  if (!request) return false;

  if (request.type === 'bg:get-active-tab') {
    void activeTabInfo().then((info) =>
      sendResponse({ type: 'ok:active-tab', info }),
    );
    return true; // response is asynchronous
  }

  return false;
});

async function activeTabInfo(): Promise<ActiveTabInfo> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  // `url` is only populated for tabs this extension has host permission for,
  // so an undefined url means "not one of our sites".
  const url = tab?.url;
  const provider = url ? providerForUrl(url) : null;

  return {
    tabId: tab?.id,
    url,
    provider: provider ?? undefined,
    supported: provider !== null,
    contentScriptReady: false,
  };
}
