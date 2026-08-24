/**
 * @vitest-environment jsdom
 *
 * The branch indicator, and getting to the turn it names.
 *
 * The point of the feature is not detection, it is arrival: a person who
 * branched a conversation months ago wants to land on the turn, in a list of
 * hundreds, without searching. These mount the real components and check that
 * pressing the button reaches the right card, that the card says so, and that
 * an ordinary conversation shows none of it.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BranchBanner } from '../src/sidepanel/components/BranchBanner';
import { CleanView } from '../src/sidepanel/components/CleanView';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { createWorkingState, type WorkingState } from '../src/operations/working';
import type { TurnFocus } from '../src/sidepanel/branch-view';
import {
  chatgptBranched,
  chatgptBranchedForeignOwner,
  chatgptBranchedNoMessageId,
  chatgptLongBranched,
  chatgptNoBranch,
} from './fixtures/chatgpt-branch';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function state(payload: unknown): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(payload, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    ),
  );
}

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

function rerender(node: React.ReactElement) {
  act(() => root.render(node));
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// -------------------------------------------------------------- banner ----

describe('the branch indicator', () => {
  it('names the turn, quotes it, and offers to go there', () => {
    const s = state(chatgptBranched);
    mount(<BranchBanner state={s} onGoToTurn={() => {}} />);

    // Sequence 3, shown as Turn 4 — the same number the turn card shows.
    expect(text()).toContain('Branch point: Turn 4');
    expect(text()).toContain('1:1:1 by weight');
    expect(text()).toContain('Sourdough starter');
    expect(button('Go to branch point')).toBeDefined();
  });

  it('hands back the id of the turn the branch came from', () => {
    const s = state(chatgptBranched);
    const seen: string[] = [];
    mount(<BranchBanner state={s} onGoToTurn={(id) => seen.push(id)} />);

    act(() => button('Go to branch point')!.click());
    expect(seen).toEqual(['chatgpt-3']);
  });

  it('offers to open the original, under Details, when it belongs to the user', () => {
    mount(<BranchBanner state={state(chatgptBranched)} onGoToTurn={() => {}} />);

    expect(container.querySelector('a')).toBeNull();
    act(() => button('Details')!.click());

    const link = container.querySelector('a') as HTMLAnchorElement | null;
    expect(link?.textContent).toBe('Open original conversation');
    expect(link?.href).toBe('https://chatgpt.com/c/conv-plain');
  });

  it('does not offer to open a conversation belonging to someone else', () => {
    mount(
      <BranchBanner
        state={state(chatgptBranchedForeignOwner)}
        onGoToTurn={() => {}}
      />,
    );

    expect(text()).toContain('Branch point');
    act(() => button('Details')!.click());

    expect(container.querySelector('a')).toBeNull();
    expect(text()).toMatch(/belongs to another account/i);
  });

  it('says how it worked the point out, once asked', () => {
    mount(
      <BranchBanner
        state={state(chatgptBranchedNoMessageId)}
        onGoToTurn={() => {}}
      />,
    );

    // Not by default: it is an explanation, not an action.
    expect(text()).not.toMatch(/not the exact message/i);

    act(() => button('Details')!.click());
    expect(text()).toMatch(/not the exact message/i);
  });

  it('renders nothing at all for an ordinary conversation', () => {
    mount(<BranchBanner state={state(chatgptNoBranch)} onGoToTurn={() => {}} />);

    expect(text()).toBe('');
    expect(container.querySelector('.branch-banner')).toBeNull();
  });
});

// ----------------------------------------------------------- the badge ----

describe('the badge on the turn itself', () => {
  it('marks the branch point and nothing else', () => {
    const s = state(chatgptBranched);
    mount(<CleanView state={s} onChange={() => {}} />);

    const badges = [...container.querySelectorAll('.badge.branch')];
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toBe('Branch point');

    const marked = badges[0]!.closest('.turn')!;
    expect(marked.textContent).toContain('Turn 4');
    expect(marked.textContent).toContain('1:1:1 by weight');
  });

  it('is absent from a conversation that was never branched', () => {
    mount(<CleanView state={state(chatgptNoBranch)} onChange={() => {}} />);
    expect(container.querySelectorAll('.badge.branch')).toHaveLength(0);
  });
});

// ------------------------------------------------------- getting there ----

describe('going to the branch point', () => {
  it('scrolls the right card into view and flashes it', () => {
    const s = state(chatgptLongBranched({ turns: 400, branchAt: 183 }));
    const scrolls: Element[] = [];
    // jsdom has no layout, so record the call rather than the movement.
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolls.push(this);
    };

    mount(<CleanView state={s} onChange={() => {}} focus={null} />);
    expect(scrolls).toHaveLength(0);

    const focus: TurnFocus = { turnId: 'chatgpt-183', nonce: 1 };
    rerender(<CleanView state={s} onChange={() => {}} focus={focus} />);

    expect(scrolls).toHaveLength(1);
    const card = scrolls[0] as HTMLElement;
    expect(card.className).toContain('turn');
    expect(card.textContent).toContain('Turn 184');
    expect(card.textContent).toContain('Turn 183 of the branched conversation');
    expect(card.className).toContain('flash');
  });

  it('scrolls again when the same turn is asked for twice', () => {
    const s = state(chatgptLongBranched({ turns: 200, branchAt: 40 }));
    let count = 0;
    Element.prototype.scrollIntoView = () => {
      count += 1;
    };

    mount(<CleanView state={s} onChange={() => {}} focus={null} />);
    const go = (nonce: number) =>
      rerender(
        <CleanView
          state={s}
          onChange={() => {}}
          focus={{ turnId: 'chatgpt-40', nonce }}
        />,
      );

    go(1);
    expect(count).toBe(1);
    go(2);
    expect(count).toBe(2);
  });

  it('reaches a turn hundreds of rows down, because every row is rendered', () => {
    const s = state(chatgptLongBranched({ turns: 866, branchAt: 183 }));
    mount(<CleanView state={s} onChange={() => {}} />);

    // No virtualisation: the card exists in the document before anyone
    // scrolls, which is what makes scrollIntoView reliable at this length.
    expect(container.querySelectorAll('.turn')).toHaveLength(866);
    const marked = container.querySelector('.badge.branch')!.closest('.turn')!;
    expect(marked.textContent).toContain('Turn 184');
  });
});
