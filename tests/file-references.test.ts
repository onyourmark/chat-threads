/**
 * Inline file references.
 *
 * Live testing against a real ChatGPT account surfaced raw marker syntax in
 * the panel and in exported transcripts. These tests pin down the fix at the
 * point it is applied — normalization — and then check every surface that
 * shows turn text, so a regression cannot reappear in only one view.
 */

import { describe, expect, it } from 'vitest';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import {
  normalizeChatGptReferences,
  UNNAMED_FILE_LABEL,
  UNNAMED_OTHER_LABEL,
} from '../src/adapters/chatgpt/references';
import { freezeConversation } from '../src/model/conversation';
import { SHARED } from '../src/model/types';
import {
  addTopic,
  createWorkingState,
  setAssignment,
  type WorkingState,
} from '../src/operations/working';
import {
  generateCleaned,
  generateSplit,
  renderJson,
  renderMarkdown,
  renderPlainText,
} from '../src/operations/transcript';
import {
  bracketCitation,
  fileReferenceHiddenAndBracket,
  fileReferenceInPrompt,
  fileReferenceKnownName,
  fileReferenceMany,
  fileReferencesAcrossTopics,
  fileReferenceUnmappable,
  hasMarkerCharacters,
  marker,
  nonFileReference,
} from './fixtures/chatgpt-references';

function load(fixture: unknown): WorkingState {
  return createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(fixture, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    ),
  );
}

/** Every string a user could ever see for a loaded conversation. */
function everyVisibleString(state: WorkingState): string[] {
  const out: string[] = [];
  for (const turn of state.turns) {
    out.push(turn.originalText, turn.workingText);
    for (const r of turn.references) if (r.name) out.push(r.name);
    for (const a of turn.attachments) out.push(a.name);
  }
  const cleaned = generateCleaned(state);
  out.push(
    renderMarkdown(cleaned),
    renderPlainText(cleaned),
    renderMarkdown(cleaned, { includeHeader: true }),
    renderJson(cleaned, state),
  );
  for (const conversation of generateSplit(state)) {
    out.push(renderMarkdown(conversation), renderPlainText(conversation));
  }
  return out;
}

