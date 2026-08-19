/**
 * Synthetic Claude conversation payloads.
 *
 * Written by hand to mirror the structure claude.ai returns for
 * `?tree=True&rendering_mode=messages`. No part of any real conversation
 * appears here, and none ever should — see CONTRIBUTING.md.
 */

type Json = Record<string, unknown>;

/** Claude marks the first message's parent with a sentinel uuid. */
export const ROOT_PARENT = '00000000-0000-4000-8000-000000000000';

let clock = Date.parse('2026-03-01T09:00:00.000Z');
function nextTime(): string {
  clock += 60_000;
  return new Date(clock).toISOString();
}

interface MessageSpec {
  uuid: string;
  parent: string;
  sender: 'human' | 'assistant';
  index: number;
  content?: unknown[];
  text?: string;
  attachments?: Json[];
  files?: Json[];
}

function message(spec: MessageSpec): Json {
  return {
    uuid: spec.uuid,
    parent_message_uuid: spec.parent,
    sender: spec.sender,
    index: spec.index,
    created_at: nextTime(),
    updated_at: nextTime(),
    text: spec.text ?? '',
    content: spec.content ?? [{ type: 'text', text: spec.text ?? '' }],
    attachments: spec.attachments ?? [],
    files: spec.files ?? [],
  };
}

export const claudeShort: Json = {
  uuid: 'claude-conv-short',
  name: 'Sorting out a reading list',
  created_at: '2026-03-01T09:00:00.000Z',
  current_leaf_message_uuid: 'c4',
  chat_messages: [
    message({
      uuid: 'c1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: 'Can you help me order a reading list by difficulty?',
    }),
    message({
      uuid: 'c2',
      parent: 'c1',
      sender: 'assistant',
      index: 1,
      text: 'Yes. Paste the list and I will sort it.',
    }),
    message({
      uuid: 'c3',
      parent: 'c2',
      sender: 'human',
      index: 2,
      text: 'Here it is: three books on typography.',
    }),
    message({
      uuid: 'c4',
      parent: 'c3',
      sender: 'assistant',
      index: 3,
      text: 'Start with the shortest and work upward.',
    }),
  ],
};

/**
 * An edited prompt creates a second branch. The leaf pointer selects the
 * second one, so the first must not appear.
 */
export const claudeBranched: Json = {
  uuid: 'claude-conv-branch',
  name: 'Edited prompt',
  current_leaf_message_uuid: 'd4',
  chat_messages: [
    message({
      uuid: 'd1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: 'Opening question.',
    }),
    message({
      uuid: 'd2',
      parent: 'd1',
      sender: 'assistant',
      index: 1,
      text: 'DISCARDED BRANCH: first answer.',
    }),
    message({
      uuid: 'd3',
      parent: 'd1',
      sender: 'assistant',
      index: 2,
      text: 'Second answer, the one on screen.',
    }),
    message({
      uuid: 'd4',
      parent: 'd3',
      sender: 'human',
      index: 3,
      text: 'Follow-up.',
    }),
  ],
};

const LONG_PROMPT = `I have a few unrelated things to ask about.\n\n${'This is a long block of pasted context. '.repeat(50)}\n\nTake them one at a time.`;

