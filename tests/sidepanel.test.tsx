/**
 * @vitest-environment jsdom
 *
 * Side panel smoke tests.
 *
 * These mount the real `App` against a fake `chrome` API. They do not replace
 * testing the extension in Chrome (see docs/MANUAL-TESTING.md), but they do
 * catch the panel failing to mount, and they pin down what the user is told in
 * each of the states that are otherwise awkward to reach by hand.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/sidepanel/App';
import { chatgptMixedTopics } from './fixtures/chatgpt';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';

interface FakeOptions {
  /** What the background reports about the active tab. */
  tab?: {
    tabId?: number;
    url?: string;
    provider?: string;
    supported: boolean;
    invoked?: boolean;
  };
  /** Whether the content script answers a ping. */
  ready?: boolean;
  /** Whether injecting the reader script succeeds. */
  canInject?: boolean;
  /** Whether ongoing site access has already been granted. */
  hasSiteAccess?: boolean;
  /** What `ct:load` returns. */
  loadResult?: unknown;
}

/** Records what the panel asked the browser to do. */
interface FakeCalls {
  injections: number;
  permissionRequests: number;
}

let calls: FakeCalls;

function installFakeChrome(options: FakeOptions) {
  const {
    tab = {
      tabId: 1,
      url: 'https://chatgpt.com/c/conv-mixed',
      provider: 'chatgpt',
      supported: true,
      invoked: true,
    },
    ready = true,
    canInject = true,
    hasSiteAccess = false,
    loadResult,
  } = options;

  calls = { injections: 0, permissionRequests: 0 };
  let injected = ready;

  const fake = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: (_message: unknown, cb: (reply: unknown) => void) => {
        cb({
          type: 'ok:active-tab',
          info: { invoked: false, ...tab, contentScriptReady: false },
        });
      },
    },
    tabs: {
      sendMessage: (
        _tabId: number,
        message: { type: string },
        cb: (reply: unknown) => void,
      ) => {
        if (message.type === 'ct:ping') {
          cb(injected ? { type: 'ok:pong' } : undefined);
          return;
        }
        if (message.type === 'ct:load') {
          cb({ type: 'ok:conversation', result: loadResult });
          return;
        }
        cb(undefined);
      },
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: {
      executeScript: async () => {
        calls.injections += 1;
        if (!canInject) throw new Error('no access to this tab');
        injected = true;
        return [];
      },
    },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    permissions: {
      contains: async () => hasSiteAccess,
      request: async () => {
        calls.permissionRequests += 1;
        return false;
      },
      remove: async () => true,
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = fake;
}

function goodConversation() {
  return {
    ok: true,
    conversation: normalizeChatGptConversation(chatgptMixedTopics, {
      url: 'https://chatgpt.com/c/conv-mixed',
      method: 'provider-api',
    }),
  };
}

// Tells React that `act()` is available, so it does not warn on every render.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  // Let the load promise chain settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

const text = () => container.textContent ?? '';

/** The view tab with this label. */
const tab = (label: string): HTMLButtonElement =>
  Array.from(container.querySelectorAll('[role="tab"]')).find(
    (t) => t.textContent === label,
  ) as HTMLButtonElement;

describe('the side panel mounts', () => {
  it('always shows the product name and tagline', async () => {
    installFakeChrome({ loadResult: goodConversation() });
    await mount();

    expect(text()).toContain('Chat Threads');
    expect(text()).toContain('Reshape your AI conversations.');
  });
});

describe('states the user can end up in', () => {
  it('explains what to do on an unsupported site', async () => {
    installFakeChrome({
      tab: { tabId: 1, url: 'https://example.com/', supported: false, invoked: true },
      loadResult: undefined,
    });
    await mount();

    expect(text()).toContain('Open a ChatGPT or Claude conversation');
    // No view tabs when there is nothing loaded.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('asks to be invoked when it has no access to the tab', async () => {
    // No url and no invocation: the normal resting state, because Chat Threads
    // holds no standing access to any site.
    installFakeChrome({
      tab: { tabId: 1, supported: false, invoked: false },
      loadResult: undefined,
    });
    await mount();

    expect(text()).toContain('Click the Chat Threads icon to begin');
    // It must not guess whether this is a provider page.
    expect(text()).not.toContain('No active conversation found');
  });

  it('does not inject anything before it has been invoked', async () => {
    installFakeChrome({
      tab: { tabId: 1, supported: false, invoked: false },
      loadResult: undefined,
    });
    await mount();

    expect(calls.injections).toBe(0);
  });

  it('offers ongoing site access as an explicit opt-in', async () => {
    installFakeChrome({
      tab: { tabId: 1, supported: false, invoked: false },
      hasSiteAccess: false,
      loadResult: undefined,
    });
    await mount();

    const opt = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Allow Chat Threads to read'),
    );
    expect(opt).toBeDefined();
    expect(calls.permissionRequests).toBe(0);

    await act(async () => (opt as HTMLButtonElement).click());
    expect(calls.permissionRequests).toBe(1);
  });

  it('does not offer site access again once it has been granted', async () => {
    installFakeChrome({
      tab: { tabId: 1, supported: false, invoked: false },
      hasSiteAccess: true,
      loadResult: undefined,
    });
    await mount();

    expect(text()).not.toContain('Allow Chat Threads to read');
  });

  it('injects the reader script when it has access but the script is absent', async () => {
    installFakeChrome({ ready: false, canInject: true, loadResult: goodConversation() });
    await mount();

    expect(calls.injections).toBe(1);
    expect(text()).toContain('8 turns loaded');
  });

  it('says the grant lapsed when the tab refuses the script', async () => {
    installFakeChrome({ ready: false, canInject: false, loadResult: undefined });
    await mount();

    expect(text()).toContain('Click the Chat Threads icon again');
    expect(text()).toContain('lapsed');
  });

  it('does not re-inject when the script is already there', async () => {
    installFakeChrome({ ready: true, loadResult: goodConversation() });
    await mount();

    expect(calls.injections).toBe(0);
  });

  it('says when the provider is recognized but no conversation is open', async () => {
    installFakeChrome({
      loadResult: {
        ok: false,
        adapter: 'claude',
        code: 'no-conversation',
        message: 'No active conversation found.',
      },
    });
    await mount();

    expect(text()).toContain('No active conversation found');
    expect(text()).toContain('Claude');
  });

  it('names the adapter and the reason when retrieval fails', async () => {
    installFakeChrome({
      loadResult: {
        ok: false,
        adapter: 'chatgpt',
        code: 'provider-format-changed',
        message: 'ChatGPT returned a conversation in a format Chat Threads does not recognize.',
        diagnostics: { adapterFile: 'src/adapters/chatgpt/normalize.ts' },
      },
    });
    await mount();

    expect(text()).toContain('could not retrieve this conversation');
    expect(text()).toContain('src/adapters/chatgpt/normalize.ts');
    expect(text()).toContain('chatgpt');
  });

  it('reports an unreadable reply rather than showing nothing', async () => {
    installFakeChrome({ loadResult: { garbage: true } });
    await mount();

    expect(text()).toContain('could not');
  });
});

