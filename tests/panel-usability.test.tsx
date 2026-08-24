/**
 * @vitest-environment jsdom
 *
 * The things a person noticed while using this on a real 876-turn chat.
 *
 * Every case here came from that session: a message pointing the wrong way,
 * a panel that could not be made bigger, no way to get fifteen topics out
 * without fifteen clicks, and typing a topic name that took seconds to appear
 * because every keystroke re-rendered eight hundred and seventy-six cards.
 */

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputView } from '../src/sidepanel/components/OutputView';
import { SplitView } from '../src/sidepanel/components/SplitView';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import {
  addTopic,
  createWorkingState,
  setAssignment,
  type WorkingState,
} from '../src/operations/working';
import {
  DEFAULT_ZOOM,
  nearestStep,
  stepFrom,
  zoomLabel,
  ZOOM_STEPS,
} from '../src/sidepanel/zoom';
import { chatgptMixedTopics } from './fixtures/chatgpt';

const CSS = readFileSync('src/sidepanel/styles.css', 'utf8');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;

function base(): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/conv-mixed',
        method: 'test',
      }),
    ),
  );
}

/** A conversation split across two topics, so Output has something to export. */
function split(): WorkingState {
  let state = addTopic(addTopic(base(), 'Travel plans'), 'Why not both?');
  const [a, b] = state.topics.filter((t) => !t.builtIn);
  state = setAssignment(state, 'chatgpt-0', a!.id);
  state = setAssignment(state, 'chatgpt-1', a!.id);
  state = setAssignment(state, 'chatgpt-2', b!.id);
  return state;
}

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

/** Type into a controlled React input the way a person would. */
function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  const mounted = root;
  if (mounted) {
    act(() => mounted.unmount());
    container.remove();
    root = undefined;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------- export -----

describe('exporting every topic at once', () => {
  /** Record what the page tried to save, without a real filesystem. */
  function captureDownloads(): Array<{ name: string; blob: Blob }> {
    const saved: Array<{ name: string; blob: Blob }> = [];
    const urls = new Map<string, Blob>();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        const url = `blob:${urls.size}`;
        urls.set(url, blob);
        return url;
      },
      revokeObjectURL: () => {},
    });
    const click = HTMLAnchorElement.prototype.click;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function mocked(this: HTMLAnchorElement) {
        saved.push({ name: this.download, blob: urls.get(this.href)! });
      },
    );
    void click;
    return saved;
  }

  it('offers one file per conversation, named after the topic', () => {
    mount(<OutputView state={split()} />);

    expect(text()).toContain('Export everything');
    // Cleaned, plus the two topics that have turns in them.
    expect(text()).toContain('3 files');
    expect(button('Download .zip')).toBeDefined();
    expect(button('Download separately')).toBeDefined();
  });

  it('saves one archive, named after the conversation', async () => {
    const saved = captureDownloads();
    mount(<OutputView state={split()} />);

    await act(async () => button('Download .zip')!.click());

    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toMatch(/\.zip$/);
    expect(saved[0]!.blob.type).toBe('application/zip');
    expect(saved[0]!.blob.size).toBeGreaterThan(0);
    expect(text()).toMatch(/Saved 3 files/);
  });

  it('saves the files one by one when asked to', async () => {
    const saved = captureDownloads();
    mount(<OutputView state={split()} />);

    await act(async () => {
      await button('Download separately')!.click();
    });
    // The staggering is what makes Chrome accept a burst; wait it out.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });

    expect(saved).toHaveLength(3);
    expect(saved.every((f) => f.name.endsWith('.md'))).toBe(true);
    expect(saved.map((f) => f.name)).toContain('Travel plans.md');
  });

  it('exports plain text when that is the chosen format', async () => {
    const saved = captureDownloads();
    mount(<OutputView state={split()} />);

    const plain = [...container.querySelectorAll('input[type="checkbox"]')].find(
      (i) => i.closest('label')?.textContent?.includes('Plain text'),
    ) as HTMLInputElement;
    act(() => plain.click());

    expect(text()).toContain('as plain text');
    await act(async () => button('Download .zip')!.click());
    expect(saved).toHaveLength(1);
  });

  it('says nothing about exporting when there is only one conversation', () => {
    mount(<OutputView state={base()} />);
    expect(text()).not.toContain('Export everything');
  });
});

