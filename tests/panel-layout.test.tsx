/**
 * @vitest-environment jsdom
 *
 * The side panel has to stay usable, and the branch summary has to stay small.
 *
 * The first live run on a real 876-turn conversation exposed two layout
 * defects at once. The branch summary — turn number, a full excerpt, the whole
 * source title and a sentence of explanation — took a large share of a panel
 * about 400px wide, and the Split workspace beneath it was squeezed into
 * almost nothing. There was also a horizontal scrollbar. Zooming the ChatGPT
 * page changed neither, because the side panel is its own document.
 *
 * jsdom has no layout engine, so these tests hold down the two things that
 * actually caused it: the shape of the DOM, and the specific CSS declarations
 * that make a flex column behave. `min-height: 0` and `min-width: 0` are not
 * decoration — without them a flex item refuses to shrink below its content,
 * which is exactly how a 876-turn list pushed everything else off the panel.
 */

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { BranchBanner } from '../src/sidepanel/components/BranchBanner';
import { CleanView } from '../src/sidepanel/components/CleanView';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { createWorkingState, type WorkingState } from '../src/operations/working';
import { chatgptBranched, chatgptLongBranched } from './fixtures/chatgpt-branch';



/**
 * The declarations of every rule whose selector list contains `selector`.
 *
 * Innermost blocks only — the body of a rule never contains a brace — which
 * means rules nested inside `@media` are found the same way as top-level ones.
 */
function rule(selector: string): string {
  const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const m of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(',').map((x: string) => x.trim());
    if (selectors.includes(selector)) bodies.push(m[2]!);
  }
  if (bodies.length === 0) throw new Error(`no CSS rule for ${selector}`);
  return bodies.join('\n');
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

/*
  The real stylesheet, as text. These assertions are about declarations that
  have to survive an edit, so they read the file the extension actually ships
  rather than a copy that could drift from it. (Vitest stubs CSS imports, so
  this is read from disk rather than imported.)
*/
const CSS = readFileSync('src/sidepanel/styles.css', 'utf8');

let container: HTMLDivElement;
let root: Root | undefined;

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