describe('the marker normalizer', () => {
  it('replaces a named file reference with readable text', () => {
    const raw = `See the goals${marker('filecite', 'turn0file0')}.`;
    const { text, references } = normalizeChatGptReferences(raw, {
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn0file0'),
          type: 'file',
          name: 'Pasted markdown.md',
        },
      ],
    });

    expect(text).toBe(
      'See the goals [Reference to attached file: Pasted markdown.md].',
    );
    expect(references).toEqual([
      {
        kind: 'file',
        name: 'Pasted markdown.md',
        raw: marker('filecite', 'turn0file0'),
      },
    ]);
  });

  it('never invents a name when the provider did not give one', () => {
    const raw = `It covers the plan${marker('filecite', 'turn3file7')} in detail.`;
    const { text, references } = normalizeChatGptReferences(raw);

    expect(text).toBe(`It covers the plan ${UNNAMED_FILE_LABEL} in detail.`);
    expect(references[0]?.name).toBeUndefined();
    expect(references[0]?.kind).toBe('file');
    // The fact that a reference existed is not thrown away.
    expect(text).toContain('Reference to an attachment');
  });

  it('leaves the surrounding sentence untouched', () => {
    const raw = `Before${marker('filecite', 'turn0file0')} and after.`;
    const { text } = normalizeChatGptReferences(raw);

    expect(text.startsWith('Before ')).toBe(true);
    expect(text.endsWith(' and after.')).toBe(true);
  });

  it('handles several markers in one message', () => {
    const raw =
      `One${marker('filecite', 'turn0file0')} two${marker('filecite', 'turn0file1')} three.`;
    const { text, references } = normalizeChatGptReferences(raw, {
      contentReferences: [
        { matched_text: marker('filecite', 'turn0file0'), type: 'file', name: 'a.md' },
        { matched_text: marker('filecite', 'turn0file1'), type: 'file', name: 'b.md' },
      ],
    });

    expect(text).toContain('[Reference to attached file: a.md]');
    expect(text).toContain('[Reference to attached file: b.md]');
    expect(references).toHaveLength(2);
    expect(hasMarkerCharacters(text)).toBe(false);
  });

  it('handles a grouped marker naming several sources', () => {
    const raw = `Both agree${marker('cite', 'turn0file0', 'turn0file1')}.`;
    const { text, references } = normalizeChatGptReferences(raw, {
      contentReferences: [
        { matched_text: marker('filecite', 'turn0file0'), type: 'file', name: 'a.md' },
      ],
    });

    expect(hasMarkerCharacters(text)).toBe(false);
    expect(references[0]?.kind).toBe('file');
    // The id was known from another entry, so the name is recovered.
    expect(text).toContain('a.md');
  });

  it('ignores a line-range locator when deciding the kind', () => {
    const raw = `A passage${marker('cite', 'turn0file0', 'L8-L13')}.`;
    const { text, references } = normalizeChatGptReferences(raw);

    expect(references[0]?.kind).toBe('file');
    expect(text).toContain(UNNAMED_FILE_LABEL);
    expect(text).not.toContain('L8-L13');
  });

  it('removes a marker ChatGPT hides rather than labelling it', () => {
    const raw = `Consistent${marker('hidden', 'turn0file2')} throughout.`;
    const { text, references } = normalizeChatGptReferences(raw, {
      contentReferences: [
        { matched_text: marker('hidden', 'turn0file2'), type: 'hidden' },
      ],
    });

    expect(text).toBe('Consistent throughout.');
    expect(references).toHaveLength(0);
  });

  it('reads the name out of the older bracket form', () => {
    const raw = `The summary is here${bracketCitation('4:0', 'Quarterly report.pdf')}.`;
    const { text, references } = normalizeChatGptReferences(raw);

    expect(text).toBe(
      'The summary is here[Reference to attached file: Quarterly report.pdf].',
    );
    expect(references[0]?.name).toBe('Quarterly report.pdf');
  });

  it('labels a non-file reference without calling it an attachment', () => {
    const raw = `Guidance changed${marker('cite', 'turn0search3')}.`;
    const { text } = normalizeChatGptReferences(raw, {
      contentReferences: [
        {
          matched_text: marker('cite', 'turn0search3'),
          type: 'grouped_webpages',
          title: 'Official guidance page',
        },
      ],
    });

    expect(text).toContain('[Reference: Official guidance page]');
    expect(text).not.toContain('attached file');
  });

  it('labels an unnamed non-file reference without guessing', () => {
    const raw = `Guidance changed${marker('cite', 'turn0search3')}.`;
    const { text, references } = normalizeChatGptReferences(raw);

    expect(text).toBe(`Guidance changed ${UNNAMED_OTHER_LABEL}.`);
    expect(references[0]).toMatchObject({ kind: 'other', name: undefined });
    expect(text).not.toContain('attached file');
  });

  it('strips a truncated marker rather than leaving control characters', () => {
    const raw = `Cut off mid-marker${String.fromCharCode(0xe200)}cite`;
    const { text } = normalizeChatGptReferences(raw);

    expect(hasMarkerCharacters(text)).toBe(false);
    expect(text).toBe('Cut off mid-marker');
  });

  it('leaves ordinary text completely alone', () => {
    const raw =
      'Plain text with **markdown**, a `code span`, and ideographic brackets.';
    expect(normalizeChatGptReferences(raw).text).toBe(raw);
    expect(normalizeChatGptReferences('').text).toBe('');
  });

  it('does not mistake ordinary ideographic brackets for a citation', () => {
    const raw = `A quotation ${String.fromCharCode(0x3010)}note${String.fromCharCode(0x3011)} here.`;
    expect(normalizeChatGptReferences(raw).text).toBe(raw);
  });

  it('sanitizes a name that arrives with hostile characters', () => {
    const { text, references } = normalizeChatGptReferences(
      `X${marker('filecite', 'turn0file0')}`,
      {
        contentReferences: [
          {
            matched_text: marker('filecite', 'turn0file0'),
            type: 'file',
            name: `evil${String.fromCharCode(0)}name${String.fromCharCode(0xe200)}`,
          },
        ],
      },
    );

    expect(references[0]?.name).toBe('evil name');
    expect(hasMarkerCharacters(text)).toBe(false);
  });

  it('caps an absurdly long name', () => {
    const { references } = normalizeChatGptReferences(
      `X${marker('filecite', 'turn0file0')}`,
      {
        contentReferences: [
          {
            matched_text: marker('filecite', 'turn0file0'),
            type: 'file',
            name: 'a'.repeat(5000),
          },
        ],
      },
    );
    expect(references[0]?.name?.length).toBeLessThanOrEqual(120);
  });
});