// --------------------------------------------------------------- zoom -----

describe('making the panel bigger', () => {
  it('steps through sizes and stops at the ends', () => {
    expect(nearestStep(1)).toBe(1);
    expect(nearestStep(1.13)).toBe(1.1);
    expect(stepFrom(1, 1)).toBe(1.1);
    expect(stepFrom(1, -1)).toBe(0.9);

    // No wrapping: the smallest stays smallest.
    expect(stepFrom(ZOOM_STEPS[0], -1)).toBe(ZOOM_STEPS[0]);
    expect(stepFrom(ZOOM_STEPS[ZOOM_STEPS.length - 1]!, 1)).toBe(
      ZOOM_STEPS[ZOOM_STEPS.length - 1],
    );
  });

  it('reads as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(1.25)).toBe('125%');
    expect(zoomLabel(0.8)).toBe('80%');
    expect(DEFAULT_ZOOM).toBe(1);
  });

  it('offers a size either side of the browser default', () => {
    expect(Math.min(...ZOOM_STEPS)).toBeLessThan(1);
    expect(Math.max(...ZOOM_STEPS)).toBeGreaterThan(1);
    expect(ZOOM_STEPS).toContain(1);
  });
});

// -------------------------------------------------------- responsiveness --

describe('typing a topic name on a long conversation', () => {
  it('shows what was typed without waiting for the whole panel', () => {
    let state = addTopic(base(), 'Start');
    let renders = 0;
    const onChange = vi.fn((next: WorkingState) => {
      renders += 1;
      state = next;
    });

    mount(
      <SplitView
        state={state}
        onChange={onChange}
        proposalNotes={null}
        onProposal={() => {}}
        onClearNotes={() => {}}
      />,
    );

    const input = [...container.querySelectorAll('input[type="text"]')].find(
      (i) => (i as HTMLInputElement).value === 'Start',
    ) as HTMLInputElement;

    for (const value of ['S', 'St', 'Sta', 'Stag', 'Staging']) {
      type(input, value);
      // The box shows the letter immediately, whatever the rest of the panel
      // is doing.
      expect(input.value).toBe(value);
    }

    // And the conversation was not rebuilt once per keystroke.
    expect(renders).toBe(0);
  });

  it('commits the name when the field is left', () => {
    let state = addTopic(base(), 'Start');
    const onChange = vi.fn((next: WorkingState) => {
      state = next;
    });

    mount(
      <SplitView
        state={state}
        onChange={onChange}
        proposalNotes={null}
        onProposal={() => {}}
        onClearNotes={() => {}}
      />,
    );

    const input = [...container.querySelectorAll('input[type="text"]')].find(
      (i) => (i as HTMLInputElement).value === 'Start',
    ) as HTMLInputElement;

    type(input, 'Staging');
    // React listens for focusout, not blur, so that is what a real blur
    // reaches the component as.
    act(() =>
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(state.topics.map((t) => t.name)).toContain('Staging');
  });

  it('leaves the off-screen turn cards to the browser', () => {
    // `content-visibility` is what stopped scrolling being choppy: the cards
    // stay in the document, so find and "Go to branch point" still reach
    // them, but the browser skips drawing what nobody is looking at.
    const turn = CSS.slice(CSS.indexOf('\n.turn {'));
    expect(turn).toMatch(/content-visibility:\s*auto/);
    expect(turn).toMatch(/contain-intrinsic-size:\s*auto/);
  });
});

// ------------------------------------------------------------- wording ----

describe('what the panel says when it has finished', () => {
  it('points at the topic list, which is above the button', () => {
    const source = readFileSync(
      'src/sidepanel/components/FindTopics.tsx',
      'utf8',
    );
    expect(source).toContain('Review them above.');
    expect(source).not.toContain('Review them below.');
  });

  it('warns how long a long conversation will take', () => {
    const source = readFileSync(
      'src/sidepanel/components/FindTopics.tsx',
      'utf8',
    );
    expect(source).toContain('Expect it to take about');
  });
});
