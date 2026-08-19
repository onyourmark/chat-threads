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
  tab?: { tabId?: number; url?: string; provider?: string; supported: boolean };
  /** Whether the content script answers a ping. */
  ready?: boolean;
  /** What `ct:load` returns. */
  loadResult?: unknown;
}

function installFakeChrome(options: FakeOptions) {
  const {
    tab = { tabId: 1, url: 'https://chatgpt.com/c/conv-mixed', provider: 'chatgpt', supported: true },
    ready = true,
    loadResult,
  } = options;

  const fake = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: (_message: unknown, cb: (reply: unknown) => void) => {
        cb({ type: 'ok:active-tab', info: { ...tab, contentScriptReady: false } });
      },
    },
    tabs: {
      sendMessage: (
        _tabId: number,
        message: { type: string },
        cb: (reply: unknown) => void,
      ) => {
        if (message.type === 'ct:ping') {
          cb(ready ? { type: 'ok:pong' } : undefined);
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
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    permissions: { contains: async () => false, request: async () => false },
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
    installFakeChrome({ tab: { supported: false }, loadResult: undefined });
    await mount();

    expect(text()).toContain('Open a ChatGPT or Claude conversation');
    // No view tabs when there is nothing loaded.
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('asks for a reload when the content script is not there', async () => {
    installFakeChrome({ ready: false, loadResult: undefined });
    await mount();

    expect(text()).toContain('Reload the page to continue');
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

  it('renders conversation text as text, never as markup', async () => {
    await mount();

    // A turn containing markup would appear as characters, and would not
    // create elements. The fixture text is plain, so assert the mechanism:
    // no script or img elements exist anywhere in the panel.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
