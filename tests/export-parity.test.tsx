/**
 * @vitest-environment jsdom
 *
 * Preview, the single Download button and the bulk export must agree.
 *
 * When every exported topic file came back at 2.8–3.5 MB, "the bulk export is
 * selecting turns differently" was one of the candidate explanations. It was
 * not — but nothing proved it, and a second selection rule hiding behind an
 * export button is exactly the sort of thing that would be found by a user
 * rather than by the suite.
 *
 * So this drives the real Output view and compares the bytes the three routes
 * produce for the same conversation, character for character.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutputView } from '../src/sidepanel/components/OutputView';
import { normalizeChatGptConversation } from '../src/adapters/chatgpt/normalize';
import { freezeConversation } from '../src/model/conversation';
import { SHARED } from '../src/model/types';
import {
  addTopic,
  addTurnToTopic,
  createWorkingState,
  resetTopicIds,
  setAssignment,
  type WorkingState,
} from '../src/operations/working';
import { generateSplit, renderMarkdown } from '../src/operations/transcript';
import { chatgptMixedTopics } from './fixtures/chatgpt';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).
  IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;

/** Two topics, one turn in both, one turn Shared by hand. */
function state(): WorkingState {
  resetTopicIds();
  let s = createWorkingState(
    freezeConversation(
      normalizeChatGptConversation(chatgptMixedTopics, {
        url: 'https://chatgpt.com/c/x',
        method: 'test',
      }),
    ),
  );
  s = addTopic(s, 'Extension work');
  s = addTopic(s, 'Travel');
  const [a, b] = s.topics.filter((t) => !t.builtIn).map((t) => t.id);

  s = setAssignment(s, 'chatgpt-2', a!);
  s = setAssignment(s, 'chatgpt-3', a!);
  s = setAssignment(s, 'chatgpt-6', b!);
  // Belongs to both, which must appear once in each and nowhere else.
  s = setAssignment(s, 'chatgpt-4', a!);
  s = addTurnToTopic(s, 'chatgpt-4', b!);
  // A deliberate Shared turn, which reaches every topic.
  s = setAssignment(s, 'chatgpt-0', SHARED);
  return s;
}

function mount(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

/** Every file the page tried to save, with its bytes. */
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
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function mocked(this: HTMLAnchorElement) {
      saved.push({ name: this.download, blob: urls.get(this.href)! });
    },
  );
  return saved;
}

/**
 * Read a Blob's bytes.
 *
 * jsdom's Blob has no `arrayBuffer()`, so this goes the long way round with
 * FileReader — which is also how a browser of the era this has to run on would
 * have done it.
 */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function blobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blobBytes(blob));
}

/** Pull the stored entries back out of a zip. */
async function readZip(blob: Blob): Promise<Map<string, string>> {
  const bytes = await blobBytes(blob);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = new Map<string, string>();

  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i += 1) {
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localName + localExtra;
    out.set(name, decoder.decode(bytes.subarray(start, start + size)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return out;
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

describe('the three ways out of Output agree', () => {
  it('the zip holds exactly what Preview shows', async () => {
    const s = state();
    const saved = captureDownloads();
    mount(<OutputView state={s} />);

    await act(async () => button('Download .zip')!.click());
    const entries = await readZip(saved[0]!.blob);

    // The same selection the panel renders, from the one function that
    // decides it. An untouched built-in topic is not exported even though it
    // picks up the Shared turn — see the last test in this file.
    for (const conversation of generateSplit(s)) {
      if ((conversation.ownTurnCount ?? 0) === 0) continue;
      const topic = s.topics.find((t) => t.id === conversation.topicId)!;
      const expected = renderMarkdown(conversation, {
        includeHeader: true,
        includeAttachments: true,
      });
      expect(entries.get(`${topic.name}.md`), topic.name).toBe(expected);
    }
  });

  it('a single Download and the zip produce identical bytes', async () => {
    const s = state();
    const saved = captureDownloads();
    mount(<OutputView state={s} />);

    // Every individual "Download .md" button, then the archive.
    const singles = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent?.trim() === 'Download .md',
    ) as HTMLButtonElement[];
    for (const single of singles) {
      await act(async () => single.click());
    }
    const individual = new Map(
      await Promise.all(
        saved.map(async (f) => [f.name, await blobText(f.blob)] as const),
      ),
    );

    saved.length = 0;
    await act(async () => button('Download .zip')!.click());
    const entries = await readZip(saved[0]!.blob);

    // Same number of files, same names, same bytes.
    expect([...entries.keys()].sort()).toEqual([...individual.keys()].sort());
    for (const [name, text] of entries) {
      expect(text, name).toBe(individual.get(name));
    }
  });

  it('a turn in two topics is in both files and no others', async () => {
    const s = state();
    const saved = captureDownloads();
    mount(<OutputView state={s} />);

    await act(async () => button('Download .zip')!.click());
    const entries = await readZip(saved[0]!.blob);

    const shibboleth = s.turns.find((t) => t.id === 'chatgpt-4')!.workingText;
    const holders = [...entries.entries()].filter(
      ([name, text]) => name !== 'Cleaned Conversation.md' && text.includes(shibboleth),
    );

    expect(holders.map(([name]) => name).sort()).toEqual([
      'Extension work.md',
      'Travel.md',
    ]);
    // Once in each, not twice in either.
    for (const [name, text] of holders) {
      expect(text.split(shibboleth).length - 1, name).toBe(1);
    }
  });

  it('the shared turn is in every topic file, and is announced', async () => {
    const s = state();
    const saved = captureDownloads();
    mount(<OutputView state={s} />);

    expect(container.textContent).toMatch(
      /1 Shared turn will appear in every topic conversation/i,
    );

    await act(async () => button('Download .zip')!.click());
    const entries = await readZip(saved[0]!.blob);
    const shared = s.turns.find((t) => t.id === 'chatgpt-0')!.workingText;

    for (const [name, text] of entries) {
      if (name === 'Cleaned Conversation.md') continue;
      expect(text.includes(shared), name).toBe(true);
    }
  });

  it('puts in each topic file exactly the turns that topic holds', async () => {
    // The size ratio that exposed the live failure is asserted at 876 turns
    // in tests/topic-membership.test.ts; on an eight-turn fixture a topic
    // holding half the conversation is simply the truth. What matters here is
    // that the bytes match the membership, turn for turn.
    const s = state();
    const saved = captureDownloads();
    mount(<OutputView state={s} />);

    await act(async () => button('Download .zip')!.click());
    const entries = await readZip(saved[0]!.blob);

    for (const conversation of generateSplit(s)) {
      const topic = s.topics.find((t) => t.id === conversation.topicId)!;
      const text = entries.get(`${topic.name}.md`);
      if (!text) continue;

      for (const turn of s.turns) {
        const inFile = text.includes(turn.workingText);
        const shouldBe = conversation.turns.some((t) => t.id === turn.id);
        expect(inFile, `${topic.name} / ${turn.id}`).toBe(shouldBe);
      }
    }
  });

  it('an untouched built-in topic is not exported at all', async () => {
    const s = state();
    const saved = captureDownloads();
    mount(<OutputView state={s} />);

    await act(async () => button('Download .zip')!.click());
    const entries = await readZip(saved[0]!.blob);

    // It has a Shared turn in it, and nothing of its own.
    expect([...entries.keys()]).not.toContain('Why is AI so stupid.md');
  });
});
