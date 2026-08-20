/**
 * The service worker.
 *
 * Deliberately tiny. It notices when the user invokes the extension, opens the
 * side panel on that tab, and remembers which tab was invoked. It holds no
 * conversation data, no API key, and makes no network requests — retrieval
 * happens in the injected content script, and the optional model call happens
 * in the side panel.
 *
 * Why the click is handled here rather than by Chrome:
 * `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` lets Chrome
 * open the panel itself, but then `action.onClicked` never fires and the
 * extension is never granted `activeTab` for the tab. Chat Threads has no
 * standing access to any site, so that grant is the whole basis on which it is
 * allowed to read the conversation. Handling the click ourselves gets both:
 * the grant, and the panel.
 */

import { identityFromUrl } from '../adapters/registry';
import type { ActiveTabInfo } from '../model/messages';
import { parseBackgroundRequest } from '../model/messages';

/**
 * The tab the user last invoked Chat Threads on.
 *
 * Kept in session storage rather than a module variable because the service
 * worker is evicted when idle, and losing this would make the panel forget
 * which tab it is allowed to read.
 */
const INVOKED_TAB = 'chatThreads.invokedTab';

interface InvokedTab {
  tabId: number;
  /** Epoch millis, only used to break ties if several tabs were invoked. */
  at: number;
}

async function rememberInvokedTab(tabId: number): Promise<void> {
  try {
    await chrome.storage.session.set({
      [INVOKED_TAB]: { tabId, at: Date.now() } satisfies InvokedTab,
    });
  } catch {
    // Losing this only costs the user another click on the icon.
  }
}

async function readInvokedTab(): Promise<InvokedTab | null> {
  try {
    const stored = await chrome.storage.session.get(INVOKED_TAB);
    const value = stored[INVOKED_TAB];
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as InvokedTab).tabId === 'number'
    ) {
      return value as InvokedTab;
    }
  } catch {
    // Treat as "never invoked".
  }
  return null;
}

chrome.runtime.onInstalled.addListener(() => {
  // Make sure Chrome does not swallow the click; see the note above.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => {
      // Older builds without the behavior API still deliver onClicked.
    });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void rememberInvokedTab(tab.id);
  // Must happen inside the click: sidePanel.open() requires a user gesture.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
    // If opening programmatically is unavailable, fall back to letting Chrome
    // open the panel on the next click. That path does not grant activeTab,
    // so the panel will ask the user for site access instead.
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only messages from this extension's own pages are served.
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

/**
 * Describe the tab the panel should be working on.
 *
 * A tab's `url` is only readable when the extension has been granted access to
 * it — either by the user invoking Chat Threads on it (`activeTab`) or by the
 * user granting the optional site permission. An unreadable url therefore
 * means "not allowed to look", which the panel reports as needing invocation
 * rather than as an error.
 */
async function activeTabInfo(): Promise<ActiveTabInfo> {
  const [active] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const invoked = await readInvokedTab();

  // The panel follows the active tab, so only an invocation on *this* tab
  // counts. A grant on some other tab must not be treated as access here.
  const invokedHere = active?.id !== undefined && invoked?.tabId === active.id;

  let url = active?.url;
  if (!url && active?.id !== undefined) {
    // `tabs.query` omits the url without permission; a direct get succeeds
    // when activeTab was granted for this tab.
    try {
      url = (await chrome.tabs.get(active.id)).url;
    } catch {
      url = undefined;
    }
  }

  const identity = url ? identityFromUrl(url) : null;

  return {
    tabId: active?.id,
    url,
    provider: identity?.provider,
    conversationId: identity?.conversationId,
    supported: identity !== null,
    invoked: invokedHere,
    invokedAt: invokedHere ? invoked?.at : undefined,
    contentScriptReady: false,
  };
}