describe('normalized turns carry no raw markers', () => {
  it('resolves a known file name end to end', () => {
    const state = load(fileReferenceKnownName);
    const assistant = state.turns[1];

    expect(assistant?.originalText).toContain(
      '[Reference to attached file: Pasted markdown.md]',
    );
    expect(hasMarkerCharacters(assistant?.originalText ?? '')).toBe(false);
    expect(assistant?.references[0]).toMatchObject({
      kind: 'file',
      name: 'Pasted markdown.md',
    });
  });

  it('keeps the working copy in step with the normalized original', () => {
    const state = load(fileReferenceKnownName);
    for (const turn of state.turns) {
      expect(turn.workingText).toBe(turn.originalText);
      expect(turn.edited).toBe(false);
    }
  });

  it('says a reference existed when the name cannot be recovered', () => {
    const state = load(fileReferenceUnmappable);
    const assistant = state.turns[1];

    expect(assistant?.originalText).toContain(UNNAMED_FILE_LABEL);
    expect(assistant?.originalText).toContain('It covers the migration plan');
    expect(assistant?.originalText).toContain('in detail.');
    expect(assistant?.references[0]?.name).toBeUndefined();
  });

  it('handles a reference inside a user prompt', () => {
    const state = load(fileReferenceInPrompt);
    const prompt = state.turns[0];

    expect(prompt?.role).toBe('user');
    expect(prompt?.originalText).toContain('[Reference to attached file: plan.md]');
    expect(hasMarkerCharacters(prompt?.originalText ?? '')).toBe(false);
  });

  it('leaves Markdown and code blocks exactly as they were', () => {
    const state = load(fileReferenceMany);
    const assistant = state.turns[1]?.originalText ?? '';

    expect(assistant).toContain('## Detail');
    expect(assistant).toContain('```ts\nconst x: number = 1;\n```');
    expect(assistant).toContain('- first point\n- second point');
    expect(assistant).toContain('[Reference to attached file: spec.md]');
    expect(assistant).toContain('[Reference to attached file: notes.txt]');
    expect(hasMarkerCharacters(assistant)).toBe(false);
  });

  it('drops a hidden marker and reads the bracket form', () => {
    const state = load(fileReferenceHiddenAndBracket);
    const assistant = state.turns[1]?.originalText ?? '';

    expect(assistant).toContain('The report is consistent throughout.');
    expect(assistant).toContain(
      '[Reference to attached file: Quarterly report.pdf]',
    );
    expect(hasMarkerCharacters(assistant)).toBe(false);
  });

  it('does not describe a web citation as an attachment', () => {
    const state = load(nonFileReference);
    const assistant = state.turns[1]?.originalText ?? '';

    expect(assistant).toContain('[Reference: Official guidance page]');
    expect(assistant).not.toContain('attached file');
  });
});

describe('no raw marker reaches any user-visible surface', () => {
  const fixtures: Array<[string, unknown]> = [
    ['known name', fileReferenceKnownName],
    ['many references', fileReferenceMany],
    ['unmappable', fileReferenceUnmappable],
    ['hidden and bracket', fileReferenceHiddenAndBracket],
    ['non-file', nonFileReference],
    ['in a prompt', fileReferenceInPrompt],
    ['across topics', fileReferencesAcrossTopics],
  ];

  for (const [name, fixture] of fixtures) {
    it(`is clean for the "${name}" conversation`, () => {
      const state = load(fixture);
      for (const value of everyVisibleString(state)) {
        expect(hasMarkerCharacters(value)).toBe(false);
      }
    });
  }
});

describe('references survive into generated transcripts', () => {
  it('appears in the cleaned transcript', () => {
    const state = load(fileReferenceKnownName);
    const text = renderMarkdown(generateCleaned(state));

    expect(text).toContain('[Reference to attached file: Pasted markdown.md]');
    expect(hasMarkerCharacters(text)).toBe(false);
  });

  it('appears in plain text and in JSON export', () => {
    const state = load(fileReferenceKnownName);
    const cleaned = generateCleaned(state);

    expect(renderPlainText(cleaned)).toContain(
      '[Reference to attached file: Pasted markdown.md]',
    );
    const parsed = JSON.parse(renderJson(cleaned, state));
    expect(JSON.stringify(parsed)).toContain('Pasted markdown.md');
    expect(hasMarkerCharacters(JSON.stringify(parsed))).toBe(false);
  });

  it('appears in the right topic-specific transcript', () => {
    let state = load(fileReferencesAcrossTopics);
    state = addTopic(state, 'Extension');
    state = addTopic(state, 'Travel');
    const [extension, travel] = state.topics;

    state = setAssignment(state, 'chatgpt-0', extension!.id);
    state = setAssignment(state, 'chatgpt-1', extension!.id);
    state = setAssignment(state, 'chatgpt-2', travel!.id);
    state = setAssignment(state, 'chatgpt-3', travel!.id);

    const [first, second] = generateSplit(state);
    const extensionText = renderMarkdown(first!);
    const travelText = renderMarkdown(second!);

    expect(extensionText).toContain('[Reference to attached file: design.md]');
    expect(extensionText).not.toContain('itinerary.pdf');
    expect(travelText).toContain('[Reference to attached file: itinerary.pdf]');
    expect(travelText).not.toContain('design.md');
    expect(hasMarkerCharacters(extensionText)).toBe(false);
    expect(hasMarkerCharacters(travelText)).toBe(false);
  });

  it('carries a shared turn with its reference into every topic', () => {
    let state = load(fileReferencesAcrossTopics);
    state = addTopic(state, 'A');
    state = addTopic(state, 'B');
    state = setAssignment(state, 'chatgpt-1', SHARED);

    for (const conversation of generateSplit(state)) {
      expect(renderMarkdown(conversation)).toContain(
        '[Reference to attached file: design.md]',
      );
    }
  });

  it('remains readable after the user edits around it', () => {
    const state = load(fileReferenceKnownName);
    const original = state.turns[1]?.originalText ?? '';

    // The replacement is ordinary text, so an edit cannot resurrect a marker.
    expect(original).not.toContain('filecite');
    expect(hasMarkerCharacters(original)).toBe(false);
  });
});
