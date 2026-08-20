/**
 * @vitest-environment jsdom
 *
 * Tab and conversation binding, through the real panel.
 *
 * Live testing found that starting Find Topics in one ChatGPT tab and then
 * switching to another appeared to move the conversation: the panel followed
 * the active tab and reloaded, discarding the work in the first one. These
 * tests drive the mounted `App` against a fake browser with two tabs, which is
 * the smallest arrangement in which that bug is expressible.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopicProposal } from '../src/ai/schema';
import type { AnalysisInput, AnalyzerResult } from '../src/ai/types';

/**
 * A model call the test controls. Only `createAnalyzer` is replaced; applying
 * a proposal stays the real implementation, so what is under test is where the
 * answer goes rather than a stub of the whole feature.
 */
const pending: Array<{
  input: AnalysisInput;
  resolve: (result: AnalyzerResult) => void;
}> = [];

vi.mock('../src/ai/apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai/apply')>();
  return {
    ...actual,
    createAnalyzer: () => ({
      id: 'test',
      label: 'Test',
      endpointOrigin: 'none',
      analyze: (input: AnalysisInput) =>
        new Promise<AnalyzerResult>((resolve) => {
          pending.push({ input, resolve });
        }),
    }),
  };
});

const { App } = await import('../src/sidepanel/App');
const { conversationResult, createFakeBrowser } = await import('./fake-browser');
type FakeBrowser = Awaited<
  ReturnType<typeof import('./fake-browser').createFakeBrowser>
>;

const URL_A = 'https://chatgpt.com/c/conv-a';
const URL_B = 'https://chatgpt.com/c/conv-b';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Two tabs: A holding the mixed-topic chat, B holding the venting one. */
function twoTabs(): FakeBrowser {
  return createFakeBrowser({
    tabs: [
      { tabId: 1, url: URL_A, loadResult: conversationResult('mixed', URL_A) },
      { tabId: 2, url: URL_B, loadResult: conversationResult('venting', URL_B) },
    ],
    activeTabId: 1,
    hasSiteAccess: true,
  });
}

async function mount(b: FakeBrowser) {
  (globalThis as unknown as { chrome: unknown }).chrome = b.chrome;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await settle();
}

/** Let the panel's promise chains finish. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  pending.length = 0;
});

const text = () => container.textContent ?? '';

const tab = (label: string): HTMLButtonElement =>
  Array.from(container.querySelectorAll('[role="tab"]')).find(
    (t) => t.textContent === label,
  ) as HTMLButtonElement;

const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

/** Exclude the first turn, so the session has a visible change in it. */
async function excludeFirstTurn() {
  await act(async () => tab('Clean').click());
  await act(async () => button('Exclude')!.click());
}

describe('switching tabs does not move the conversation', () => {
  it('does not load a conversation just because a tab became active', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    expect(text()).toContain('8 turns loaded');

    await act(async () => b.activate(2));
    await settle();

    // Tab 2 was never invoked on, so nothing was read from it.
    expect(b.loads.get(2) ?? 0).toBe(0);
    expect(b.injections).toBe(0);
  });

  it('shows nothing from another tab in a tab never invoked on', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);

    await act(async () => b.activate(2));
    await settle();

    expect(text()).toContain('Ready when you are');
    // Conversation A's content must not be on screen while looking at tab 2.
    expect(text()).not.toContain('8 turns loaded');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('still has the first conversation when the user comes back', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await excludeFirstTurn();
    expect(text()).toContain('7 of 8 kept');

    await act(async () => b.activate(2));
    await settle();
    await act(async () => b.activate(1));
    await settle();

    // Same conversation, same edit, and it was not read again.
    expect(text()).toContain('8 turns loaded');
    expect(text()).toContain('7 of 8 kept');
    expect(b.loads.get(1)).toBe(1);
  });
});

describe('two tabs keep separate state', () => {
  it('loads each tab only when invoked on it, and keeps both', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await excludeFirstTurn();

    await act(async () => b.invoke(2));
    await settle();

    // B has its own conversation, untouched by A's edit.
    expect(text()).toContain('11 turns loaded');
    expect(text()).toContain('11 of 11 kept');

    await act(async () => b.activate(1));
    await settle();
    expect(text()).toContain('8 turns loaded');
    expect(text()).toContain('7 of 8 kept');
  });

  it('keeps edits in one tab out of the other', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);

    await act(async () => b.invoke(2));
    await settle();
    await excludeFirstTurn();
    expect(text()).toContain('10 of 11 kept');

    await act(async () => b.activate(1));
    await settle();
    expect(text()).toContain('8 of 8 kept');
  });

  it('resets only the session it was pressed in', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await excludeFirstTurn();

    await act(async () => b.invoke(2));
    await settle();
    await excludeFirstTurn();
    expect(text()).toContain('10 of 11 kept');

    await act(async () => button('Reset changes')!.click());
    expect(text()).toContain('11 of 11 kept');

    await act(async () => b.activate(1));
    await settle();
    expect(text()).toContain('7 of 8 kept');
  });

  it('reloads only the tab it was pressed in', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await excludeFirstTurn();

    await act(async () => b.invoke(2));
    await settle();
    await act(async () => button('Reload')!.click());
    await settle();

    expect(b.loads.get(2)).toBe(2);
    expect(b.loads.get(1)).toBe(1);

    await act(async () => b.activate(1));
    await settle();
    expect(text()).toContain('7 of 8 kept');
  });

  it('forgets a tab once it is closed, without disturbing the other', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await act(async () => b.invoke(2));
    await settle();

    await act(async () => b.close(2));
    await act(async () => b.activate(1));
    await settle();

    expect(text()).toContain('8 turns loaded');
  });
});

