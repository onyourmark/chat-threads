/**
 * A small fake of the parts of Chrome the side panel talks to.
 *
 * It models more than one tab on purpose. The bug this was written for —
 * conversation state appearing to move between tabs — is only visible when
 * there are two tabs, an active one, and events that fire as the user moves
 * between them. A single-tab stub cannot express it.
 */

import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { chatgptMixedTopics } from './fixtures/chatgpt';
import { chatgptVenting } from './fixtures/chatgpt-venting';

export interface FakeTab {
  tabId: number;
  /** Absent means the extension has no access to this tab. */
  url?: string;
  /** Whether the reader script is already present. */
  ready?: boolean;
  /** Whether injecting the reader script is allowed to succeed. */
  canInject?: boolean;
  /** What `ct:load` returns for this tab. */
  loadResult?: unknown;
}

export interface FakeBrowser {
  chrome: unknown;
  /** Bring a tab to the front, as the user switching tabs would. */
  activate(tabId: number): void;
  /** Click the toolbar icon on a tab: grants access and asks for a load. */
  invoke(tabId: number): void;
  /** Point a tab at a different address, as an in-page navigation would. */
  navigate(tabId: number, url: string, loadResult?: unknown): void;
  close(tabId: number): void;
  /** How many times the panel injected the reader script. */
  injections: number;
  permissionRequests: number;
  /** Per-tab count of `ct:load` calls, to prove nothing loads on its own. */
  loads: Map<number, number>;
  /** Make the next `ct:load` for a tab hang until `release` is called. */
  hold(tabId: number): () => void;
}

export interface FakeOptions {
  tabs: FakeTab[];
  activeTabId: number;
  hasSiteAccess?: boolean;
}

/** A normalized ChatGPT conversation, as the content script would return it. */
export function conversationResult(
  which: 'mixed' | 'venting' = 'mixed',
  url = 'https://chatgpt.com/c/conv-mixed',
) {
  return {
    ok: true,
    conversation: normalizeChatGptConversation(
      which === 'mixed' ? chatgptMixedTopics : chatgptVenting,
      { url, method: 'provider-api' },
    ),
  };
}

export function createFakeBrowser(options: FakeOptions): FakeBrowser {
  const tabs = new Map(options.tabs.map((t) => [t.tabId, { ...t }]));
  let activeTabId = options.activeTabId;

  // Mirrors the background worker's record of the last toolbar-icon click.
  let invokedTab: { tabId: number; at: number } | null = null;
  let clock = 0;

  const injectedIn = new Set(
    options.tabs.filter((t) => t.ready !== false).map((t) => t.tabId),
  );

  const activatedListeners: Array<() => void> = [];
  const updatedListeners: Array<
    (tabId: number, change: { url?: string; status?: string }) => void
  > = [];
  const removedListeners: Array<(tabId: number) => void> = [];
  const storageListeners: Array<
    (changes: Record<string, unknown>, area: string) => void
  > = [];

  const held = new Map<number, Array<() => void>>();

  const browser: FakeBrowser = {
    chrome: null,
    injections: 0,
    permissionRequests: 0,
    loads: new Map(),

    activate(tabId) {
      activeTabId = tabId;
      activatedListeners.forEach((l) => l());
    },

    invoke(tabId) {
      activeTabId = tabId;
      clock += 1;
      invokedTab = { tabId, at: clock };
      // The background writes this; the panel notices the change.
      storageListeners.forEach((l) =>
        l({ 'chatThreads.invokedTab': { newValue: invokedTab } }, 'session'),
      );
    },

    navigate(tabId, url, loadResult) {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tab.url = url;
      if (loadResult !== undefined) tab.loadResult = loadResult;
      updatedListeners.forEach((l) => l(tabId, { url }));
    },

    close(tabId) {
      tabs.delete(tabId);
      removedListeners.forEach((l) => l(tabId));
    },

    hold(tabId) {
      const releases: Array<() => void> = [];
      held.set(tabId, releases);
      return () => {
        held.delete(tabId);
        releases.forEach((r) => r());
      };
    },
  };

  browser.chrome = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: (_message: unknown, cb: (reply: unknown) => void) => {
        const tab = tabs.get(activeTabId);
        const url = tab?.url;
        const invokedHere = invokedTab?.tabId === activeTabId;

        // Mirrors identifyFromUrl in the background.
        const match = url?.match(
          /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai)\//,
        );
        const conversationId =
          url?.match(/\/(?:c|chat)\/([^/?#]+)/)?.[1] ?? undefined;

        cb({
          type: 'ok:active-tab',
          info: {
            tabId: tab?.tabId,
            url,
            provider: match
              ? match[1] === 'claude.ai'
                ? 'claude'
                : 'chatgpt'
              : undefined,
            conversationId,
            supported: Boolean(match),
            invoked: invokedHere,
            invokedAt: invokedHere ? invokedTab?.at : undefined,
            contentScriptReady: false,
          },
        });
      },
    },

    tabs: {
      sendMessage: (
        tabId: number,
        message: { type: string },
        cb: (reply: unknown) => void,
      ) => {
        if (message.type === 'ct:ping') {
          cb(injectedIn.has(tabId) ? { type: 'ok:pong' } : undefined);
          return;
        }
        if (message.type === 'ct:load') {
          browser.loads.set(tabId, (browser.loads.get(tabId) ?? 0) + 1);
          const reply = () =>
            cb({
              type: 'ok:conversation',
              result: tabs.get(tabId)?.loadResult,
            });
          const queue = held.get(tabId);
          if (queue) queue.push(reply);
          else reply();
          return;
        }
        cb(undefined);
      },
      onActivated: {
        addListener: (l: () => void) => activatedListeners.push(l),
        removeListener: (l: () => void) => {
          const i = activatedListeners.indexOf(l);
          if (i >= 0) activatedListeners.splice(i, 1);
        },
      },
      onUpdated: {
        addListener: (l: (tabId: number, change: { url?: string }) => void) =>
          updatedListeners.push(l),
        removeListener: (
          l: (tabId: number, change: { url?: string }) => void,
        ) => {
          const i = updatedListeners.indexOf(l);
          if (i >= 0) updatedListeners.splice(i, 1);
        },
      },
      onRemoved: {
        addListener: (l: (tabId: number) => void) => removedListeners.push(l),
        removeListener: (l: (tabId: number) => void) => {
          const i = removedListeners.indexOf(l);
          if (i >= 0) removedListeners.splice(i, 1);
        },
      },
    },

    scripting: {
      executeScript: async ({ target }: { target: { tabId: number } }) => {
        browser.injections += 1;
        if (tabs.get(target.tabId)?.canInject === false) {
          throw new Error('no access to this tab');
        }
        injectedIn.add(target.tabId);
        return [];
      },
    },

    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      onChanged: {
        addListener: (
          l: (changes: Record<string, unknown>, area: string) => void,
        ) => storageListeners.push(l),
        removeListener: (
          l: (changes: Record<string, unknown>, area: string) => void,
        ) => {
          const i = storageListeners.indexOf(l);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },

    permissions: {
      contains: async () => options.hasSiteAccess === true,
      request: async () => {
        browser.permissionRequests += 1;
        return false;
      },
      remove: async () => true,
    },
  };

  return browser;
}
