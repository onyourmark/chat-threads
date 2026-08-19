import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import {
  createWorkingState,
  hasChanges,
  resetAll,
  resetTopicIds,
  restoreOriginalText,
  setIncluded,
  setWorkingText,
  stats,
  toggleIncluded,
  type WorkingState,
} from '../src/operations/working';
import { generateCleaned, renderMarkdown } from '../src/operations/transcript';
import { chatgptShort } from './fixtures/chatgpt';

function load(): WorkingState {
  const source = freezeConversation(
    normalizeChatGptConversation(chatgptShort, {
      url: 'https://chatgpt.com/c/conv-short',
      method: 'test',
    }),
  );
  return createWorkingState(source);
}

describe('excluding turns', () => {
  beforeEach(() => resetTopicIds());

  it('removes an excluded turn from the generated transcript', () => {
    const state = load();
    const target = state.turns[1];
    expect(target).toBeDefined();

    const before = renderMarkdown(generateCleaned(state));
    expect(before).toContain('Threadline');

    const after = setIncluded(state, target!.id, false);
    const text = renderMarkdown(generateCleaned(after));

    expect(text).not.toContain('Threadline');
    expect(generateCleaned(after).turns).toHaveLength(3);
  });

  it('restores an excluded turn', () => {
    const state = load();
    const id = state.turns[1]!.id;

    const excluded = setIncluded(state, id, false);
    const restored = setIncluded(excluded, id, true);

    expect(renderMarkdown(generateCleaned(restored))).toContain('Threadline');
    expect(generateCleaned(restored).turns).toHaveLength(4);
  });

  it('toggles', () => {
    const state = load();
    const id = state.turns[0]!.id;

    const once = toggleIncluded(state, id);
    expect(once.turns[0]?.included).toBe(false);
    expect(toggleIncluded(once, id).turns[0]?.included).toBe(true);
  });

  it('counts what is kept', () => {
    const state = setIncluded(load(), 'chatgpt-0', false);
    expect(stats(state)).toMatchObject({ total: 4, included: 3, excluded: 1 });
  });
});

describe('editing a turn', () => {
  it('changes only the working copy', () => {
    const state = load();
    const id = state.turns[0]!.id;
    const original = state.turns[0]!.originalText;

    const edited = setWorkingText(state, id, 'A shorter question.');

    expect(edited.turns[0]?.workingText).toBe('A shorter question.');
    expect(edited.turns[0]?.originalText).toBe(original);
    expect(edited.turns[0]?.edited).toBe(true);
  });

  it('puts the edited text in the transcript, not the original', () => {
    const state = setWorkingText(load(), 'chatgpt-0', 'Replaced text.');
    const text = renderMarkdown(generateCleaned(state));

    expect(text).toContain('Replaced text.');
    expect(text).not.toContain('tidies up chat logs');
  });

  it('restores the original text', () => {
    const state = load();
    const original = state.turns[0]!.originalText;

    const edited = setWorkingText(state, 'chatgpt-0', 'Replaced.');
    const restored = restoreOriginalText(edited, 'chatgpt-0');

    expect(restored.turns[0]?.workingText).toBe(original);
    expect(restored.turns[0]?.edited).toBe(false);
  });

  it('clears the edited flag when the text is typed back by hand', () => {
    const state = load();
    const original = state.turns[0]!.originalText;

    const edited = setWorkingText(state, 'chatgpt-0', 'Something else.');
    const same = setWorkingText(edited, 'chatgpt-0', original);

    expect(same.turns[0]?.edited).toBe(false);
  });
});

describe('the source conversation is never modified', () => {
  it('survives excluding, editing and resetting', () => {
    const state = load();
    const sourceText = state.source.turns[0]!.originalText;
    const sourceCount = state.source.turns.length;

    let next = setWorkingText(state, 'chatgpt-0', 'Rewritten.');
    next = setIncluded(next, 'chatgpt-1', false);
    next = setWorkingText(next, 'chatgpt-2', '');

    expect(next.source.turns[0]?.originalText).toBe(sourceText);
    expect(next.source.turns[0]?.workingText).toBe(sourceText);
    expect(next.source.turns[1]?.included).toBe(true);
    expect(next.source.turns).toHaveLength(sourceCount);
    // Same frozen object throughout.
    expect(next.source).toBe(state.source);
  });

  it('is frozen, so an accidental write cannot succeed', () => {
    const state = load();
    const turn = state.source.turns[0]!;

    expect(Object.isFrozen(state.source)).toBe(true);
    expect(Object.isFrozen(turn)).toBe(true);
    expect(() => {
      (turn as { workingText: string }).workingText = 'tampered';
    }).toThrow();
    expect(state.source.turns[0]?.workingText).toBe(turn.originalText);
  });

  it('resets everything back to the retrieved conversation', () => {
    const state = load();

    let next = setWorkingText(state, 'chatgpt-0', 'Rewritten.');
    next = setIncluded(next, 'chatgpt-1', false);
    expect(hasChanges(next)).toBe(true);

    const reset = resetAll(next);
    expect(hasChanges(reset)).toBe(false);
    expect(reset.turns.map((t) => t.workingText)).toEqual(
      state.source.turns.map((t) => t.originalText),
    );
    expect(reset.turns.every((t) => t.included)).toBe(true);
  });

  it('does not share turn objects with the source', () => {
    const state = load();
    expect(state.turns[0]).not.toBe(state.source.turns[0]);
    expect(state.turns[0]?.attachments).not.toBe(
      state.source.turns[0]?.attachments,
    );
  });
});
