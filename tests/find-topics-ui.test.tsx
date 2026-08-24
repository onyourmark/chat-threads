/**
 * @vitest-environment jsdom
 *
 * What the Find Topics panel says before, during and after a long run.
 *
 * A conversation that has to be sent in sections takes minutes and costs more
 * than one request, so two things have to be true of the panel and neither is
 * checked by the analysis tests: it has to say how many requests the user is
 * agreeing to *before* they press the button, and it has to keep visibly
 * moving while it works — including a way to stop.
 *
 * These mount the real component against a controlled analyzer. Nothing here
 * touches a network or a key.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AnalysisInput,
  AnalysisProgress,
  AnalyzeOptions,
  AnalyzerResult,
} from '../src/ai/types';
import type { TopicProposal } from '../src/ai/schema';

/** One run the test drives by hand. */
interface Run {
  options: AnalyzeOptions;
  resolve: (result: AnalyzerResult) => void;
}

const runs: Run[] = [];

vi.mock('../src/ai/apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai/apply')>();
  return {
    ...actual,
    createAnalyzer: () => ({
      id: 'test',
      label: 'Test',
      endpointOrigin: 'none',
      complete: async () => ({ ok: false as const, errors: ['unused'] }),
      analyze: (_input: AnalysisInput, options: AnalyzeOptions = {}) =>
        new Promise<AnalyzerResult>((resolve) => {
          runs.push({ options, resolve });
        }),
    }),
  };
});

const { FindTopics } = await import('../src/sidepanel/components/FindTopics');
const { planAnalysis } = await import('../src/ai/plan');
const { buildAnalysisInput } = await import('../src/ai/prompt');
const { buildLongConversation } = await import('./fixtures/long-conversation');
const { createWorkingState } = await import('../src/operations/working');
const { freezeConversation } = await import('../src/model/conversation');
const { normalizeChatGptConversation } = await import(
  '../src/adapters/chatgpt/normalize'
);
const { chatgptMixedTopics } = await import('./fixtures/chatgpt');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

/** Enough of `chrome` for the settings module and the permission prompt. */
const chromeStub = {
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
  permissions: { contains: async () => true, request: async () => true },
};

let container: HTMLDivElement;
let root: Root;
const proposals: TopicProposal[] = [];

function smallState() {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/conv-mixed',
        method: 'test',
      }),
    ),
  );
}

async function mount(state: ReturnType<typeof smallState>) {
  (globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(
      <FindTopics state={state} onProposal={(p) => proposals.push(p)} />,
    );
  });
  await settle();
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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

/** Open the section, put a key in, and press the button. */
async function start() {
  await act(async () => button('Set up')!.click());
  const key = container.querySelector('#ai-key') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  await act(async () => {
    setValue.call(key, 'a-test-key');
    key.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Send and find topics')!.click());
  await settle();
}

afterEach(() => {
  runs.length = 0;
  proposals.length = 0;
  act(() => root.unmount());
  container.remove();
});

// ------------------------------------------------------------ disclosure ---

describe('what the panel says before anything is sent', () => {
  it('says nothing about sections for an ordinary conversation', async () => {
    await mount(smallState());
    await act(async () => button('Set up')!.click());

    expect(text()).toContain('characters');
    expect(text()).not.toContain('sections');
    expect(button('Send and find topics')!.disabled).toBe(false);
  });

  it('names the number of sections and requests for a long one', async () => {
    const state = buildLongConversation({ turns: 866, charsPerTurn: 794 });
    const plan = planAnalysis(buildAnalysisInput(state));
    await mount(state);
    await act(async () => button('Set up')!.click());

    expect(plan.mode).toBe('sections');
    expect(text()).toContain(`${plan.sectionCount} sections`);
    expect(text()).toContain(`${plan.requests} requests`);
    expect(text()).toContain('you can stop it at any time');
    expect(button('Send and find topics')!.disabled).toBe(false);
  });

  it('refuses, with a reason, when even sections would be unreasonable', async () => {
    const state = buildLongConversation({ turns: 4000, charsPerTurn: 1400 });
    await mount(state);
    await act(async () => button('Set up')!.click());

    expect(text()).toMatch(/too long to analyse automatically/i);
    expect(button('Send and find topics')!.disabled).toBe(true);
    expect(runs).toHaveLength(0);
  });
});

// -------------------------------------------------------------- progress ---

describe('what the panel shows while a long run works', () => {
  async function startLongRun() {
    const state = buildLongConversation({ turns: 500 });
    await mount(state);
    await start();
    expect(runs).toHaveLength(1);
    return runs[0]!;
  }

  async function report(run: Run, progress: AnalysisProgress) {
    await act(async () => run.options.onProgress?.(progress));
  }

  it('names the step, in words about the conversation', async () => {
    const run = await startLongRun();

    await report(run, { phase: 'discover', section: 1, sections: 9 });
    expect(text()).toContain('reading section 1 of 9');

    await report(run, { phase: 'merge' });
    expect(text()).toContain('reconciling topics');

    await report(run, { phase: 'classify', section: 6, sections: 9 });
    expect(text()).toContain('sorting section 6 of 9');

    // Nothing about how the work is divided up internally.
    expect(text()).not.toMatch(/hierarchical|pass 1|taxonomy|chunk/i);
  });

  it('offers a way to stop, and honours it', async () => {
    const run = await startLongRun();
    await report(run, { phase: 'discover', section: 2, sections: 9 });

    expect(button('Stop')).toBeDefined();
    expect(run.options.signal!.aborted).toBe(false);

    await act(async () => button('Stop')!.click());
    expect(run.options.signal!.aborted).toBe(true);

    // The run notices and returns; the panel says so without shouting.
    await act(async () => {
      run.resolve({ ok: false, errors: ['The request was cancelled.'] });
    });
    await settle();

    expect(text()).toContain('Stopped. Nothing was changed.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(proposals).toHaveLength(0);
  });

  it('does not offer Stop when nothing is running', async () => {
    const state = buildLongConversation({ turns: 500 });
    await mount(state);
    await act(async () => button('Set up')!.click());

    expect(button('Stop')).toBeUndefined();
  });

  it('shows the provider\'s own explanation when a run fails', async () => {
    const run = await startLongRun();

    await act(async () => {
      run.resolve({
        ok: false,
        errors: [
          'The request was too large for this model, even after being split.',
        ],
      });
    });
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'too large for this model',
    );
    expect(proposals).toHaveLength(0);
  });

  it('hands back the proposal when the run succeeds', async () => {
    const run = await startLongRun();

    await act(async () => {
      run.resolve({
        ok: true,
        proposal: {
          topics: [{ id: 'c1', name: 'One topic' }],
          assignments: [{ turn: 0, topic: 'c1', uncertain: false }],
          unplaced: [],
          notes: [],
        },
      });
    });
    await settle();

    expect(proposals).toHaveLength(1);
    expect(text()).toContain('Suggested 1 topic');
  });
});
