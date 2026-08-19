/**
 * Synthetic ChatGPT payloads containing inline file-reference markers.
 *
 * ChatGPT marks a reference to an attached file with Private Use Area
 * characters that its own interface replaces with a chip before the user sees
 * anything. The markers here are built from character codes so this file stays
 * plain ASCII and the delimiters survive copying, diffing and editing intact.
 *
 * Hand-written. No real conversation appears here, and none ever should.
 */

type Json = Record<string, unknown>;

const CITE_START = String.fromCharCode(0xe200);
const CITE_STOP = String.fromCharCode(0xe201);
const CITE_DELIM = String.fromCharCode(0xe202);

/** Build a marker: `<start>keyword<delim>id[<delim>id...]<stop>`. */
export function marker(keyword: string, ...ids: string[]): string {
  return CITE_START + keyword + CITE_DELIM + ids.join(CITE_DELIM) + CITE_STOP;
}

/** The older bracket form, which carries its source name inline. */
export function bracketCitation(index: string, name: string): string {
  return (
    String.fromCharCode(0x3010) +
    index +
    String.fromCharCode(0x2020) +
    name +
    String.fromCharCode(0x3011)
  );
}

/** True when a string still contains any of ChatGPT's private delimiters. */
export function hasMarkerCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xe200 && code <= 0xe20f) return true;
  }
  return false;
}

interface MessageSpec {
  id: string;
  parent: string | null;
  children?: string[];
  role: 'user' | 'assistant';
  text: string;
  attachments?: Json[];
  contentReferences?: Json[];
}

function node(spec: MessageSpec): Json {
  return {
    id: spec.id,
    parent: spec.parent,
    children: spec.children ?? [],
    message: {
      id: `msg-${spec.id}`,
      author: { role: spec.role, name: null, metadata: {} },
      create_time: 1_710_000_000,
      content: { content_type: 'text', parts: [spec.text] },
      status: 'finished_successfully',
      end_turn: true,
      weight: 1,
      metadata: {
        ...(spec.attachments ? { attachments: spec.attachments } : {}),
        ...(spec.contentReferences
          ? { content_references: spec.contentReferences }
          : {}),
      },
      recipient: 'all',
    },
  };
}

function root(childId: string): Json {
  return { id: 'root', parent: null, children: [childId], message: null };
}

function mapping(nodes: Json[]): Json {
  const out: Json = {};
  for (const n of nodes) out[n.id as string] = n;
  return out;
}

/** One file reference whose name ChatGPT supplies in content_references. */
export const fileReferenceKnownName: Json = {
  title: 'Reviewing a pasted file',
  conversation_id: 'conv-fileref',
  current_node: 'fr2',
  mapping: mapping([
    root('fr1'),
    node({
      id: 'fr1',
      parent: 'root',
      children: ['fr2'],
      role: 'user',
      text: 'What does the attached file say about scope?',
      attachments: [
        {
          id: 'file-a',
          name: 'Pasted markdown.md',
          size: 1024,
          mime_type: 'text/markdown',
        },
      ],
    }),
    node({
      id: 'fr2',
      parent: 'fr1',
      role: 'assistant',
      text:
        `The file sets out three goals${marker('filecite', 'turn0file0')}. ` +
        'It also lists what is out of scope.',
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn0file0'),
          type: 'file',
          name: 'Pasted markdown.md',
        },
      ],
    }),
  ]),
};

/** Several references in one reply, plus a grouped one and a line range. */
export const fileReferenceMany: Json = {
  title: 'Comparing two attachments',
  conversation_id: 'conv-manyrefs',
  current_node: 'mr2',
  mapping: mapping([
    root('mr1'),
    node({
      id: 'mr1',
      parent: 'root',
      children: ['mr2'],
      role: 'user',
      text: 'Compare the two files I attached.',
      attachments: [
        { id: 'file-a', name: 'spec.md', size: 900, mime_type: 'text/markdown' },
        { id: 'file-b', name: 'notes.txt', size: 400, mime_type: 'text/plain' },
      ],
    }),
    node({
      id: 'mr2',
      parent: 'mr1',
      role: 'assistant',
      text:
        `The spec defines the scope${marker('filecite', 'turn0file0')} ` +
        `while the notes record open questions${marker('filecite', 'turn0file1')}.\n\n` +
        `Both agree on the deadline${marker('cite', 'turn0file0', 'turn0file1')}.\n\n` +
        '## Detail\n\n' +
        '```ts\nconst x: number = 1;\n```\n\n' +
        '- first point\n- second point\n\n' +
        `A specific passage says so${marker('cite', 'turn0file0', 'L8-L13')}.`,
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn0file0'),
          type: 'file',
          name: 'spec.md',
        },
        {
          matched_text: marker('filecite', 'turn0file1'),
          type: 'file',
          name: 'notes.txt',
        },
      ],
    }),
  ]),
};

