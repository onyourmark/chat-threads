/**
 * Synthetic ChatGPT conversation payloads.
 *
 * Written by hand to mirror the structure the ChatGPT web app returns. No part
 * of any real conversation appears here, and none ever should — see
 * CONTRIBUTING.md.
 */

/** Loose type so a fixture can deliberately be malformed. */
type Json = Record<string, unknown>;

let clock = 1_710_000_000;
function nextTime(): number {
  clock += 60;
  return clock;
}

interface NodeSpec {
  id: string;
  parent: string | null;
  children?: string[];
  role?: string;
  parts?: unknown[];
  contentType?: string;
  recipient?: string;
  hidden?: boolean;
  attachments?: Json[];
  time?: number;
}

function node(spec: NodeSpec): Json {
  const message =
    spec.role === undefined
      ? null
      : {
          id: `msg-${spec.id}`,
          author: { role: spec.role, name: null, metadata: {} },
          create_time: spec.time ?? nextTime(),
          content: {
            content_type: spec.contentType ?? 'text',
            parts: spec.parts ?? [''],
          },
          status: 'finished_successfully',
          end_turn: true,
          weight: 1,
          metadata: {
            ...(spec.hidden
              ? { is_visually_hidden_from_conversation: true }
              : {}),
            ...(spec.attachments ? { attachments: spec.attachments } : {}),
          },
          recipient: spec.recipient ?? 'all',
        };

  return {
    id: spec.id,
    message,
    parent: spec.parent,
    children: spec.children ?? [],
  };
}

function mapping(nodes: Json[]): Json {
  const out: Json = {};
  for (const n of nodes) out[n.id as string] = n;
  return out;
}

/** A four-turn conversation with nothing unusual in it. */
export const chatgptShort: Json = {
  title: 'Naming a side project',
  create_time: 1_710_000_000,
  conversation_id: 'conv-short',
  current_node: 'n4',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['n0'] }),
    node({
      id: 'n0',
      parent: 'root',
      children: ['n1'],
      role: 'system',
      parts: ['You are a helpful assistant.'],
    }),
    node({
      id: 'n1',
      parent: 'n0',
      children: ['n2'],
      role: 'user',
      parts: ['What should I call a tool that tidies up chat logs?'],
    }),
    node({
      id: 'n2',
      parent: 'n1',
      children: ['n3'],
      role: 'assistant',
      parts: ['A few options: Threadline, Tidychat, or Chat Threads.'],
    }),
    node({
      id: 'n3',
      parent: 'n2',
      children: ['n4'],
      role: 'user',
      parts: ['Chat Threads is good. Is the name taken?'],
    }),
    node({
      id: 'n4',
      parent: 'n3',
      role: 'assistant',
      parts: ['I cannot check trademarks, but the phrase is fairly generic.'],
    }),
  ]),
};

/**
 * Two alternate assistant replies to the same prompt. `current_node` selects
 * the second one, so only that branch may appear in the transcript.
 */
export const chatgptBranched: Json = {
  title: 'Branching example',
  conversation_id: 'conv-branch',
  create_time: 1_710_000_000,
  current_node: 'b4',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['b1'] }),
    node({
      id: 'b1',
      parent: 'root',
      children: ['b2', 'b3'],
      role: 'user',
      parts: ['Give me one word for "tidy".'],
    }),
    node({
      id: 'b2',
      parent: 'b1',
      role: 'assistant',
      parts: ['DISCARDED BRANCH: neat.'],
    }),
    node({
      id: 'b3',
      parent: 'b1',
      children: ['b4'],
      role: 'assistant',
      parts: ['Orderly.'],
    }),
    node({
      id: 'b4',
      parent: 'b3',
      role: 'user',
      parts: ['Thanks.'],
    }),
  ]),
};

const LONG_PROMPT = `I need help planning three things at once.\n\n${'Here is a long paragraph of context that the user pasted in. '.repeat(40)}\n\nPlease keep them separate.`;

/** Markdown, a fenced code block, an attachment and a very long prompt. */
export const chatgptRich: Json = {
  title: 'Extension design and other things',
  conversation_id: 'conv-rich',
  create_time: 1_710_000_000,
  current_node: 'r6',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['r1'] }),
    node({
      id: 'r1',
      parent: 'root',
      children: ['r2'],
      role: 'user',
      parts: [LONG_PROMPT],
    }),
    node({
      id: 'r2',
      parent: 'r1',
      children: ['r3'],
      role: 'assistant',
      parts: [
        'Here is a plan.\n\n## Steps\n\n1. **Read** the conversation\n2. *Clean* it\n3. Split it\n\n```ts\nexport function clean(turns: Turn[]) {\n  return turns.filter((t) => t.included);\n}\n```\n\nA table:\n\n| Step | Owner |\n| --- | --- |\n| Read | adapter |',
      ],
    }),
    node({
      id: 'r3',
      parent: 'r2',
      children: ['r4'],
      role: 'user',
      parts: ['Here is the spec I mentioned.'],
      attachments: [
        {
          id: 'file-1',
          name: 'spec.pdf',
          size: 51_200,
          mime_type: 'application/pdf',
        },
      ],
    }),
    // Model reasoning: deliberately not collected.
    node({
      id: 'r4',
      parent: 'r3',
      children: ['r5'],
      role: 'assistant',
      contentType: 'thoughts',
      parts: ['INTERNAL REASONING THAT MUST NOT APPEAR'],
    }),
    // A function call rather than a reply to the user.
    node({
      id: 'r5',
      parent: 'r4',
      children: ['r6'],
      role: 'assistant',
      recipient: 'python',
      parts: ['print("tool call")'],
    }),
    node({
      id: 'r6',
      parent: 'r5',
      role: 'assistant',
      parts: ['I read the spec. It covers the extension and the travel plans.'],
    }),
  ]),
};