/** Markdown, code, thinking blocks, tool blocks and an attachment. */
export const claudeRich: Json = {
  uuid: 'claude-conv-rich',
  name: 'Extension work',
  created_at: '2026-03-01T09:00:00.000Z',
  current_leaf_message_uuid: 'e4',
  chat_messages: [
    message({
      uuid: 'e1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: LONG_PROMPT,
      attachments: [
        {
          file_name: 'notes.md',
          file_size: 2048,
          file_type: 'text/markdown',
          extracted_content: 'IGNORED',
        },
      ],
    }),
    {
      uuid: 'e2',
      parent_message_uuid: 'e1',
      sender: 'assistant',
      index: 1,
      created_at: '2026-03-01T09:02:00.000Z',
      text: '',
      content: [
        // Extended thinking: deliberately not collected.
        { type: 'thinking', thinking: 'INTERNAL REASONING THAT MUST NOT APPEAR' },
        {
          type: 'text',
          text: 'Here is the shape:\n\n```ts\ninterface Turn {\n  id: string;\n  included: boolean;\n}\n```\n\n- Keep the original\n- Edit a **copy**',
        },
        { type: 'tool_use', name: 'artifacts', input: { command: 'create' } },
      ],
      attachments: [],
      files: [],
    },
    message({
      uuid: 'e3',
      parent: 'e2',
      sender: 'human',
      index: 2,
      text: 'And here is a screenshot.',
      files: [{ file_name: 'screenshot.png' }],
    }),
    message({
      uuid: 'e4',
      parent: 'e3',
      sender: 'assistant',
      index: 3,
      text: 'The layout looks right.',
    }),
  ],
};

/** No leaf pointer: the adapter must fall back and say that it did. */
export const claudeNoLeaf: Json = {
  uuid: 'claude-conv-noleaf',
  name: 'Missing leaf pointer',
  chat_messages: [
    message({
      uuid: 'f1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: 'First.',
    }),
    message({
      uuid: 'f2',
      parent: 'f1',
      sender: 'assistant',
      index: 1,
      text: 'Second.',
    }),
  ],
};

/** An unrecognized content block alongside real text. */
export const claudeUnknownBlock: Json = {
  uuid: 'claude-conv-future',
  name: 'Future format',
  current_leaf_message_uuid: 'g2',
  chat_messages: [
    message({
      uuid: 'g1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: 'Question.',
    }),
    {
      uuid: 'g2',
      parent_message_uuid: 'g1',
      sender: 'assistant',
      index: 1,
      created_at: '2026-03-01T09:05:00.000Z',
      text: '',
      content: [
        { type: 'text', text: 'Visible answer.' },
        { type: 'holographic_projection', data: 'something new' },
      ],
      attachments: [],
      files: [],
    },
  ],
};

export const claudeUnsafeContent: Json = {
  uuid: 'claude-conv-unsafe',
  name: 'Unsafe content',
  current_leaf_message_uuid: 'h2',
  chat_messages: [
    message({
      uuid: 'h1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: '<script>alert("xss")</script><img src=x onerror=alert(1)>',
    }),
    message({
      uuid: 'h2',
      parent: 'h1',
      sender: 'assistant',
      index: 1,
      text: 'That is markup, not a command.',
    }),
  ],
};

export const claudeMalformed: Json = { uuid: 'claude-conv-bad' };
export const claudeEmpty: Json = {
  uuid: 'claude-conv-empty',
  chat_messages: [],
};

export const claudeMixedTopics: Json = {
  uuid: 'claude-conv-mixed',
  name: 'Two subjects',
  current_leaf_message_uuid: 'k6',
  chat_messages: [
    message({
      uuid: 'k1',
      parent: ROOT_PARENT,
      sender: 'human',
      index: 0,
      text: 'Please be concise throughout.',
    }),
    message({
      uuid: 'k2',
      parent: 'k1',
      sender: 'assistant',
      index: 1,
      text: 'Will do.',
    }),
    message({
      uuid: 'k3',
      parent: 'k2',
      sender: 'human',
      index: 2,
      text: 'First, how do I structure a Chrome side panel?',
    }),
    message({
      uuid: 'k4',
      parent: 'k3',
      sender: 'assistant',
      index: 3,
      text: 'Keep the panel a plain page and put logic in modules.',
    }),
    message({
      uuid: 'k5',
      parent: 'k4',
      sender: 'human',
      index: 4,
      text: 'Unrelated: what should I cook this evening?',
    }),
    message({
      uuid: 'k6',
      parent: 'k5',
      sender: 'assistant',
      index: 5,
      text: 'Something quick — pasta with garlic and chilli.',
    }),
  ],
};