/** A reference with no metadata at all: the name cannot be recovered. */
export const fileReferenceUnmappable: Json = {
  title: 'Reference without metadata',
  conversation_id: 'conv-unmapped',
  current_node: 'ur2',
  mapping: mapping([
    root('ur1'),
    node({
      id: 'ur1',
      parent: 'root',
      children: ['ur2'],
      role: 'user',
      text: 'Summarize what I sent.',
    }),
    node({
      id: 'ur2',
      parent: 'ur1',
      role: 'assistant',
      text: `It covers the migration plan${marker('filecite', 'turn3file7')} in detail.`,
    }),
  ]),
};

/** A marker ChatGPT hides entirely, plus the older inline bracket form. */
export const fileReferenceHiddenAndBracket: Json = {
  title: 'Hidden and bracket references',
  conversation_id: 'conv-hidden-ref',
  current_node: 'hb2',
  mapping: mapping([
    root('hb1'),
    node({
      id: 'hb1',
      parent: 'root',
      children: ['hb2'],
      role: 'user',
      text: 'Check the report.',
    }),
    node({
      id: 'hb2',
      parent: 'hb1',
      role: 'assistant',
      text:
        `The report is consistent${marker('hidden', 'turn0file2')} throughout. ` +
        `The summary appears here${bracketCitation('4:0', 'Quarterly report.pdf')}.`,
      contentReferences: [
        { matched_text: marker('hidden', 'turn0file2'), type: 'hidden' },
      ],
    }),
  ]),
};

/** A non-file reference: a web citation rather than an attachment. */
export const nonFileReference: Json = {
  title: 'A web citation',
  conversation_id: 'conv-webref',
  current_node: 'wr2',
  mapping: mapping([
    root('wr1'),
    node({
      id: 'wr1',
      parent: 'root',
      children: ['wr2'],
      role: 'user',
      text: 'What is the current guidance?',
    }),
    node({
      id: 'wr2',
      parent: 'wr1',
      role: 'assistant',
      text: `The guidance changed last year${marker('cite', 'turn0search3')}.`,
      contentReferences: [
        {
          matched_text: marker('cite', 'turn0search3'),
          type: 'grouped_webpages',
          title: 'Official guidance page',
        },
      ],
    }),
  ]),
};

/** A user prompt that itself carries a reference, for the Prompts view. */
export const fileReferenceInPrompt: Json = {
  title: 'Reference inside a prompt',
  conversation_id: 'conv-promptref',
  current_node: 'pr2',
  mapping: mapping([
    root('pr1'),
    node({
      id: 'pr1',
      parent: 'root',
      children: ['pr2'],
      role: 'user',
      text: `Following up on my earlier file${marker('filecite', 'turn0file0')}, what next?`,
      attachments: [
        { id: 'file-p', name: 'plan.md', size: 200, mime_type: 'text/markdown' },
      ],
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn0file0'),
          type: 'file',
          name: 'plan.md',
        },
      ],
    }),
    node({
      id: 'pr2',
      parent: 'pr1',
      role: 'assistant',
      text: `The next step is the review${marker('filecite', 'turn0file0')}.`,
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn0file0'),
          type: 'file',
          name: 'plan.md',
        },
      ],
    }),
  ]),
};

/** Two subjects, both carrying attachments, for splitting. */
export const fileReferencesAcrossTopics: Json = {
  title: 'Two subjects, both with attachments',
  conversation_id: 'conv-reftopics',
  current_node: 'rt4',
  mapping: mapping([
    root('rt1'),
    node({
      id: 'rt1',
      parent: 'root',
      children: ['rt2'],
      role: 'user',
      text: 'What does the design doc say?',
      attachments: [
        { id: 'f1', name: 'design.md', size: 100, mime_type: 'text/markdown' },
      ],
    }),
    node({
      id: 'rt2',
      parent: 'rt1',
      children: ['rt3'],
      role: 'assistant',
      text: `It favours a side panel${marker('filecite', 'turn0file0')}.`,
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn0file0'),
          type: 'file',
          name: 'design.md',
        },
      ],
    }),
    node({
      id: 'rt3',
      parent: 'rt2',
      children: ['rt4'],
      role: 'user',
      text: 'Separately, what did the travel itinerary say?',
    }),
    node({
      id: 'rt4',
      parent: 'rt3',
      role: 'assistant',
      text: `It lands on the Tuesday${marker('filecite', 'turn1file0')}.`,
      contentReferences: [
        {
          matched_text: marker('filecite', 'turn1file0'),
          type: 'file',
          name: 'itinerary.pdf',
        },
      ],
    }),
  ]),
};
