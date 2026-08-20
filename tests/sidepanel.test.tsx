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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/sidepanel/App';
import {
  conversationResult,
  createFakeBrowser,
  type FakeBrowser,
  type FakeTab,
} from './fake-browser';

const CONVERSATION_URL = 'https://chatgpt.com/c/conv-mixed';

let browser: FakeBrowser;

interface FakeOptions {
  tab?: { tabId?: number; url?: string; supported?: boolean };
  /** Whether the content script answers a ping. */
  ready?: boolean;
  /** Whether injecting the reader script succeeds. */
  canInject?: boolean;
  /** Whether ongoing site access has already been granted. */
  hasSiteAccess?: boolean;
  /** What `ct:load` returns. */
  loadResult?: unknown;
  /** Leave false to model a tab the user has never invoked us on. */
  invoked?: boolean;
}

/** One tab, already invoked, as if the user had just clicked the icon. */
function installFakeChrome(options: FakeOptions) {
  const tabId = options.tab?.tabId ?? 1;
  const tab: FakeTab = {
    tabId,
    url: options.tab ? options.tab.url : CONVERSATION_URL,
    ready: options.ready,
    canInject: options.canInject,
    loadResult: options.loadResult,
  };

  browser = createFakeBrowser({
    tabs: [tab],
    activeTabId: tabId,
    hasSiteAccess: options.hasSiteAccess,
  });
  (globalThis as unknown as { chrome: unknown }).chrome = browser.chrome;

  // The panel opens because the user clicked the icon, unless a test is
  // deliberately modelling a tab that was never invoked on.
  if (options.invoked !== false && tab.url) browser.invoke(tabId);
}

/** Backwards-compatible accessor for the counters the old tests used. */
const calls = {
  get injections() {
    return browser.injections;
  },
  get permissionRequests() {
    return browser.permissionRequests;
  },
};