/** Mount into a container the width of a real side panel. */
function mount(node: React.ReactElement, width = 400) {
  container = document.createElement('div');
  container.style.width = `${width}px`;
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

afterEach(() => {
  // Several tests here read the stylesheet and never mount anything.
  const mounted = root;
  if (!mounted) return;
  act(() => mounted.unmount());
  container.remove();
  root = undefined;
});

// ------------------------------------------------------- the flex column ---

describe('the panel gives its height to the tab content', () => {
  it('lets the scrolling region shrink, which is what makes flex: 1 mean anything', () => {
    const scroll = rule('.scroll');

    // The line the whole defect turned on. A flex item defaults to
    // `min-height: auto` — "never shrink below your content" — so 876 turns
    // made this box refuse to shrink and pushed the column out of the panel.
    expect(scroll).toMatch(/min-height:\s*0/);
    expect(scroll).toMatch(/flex:\s*1 1 auto/);
    expect(scroll).toMatch(/overflow-y:\s*auto/);
  });

  it('contains the column so the document itself never scrolls', () => {
    expect(rule('.app')).toMatch(/overflow:\s*hidden/);
    expect(rule('.app')).toMatch(/height:\s*100%/);
  });

  it('sizes the branch summary to its content and never lets it grow', () => {
    const banner = rule('.branch-banner');

    expect(banner).toMatch(/flex:\s*0 0 auto/);
    // A guard for the rare conversation with several branch points.
    expect(banner).toMatch(/max-height:\s*30vh/);
  });

  it('keeps the flash animation off for people who asked for that', () => {
    expect(CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
    const reduced = CSS.slice(CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/animation:\s*none/);
  });
});

// -------------------------------------------------- horizontal overflow ----

describe('nothing forces the panel sideways', () => {
  it('lets the containers that hold long things shrink', () => {
    // Flex children default to `min-width: auto`, their content's intrinsic
    // width. A long title, or an input (whose intrinsic width is about twenty
    // characters), then refuses to shrink and forces a horizontal scrollbar.
    for (const selector of ['.row', '.branch-line', '.topic-row']) {
      expect(rule(selector), selector).toMatch(/min-width:\s*0/);
    }
  });

  it('lets form controls shrink below their intrinsic width', () => {
    const inputs = rule("input[type='text']");
    expect(inputs).toMatch(/min-width:\s*0/);
    expect(inputs).toMatch(/max-width:\s*100%/);
  });

  it('truncates a long source title rather than widening the panel', () => {
    const source = rule('.branch-source');
    expect(source).toMatch(/text-overflow:\s*ellipsis/);
    expect(source).toMatch(/overflow:\s*hidden/);
    expect(source).toMatch(/white-space:\s*nowrap/);
  });

  it('clamps the excerpt to a couple of lines', () => {
    const excerpt = rule('.branch-excerpt');
    expect(excerpt).toMatch(/-webkit-line-clamp:\s*2/);
    expect(excerpt).toMatch(/overflow:\s*hidden/);
    expect(excerpt).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('wraps unbroken conversation text instead of stretching', () => {
    expect(rule('.turn-text')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

// --------------------------------------------------- the compact summary ---

describe('the branch summary stays small', () => {
  /** A branch with everything at its most verbose. */
  function verbose(): WorkingState {
    const s = state(chatgptBranched);
    const long =
      'Branch · Branch · 8.16 · a conversation title that simply keeps going and going far past any sensible width for a side panel';
    return {
      ...s,
      source: {
        ...s.source,
        branches: {
          status: 'found',
          points: [
            {
              ...s.source.branches.points[0]!,
              sourceConversationTitle: long,
              confidence: 'probable',
              detail:
                'ChatGPT recorded the branch but not the exact message, so the last turn before the branch was used.',
            },
          ],
        },
      },
    };
  }

  it('shows three short lines and hides the explanation', () => {
    mount(<BranchBanner state={verbose()} onGoToTurn={() => {}} />);

    expect(text()).toContain('Branch point: Turn 4');
    expect(text()).toContain('Branched from');
    // The sentence that used to take permanent vertical space.
    expect(text()).not.toMatch(/not the exact message/i);
    expect(button('Details')).toBeDefined();
  });

  it('keeps Go to branch point out of the disclosure', () => {
    mount(<BranchBanner state={verbose()} onGoToTurn={() => {}} />);

    const go = button('Go to branch point');
    expect(go).toBeDefined();
    // It is in the top line, not inside the collapsed part.
    expect(go!.closest('.branch-details')).toBeNull();
    expect(go!.closest('.branch-line')).not.toBeNull();
  });

  it('expands and collapses again', () => {
    mount(<BranchBanner state={verbose()} onGoToTurn={() => {}} />);

    const toggle = button('Details')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.branch-details')).toBeNull();

    act(() => toggle.click());
    expect(text()).toMatch(/not the exact message/i);
    expect(container.querySelector('.branch-details')).not.toBeNull();
    expect(button('Hide')!.getAttribute('aria-expanded')).toBe('true');

    act(() => button('Hide')!.click());
    expect(container.querySelector('.branch-details')).toBeNull();
    expect(text()).not.toMatch(/not the exact message/i);
  });

  it('is reachable and operable from the keyboard', () => {
    mount(<BranchBanner state={verbose()} onGoToTurn={() => {}} />);

    // Real buttons, so they are in the tab order and respond to Enter and
    // Space without any handler of our own.
    for (const label of ['Go to branch point', 'Details']) {
      const el = button(label)!;
      expect(el.tagName).toBe('BUTTON');
      expect(el.getAttribute('type')).toBe('button');
      expect(el.hasAttribute('disabled')).toBe(false);
    }
    expect(button('Details')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('clamps the excerpt it puts in the DOM, not only in CSS', () => {
    const s = state(chatgptBranched);
    const long = { ...s, turns: s.turns.map((t) =>
      t.sequence === 3 ? { ...t, workingText: 'x'.repeat(4000) } : t,
    ) };
    mount(<BranchBanner state={long} onGoToTurn={() => {}} />);

    const excerpt = container.querySelector('.branch-excerpt')!;
    // A short preview, not four thousand characters waiting to be clamped.
    expect(excerpt.textContent!.length).toBeLessThan(200);
    expect(excerpt.textContent).toContain('…');
  });

  it('stays compact with several branch points', () => {
    const s = state(chatgptBranched);
    const point = s.source.branches.points[0]!;
    const many: WorkingState = {
      ...s,
      source: {
        ...s.source,
        branches: {
          status: 'found',
          points: [0, 1, 2].map((i) => ({
            ...point,
            turnSequence: i,
            sourceConversationTitle: `Source conversation number ${i}`,
          })),
        },
      },
    };
    mount(<BranchBanner state={many} onGoToTurn={() => {}} />);

    expect(container.querySelectorAll('.branch-point')).toHaveLength(3);
    // One row each, and not one explanation among them.
    expect(container.querySelectorAll('.branch-details')).toHaveLength(0);
    expect([...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Details',
    )).toHaveLength(3);
  });

  it('opens one point\'s details without opening the others', () => {
    const s = state(chatgptBranched);
    const point = s.source.branches.points[0]!;
    const many: WorkingState = {
      ...s,
      source: {
        ...s.source,
        branches: {
          status: 'found',
          points: [0, 1].map((i) => ({ ...point, turnSequence: i })),
        },
      },
    };
    mount(<BranchBanner state={many} onGoToTurn={() => {}} />);

    const toggles = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Details',
    );
    act(() => (toggles[0] as HTMLButtonElement).click());

    expect(container.querySelectorAll('.branch-details')).toHaveLength(1);
  });
});

// ------------------------------------------------------------ at length ---

describe('a real-sized conversation', () => {
  it('renders 876 turns with the branch summary still one small block', () => {
    const s = state(chatgptLongBranched({ turns: 876, branchAt: 688 }));
    mount(
      <>
        <BranchBanner state={s} onGoToTurn={() => {}} />
        <div className="scroll">
          <CleanView state={s} onChange={() => {}} />
        </div>
      </>,
    );

    expect(container.querySelectorAll('.turn')).toHaveLength(876);
    // The observed case: "Branch point: Turn 689".
    expect(text()).toContain('Branch point: Turn 689');

    const banner = container.querySelector('.branch-banner')!;
    // Three lines and a button, not a paragraph per point.
    expect(banner.querySelectorAll('.branch-point')).toHaveLength(1);
    expect(banner.querySelectorAll('.branch-details')).toHaveLength(0);
    expect(banner.textContent!.length).toBeLessThan(300);
  });

  it('works the same in a narrow panel', () => {
    const s = state(chatgptLongBranched({ turns: 60, branchAt: 10 }));
    mount(<BranchBanner state={s} onGoToTurn={() => {}} />, 280);

    // Nothing is dropped or disabled at 280px; the CSS truncates instead.
    expect(button('Go to branch point')).toBeDefined();
    expect(button('Details')).toBeDefined();
    expect(text()).toContain('Branch point: Turn 11');
  });
});