/** A multimodal user turn plus a message ChatGPT hides from the transcript. */
export const chatgptMultimodal: Json = {
  title: 'Photo question',
  conversation_id: 'conv-mm',
  current_node: 'm3',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['m1'] }),
    node({
      id: 'm1',
      parent: 'root',
      children: ['m2'],
      role: 'user',
      contentType: 'multimodal_text',
      parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'file-service://x' },
        'What plant is this?',
      ],
    }),
    node({
      id: 'm2',
      parent: 'm1',
      children: ['m3'],
      role: 'user',
      hidden: true,
      parts: ['HIDDEN CONTEXT THAT MUST NOT APPEAR'],
    }),
    node({
      id: 'm3',
      parent: 'm2',
      role: 'assistant',
      parts: ['It looks like a monstera.'],
    }),
  ]),
};

/** No `current_node`: the adapter must warn rather than guess silently. */
export const chatgptNoCurrentNode: Json = {
  title: 'Missing metadata',
  conversation_id: 'conv-nometa',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['x1'] }),
    node({
      id: 'x1',
      parent: 'root',
      children: ['x2'],
      role: 'user',
      parts: ['First question.'],
    }),
    node({ id: 'x2', parent: 'x1', role: 'assistant', parts: ['First answer.'] }),
  ]),
};

/** A content type the adapter has never seen. Must warn, not crash. */
export const chatgptUnknownContentType: Json = {
  title: 'Future format',
  conversation_id: 'conv-future',
  current_node: 'u2',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['u1'] }),
    node({
      id: 'u1',
      parent: 'root',
      children: ['u2'],
      role: 'user',
      parts: ['Question.'],
    }),
    node({
      id: 'u2',
      parent: 'u1',
      role: 'assistant',
      contentType: 'holographic_projection',
      parts: [{ some: 'new shape' }],
    }),
  ]),
};

/** Text that would be dangerous if it were ever treated as markup. */
export const chatgptUnsafeContent: Json = {
  title: 'Unsafe content',
  conversation_id: 'conv-unsafe',
  current_node: 's2',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['s1'] }),
    node({
      id: 's1',
      parent: 'root',
      children: ['s2'],
      role: 'user',
      parts: [
        '<img src=x onerror="alert(1)"> and <script>alert("xss")</script>',
      ],
    }),
    node({
      id: 's2',
      parent: 's1',
      role: 'assistant',
      parts: [
        'Here is that markup in a code block:\n\n```html\n<script>alert("xss")</script>\n```',
      ],
    }),
  ]),
};

export const chatgptMalformed: Json = { conversation_id: 'conv-bad' };
export const chatgptEmptyMapping: Json = {
  conversation_id: 'conv-empty',
  mapping: {},
};

/**
 * A conversation that genuinely mixes three subjects, used to exercise
 * splitting end to end.
 */
export const chatgptMixedTopics: Json = {
  title: 'Extension, promotion and a holiday',
  conversation_id: 'conv-mixed',
  current_node: 't8',
  mapping: mapping([
    node({ id: 'root', parent: null, children: ['t1'] }),
    node({
      id: 't1',
      parent: 'root',
      children: ['t2'],
      role: 'user',
      parts: ['Answer carefully and keep replies short.'],
    }),
    node({
      id: 't2',
      parent: 't1',
      children: ['t3'],
      role: 'assistant',
      parts: ['Understood.'],
    }),
    node({
      id: 't3',
      parent: 't2',
      children: ['t4'],
      role: 'user',
      parts: ['How should the browser extension store its working copy?'],
    }),
    node({
      id: 't4',
      parent: 't3',
      children: ['t5'],
      role: 'assistant',
      parts: ['Keep the retrieved conversation immutable and edit a copy.'],
    }),
    node({
      id: 't5',
      parent: 't4',
      children: ['t6'],
      role: 'user',
      parts: ['Different subject: how do I get a GitHub project noticed?'],
    }),
    node({
      id: 't6',
      parent: 't5',
      children: ['t7'],
      role: 'assistant',
      parts: ['Write a README that explains the problem before the features.'],
    }),
    node({
      id: 't7',
      parent: 't6',
      children: ['t8'],
      role: 'user',
      parts: ['Also, is Lisbon warm in March?'],
    }),
    node({
      id: 't8',
      parent: 't7',
      role: 'assistant',
      parts: ['Mild — around 18°C in the afternoon.'],
    }),
  ]),
};