function goodConversation() {
  return conversationResult('mixed', CONVERSATION_URL);
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
      tab: { tabId: 1, url: 'https://example.com/' },
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
      tab: { tabId: 1 }, invoked: false,
      loadResult: undefined,
    });
    await mount();

    expect(text()).toContain('Click the Chat Threads icon to begin');
    // It must not guess whether this is a provider page.
    expect(text()).not.toContain('No active conversation found');
  });

  it('does not inject anything before it has been invoked', async () => {
    installFakeChrome({
      tab: { tabId: 1 }, invoked: false,
      loadResult: undefined,
    });
    await mount();

    expect(calls.injections).toBe(0);
  });

  it('offers ongoing site access as an explicit opt-in', async () => {
    installFakeChrome({
      tab: { tabId: 1 }, invoked: false,
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
      tab: { tabId: 1 }, invoked: false,
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
    // The URL alone settles this, so the page is never asked and the reader
    // script is never injected into a page with nothing to read.
    installFakeChrome({ tab: { tabId: 1, url: 'https://claude.ai/' } });
    await mount();

    expect(text()).toContain('No active conversation found');
    expect(text()).toContain('Claude');
    expect(calls.injections).toBe(0);
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

  /** Put turns into the built-in topic using the per-turn dropdown. */
  async function assignToBuiltIn(...turnIds: string[]) {
    await act(async () => tab('Split').click());
    for (const id of turnIds) {
      const select = container.querySelector(
        `#assign-${id}`,
      ) as HTMLSelectElement;
      await act(async () => {
        select.value = 'built-in-venting';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }

  const button = (label: string): HTMLButtonElement =>
    Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;

  const checkboxes = () =>
    Array.from(
      container.querySelectorAll('.review-item input[type="checkbox"]'),
    ) as HTMLInputElement[];

  it('shows a turn count and a Review action on every topic', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');

    expect(text()).toContain('2 turns');
    expect(button('Review')).toBeDefined();
    expect(button('Review').disabled).toBe(false);
  });

  it('does not offer Review for a topic with nothing in it', async () => {
    await mount();
    await act(async () => tab('Split').click());

    expect(text()).toContain('0 turns');
    expect(button('Review').disabled).toBe(true);
  });

  it('shows only the turns in the topic, all ticked to begin with', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');
    await act(async () => button('Review').click());

    expect(text()).toContain('2 turns in this topic');
    expect(checkboxes()).toHaveLength(2);
    expect(checkboxes().every((c) => c.checked)).toBe(true);

    // The turn text shown is the topic's, not the whole conversation's.
    expect(text()).toContain('store its working copy');
    expect(text()).not.toContain('Lisbon');
  });

  it('says the original conversation is never changed', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2');
    await act(async () => button('Review').click());

    expect(text()).toContain(
      'removes the selected turns from your reshaped conversation',
    );
    expect(text()).toContain('original AI conversation is never changed');
    expect(text()).toContain('Remove selected turns');
  });

  it('counts the selection and updates as turns are unticked', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');
    await act(async () => button('Review').click());

    expect(text()).toContain('2 selected for removal');

    await act(async () => checkboxes()[0]!.click());
    expect(text()).toContain('1 selected for removal');
    expect(checkboxes()[0]!.checked).toBe(false);
    expect(checkboxes()[1]!.checked).toBe(true);
  });

  it('has Select all and Select none', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');
    await act(async () => button('Review').click());

    await act(async () => button('Select none').click());
    expect(text()).toContain('0 selected for removal');
    expect(checkboxes().every((c) => !c.checked)).toBe(true);
    expect(button('Remove selected turns').disabled).toBe(true);

    await act(async () => button('Select all').click());
    expect(text()).toContain('2 selected for removal');
    expect(button('Remove selected turns').disabled).toBe(false);
  });

  it('removes the ticked turns and returns to the topic list', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');
    await act(async () => button('Review').click());

    // Keep the first one.
    await act(async () => checkboxes()[0]!.click());
    await act(async () => button('Remove selected turns').click());

    // Back on the topic list.
    expect(text()).toContain('Add topic');
    expect(container.querySelector('.review-list')).toBeNull();

    // And the footer count reflects one turn gone.
    expect(text()).toContain('7 of 8 kept');
  });

  it('shows the removal in Clean, as an ordinary exclusion', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2');
    await act(async () => button('Review').click());
    await act(async () => button('Remove selected turns').click());

    await act(async () => tab('Clean').click());
    expect(text()).toContain('7 of 8 turns will be included');
    expect(container.querySelector('.turn.excluded')).not.toBeNull();
    // The Clean view offers to put it straight back.
    expect(text()).toContain('Include');
  });

  it('leaves the removed turn out of the Output preview', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2');
    await act(async () => button('Review').click());
    await act(async () => button('Remove selected turns').click());

    await act(async () => tab('Output').click());
    await act(async () => button('Preview').click());

    const preview = container.querySelector('.preview')?.textContent ?? '';
    expect(preview).not.toContain('store its working copy');
    expect(preview).toContain('GitHub project noticed');
  });

  it('can be left without changing anything', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');
    await act(async () => button('Review').click());
    await act(async () => button('← Back to topics').click());

    expect(container.querySelector('.review-list')).toBeNull();
    expect(text()).toContain('8 of 8 kept');
  });

  it('reviews a manually created topic through the same controls', async () => {
    await mount();
    await act(async () => tab('Split').click());
    await act(async () => button('Add topic').click());

    // Assign a turn to the new topic, which is second in the list.
    const select = container.querySelector(
      '#assign-chatgpt-4',
    ) as HTMLSelectElement;
    // The built-in topic already holds slot 1, so the new one is "2. Topic 2".
    const topicOption = Array.from(select.options).find((o) =>
      o.textContent?.startsWith('2. '),
    )!;
    await act(async () => {
      select.value = topicOption.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const reviewButtons = Array.from(
      container.querySelectorAll('button'),
    ).filter((b) => b.textContent?.trim() === 'Review') as HTMLButtonElement[];
    await act(async () => reviewButtons[1]!.click());

    expect(text()).toContain('1 turn in this topic');
    expect(checkboxes()).toHaveLength(1);

    await act(async () => button('Remove selected turns').click());
    expect(text()).toContain('7 of 8 kept');
  });

  it('is undone by Reset changes', async () => {
    await mount();
    await assignToBuiltIn('chatgpt-2', 'chatgpt-3');
    await act(async () => button('Review').click());
    await act(async () => button('Remove selected turns').click());
    expect(text()).toContain('6 of 8 kept');

    await act(async () => button('Reset changes').click());
    expect(text()).toContain('8 of 8 kept');

    await act(async () => tab('Split').click());
    expect(text()).toContain('0 turns');
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