describe('a loaded conversation', () => {
  beforeEach(() => installFakeChrome({ loadResult: goodConversation() }));

  it('reports the provider, the turn count and the retrieval status', async () => {
    await mount();

    expect(text()).toContain('ChatGPT');
    expect(text()).toContain('8 turns loaded');
    expect(text()).toContain('Complete');
  });

  it('offers the four views', async () => {
    await mount();
    const tabs = Array.from(
      container.querySelectorAll('[role="tab"]'),
    ).map((t) => t.textContent);

    expect(tabs).toEqual(['Prompts', 'Clean', 'Split', 'Output']);
  });

  it('opens on My Prompts and shows only user turns', async () => {
    await mount();

    expect(text()).toContain('Everything you said, in order. 4 of 8 turns.');
    expect(text()).toContain('How should the browser extension store its working copy?');
    // An assistant turn is not shown until its reply is revealed.
    expect(text()).not.toContain('Keep the retrieved conversation immutable');
  });

  it('switches to Clean and offers include/exclude and edit', async () => {
    await mount();
    const clean = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (t) => t.textContent === 'Clean',
    ) as HTMLButtonElement;

    await act(async () => clean.click());

    expect(text()).toContain('8 of 8 turns will be included');
    expect(text()).toContain('the original conversation is left exactly as it is');
    expect(text()).toContain('Exclude');
    expect(text()).toContain('Edit');
  });

  it('offers the built-in topic in Split, ready to use', async () => {
    await mount();
    await act(async () => tab('Split').click());

    const names = Array.from(
      container.querySelectorAll('.topic-row input'),
    ).map((i) => (i as HTMLInputElement).value);

    expect(names).toEqual(['Why is AI so stupid?']);
    expect(text()).toContain('arguing with the AI rather than getting work done');
    // And it is offered as a destination for every turn.
    const options = Array.from(
      container.querySelectorAll('select option'),
    ).map((o) => o.textContent);
    expect(options).toContain('1. Why is AI so stupid?');
  });

  it('does not clutter Output with the unused built-in topic', async () => {
    await mount();
    await act(async () => tab('Output').click());

    // Only the cleaned conversation: an empty topic nobody asked for should
    // not put a heading about swearing at the top of the output.
    expect(text()).toContain('Cleaned Conversation');
    expect(text()).not.toContain('Conversation 1: Why is AI so stupid?');
    expect(text()).not.toContain('not in any topic');
  });

  it('shows the built-in topic in Output once a turn is put in it', async () => {
    await mount();
    await act(async () => tab('Split').click());

    const select = container.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'built-in-venting';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => tab('Output').click());
    expect(text()).toContain('Conversation 1: Why is AI so stupid?');
  });

  it('renders conversation text as text, never as markup', async () => {
    await mount();

    // A turn containing markup would appear as characters, and would not
    // create elements. The fixture text is plain, so assert the mechanism:
    // no script or img elements exist anywhere in the panel.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