describe('navigating one tab to a different conversation', () => {
  it('does not carry the previous conversation over', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await excludeFirstTurn();

    await act(async () =>
      b.navigate(1, URL_B, conversationResult('venting', URL_B)),
    );
    await settle();

    expect(text()).toContain('This tab is now showing a different conversation');
    expect(text()).not.toContain('7 of 8 kept');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('waits to be asked before loading the new conversation', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);

    await act(async () =>
      b.navigate(1, URL_B, conversationResult('venting', URL_B)),
    );
    await settle();
    expect(b.loads.get(1)).toBe(1);

    await act(async () =>
      button('Open Chat Threads for this conversation')!.click(),
    );
    await settle();

    expect(b.loads.get(1)).toBe(2);
    expect(text()).toContain('11 turns loaded');
    expect(text()).toContain('11 of 11 kept');
  });

  it('finds the first conversation again if the tab navigates back', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await excludeFirstTurn();

    await act(async () =>
      b.navigate(1, URL_B, conversationResult('venting', URL_B)),
    );
    await settle();
    await act(async () =>
      b.navigate(1, URL_A, conversationResult('mixed', URL_A)),
    );
    await settle();

    expect(text()).toContain('7 of 8 kept');
  });
});

describe('a slow Find Topics stays with the conversation that asked', () => {
  /** Open Split, fill in a key, and press the button. */
  async function startFindTopics() {
    await act(async () => tab('Split').click());
    await act(async () => button('Set up')!.click());

    const key = container.querySelector('#ai-key') as HTMLInputElement;
    // React tracks the previous value on the node, so assigning `.value`
    // directly leaves it thinking nothing changed. Go through the native
    // setter so the tracker updates and onChange fires.
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setValue.call(key, 'test-key');
      key.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Send and find topics')!.click());
    await settle();
  }

  /** A proposal that puts turn 0 into a topic of its own. */
  function proposal(): TopicProposal {
    return {
      topics: [{ id: 't1', name: 'Found topic', description: 'x' }],
      assignments: [{ turn: 0, topic: 't1', uncertain: false }],
      unplaced: [],
      notes: [],
    };
  }

  it('applies the result to the originating tab, not the active one', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await startFindTopics();
    expect(pending).toHaveLength(1);

    // The user goes to tab 2 and works there while the request runs.
    await act(async () => b.invoke(2));
    await settle();
    expect(text()).toContain('11 turns loaded');

    await act(async () => {
      pending[0]!.resolve({ ok: true, proposal: proposal() });
    });
    await settle();

    // Tab 2 gained nothing: still only its built-in topic, nothing assigned.
    await act(async () => tab('Split').click());
    expect(text()).not.toContain('Found topic');

    // Tab 1 has the result.
    await act(async () => b.activate(1));
    await settle();
    await act(async () => tab('Split').click());
    expect(text()).toContain('Found topic');
  });

  it('discards a result for a conversation the tab has left', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await startFindTopics();

    // The same tab moves to a different conversation, and the user loads it.
    await act(async () =>
      b.navigate(1, URL_B, conversationResult('venting', URL_B)),
    );
    await settle();
    await act(async () =>
      button('Open Chat Threads for this conversation')!.click(),
    );
    await settle();

    await act(async () => {
      pending[0]!.resolve({ ok: true, proposal: proposal() });
    });
    await settle();

    // Conversation B must not have inherited A's analysis.
    await act(async () => tab('Split').click());
    expect(text()).toContain('11 turns');
    expect(text()).not.toContain('Found topic');
  });

  it('discards a result from before the session was reloaded', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await startFindTopics();

    await act(async () => button('Reload')!.click());
    await settle();

    await act(async () => {
      pending[0]!.resolve({ ok: true, proposal: proposal() });
    });
    await settle();

    await act(async () => tab('Split').click());
    expect(text()).not.toContain('Found topic');
  });

  it('keeps edits made while the request was running', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await startFindTopics();

    await excludeFirstTurn();
    expect(text()).toContain('7 of 8 kept');

    await act(async () => {
      pending[0]!.resolve({ ok: true, proposal: proposal() });
    });
    await settle();

    // The result was applied on top of the live state, not a stale copy.
    expect(text()).toContain('7 of 8 kept');
    await act(async () => tab('Split').click());
    expect(text()).toContain('Found topic');
  });

  it('sends only the conversation it was started on', async () => {
    const b = twoTabs();
    b.invoke(1);
    await mount(b);
    await startFindTopics();

    const sent = pending[0]!.input.turns.map((t) => t.text).join(' ');
    expect(sent).toContain('browser extension');
    expect(sent).not.toContain('refactor this function');
  });
});
