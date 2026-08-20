/**
 * A synthetic conversation that mixes real work with the kind of turns the
 * built-in topic is for.
 *
 * It deliberately contains the two things that are easy to confuse with
 * venting and must not be swept into it:
 *
 *  - turn 2 is blunt technical criticism ("this is wrong, it still throws"),
 *    which is part of the work and belongs with the work;
 *  - turn 9 is ordinary substantive discussion *about* AI, which is just a
 *    normal topic.
 *
 * Hand-written. No real conversation appears here, and none ever should.
 */

type Json = Record<string, unknown>;

interface MessageSpec {
  id: string;
  parent: string | null;
  children?: string[];
  role: 'user' | 'assistant';
  text: string;
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
      metadata: {},
      recipient: 'all',
    },
  };
}

function mapping(nodes: Json[]): Json {
  const out: Json = {};
  for (const n of nodes) out[n.id as string] = n;
  return out;
}

/** Text of each turn, by sequence number, so tests can assert on it. */
export const VENTING_TURNS = [
  /* 0  work            */ 'Can you refactor this function so it handles an empty list?',
  /* 1  work            */ 'Here is a version that returns early when the list is empty.',
  /* 2  criticism       */
  'This is wrong. It still throws on an empty list, because line 3 reads items[0] before the guard.',
  /* 3  work            */
  'You are right. Here is a corrected version that checks the length first.',
  /* 4  cursing         */ 'Oh for f***’s sake. Why is this so hard for you?',
  /* 5  assistant reply */
  'I am sorry for the frustration. Let me look at it again more carefully.',
  /* 6  arguing         */
  'No, I am not accepting that. You keep saying you tested it and you clearly did not. Stop telling me you checked things you did not check.',
  /* 7  assistant reply */
  'You are right that I did not run the code, and I should not have implied that I had.',
  /* 8  venting         */
  'Honestly, this whole afternoon has been a waste of my time. I do not know why I bother with this thing.',
  /* 9  AI discussion   */
  'Separately, and out of genuine interest: how do modern models actually handle very long context windows?',
  /* 10 AI discussion   */
  'They attend over a longer window, and use techniques such as sparse attention and retrieval to keep the cost manageable.',
] as const;

const ROLES: Array<'user' | 'assistant'> = [
  'user',
  'assistant',
  'user',
  'assistant',
  'user',
  'assistant',
  'user',
  'assistant',
  'user',
  'user',
  'assistant',
];

export const chatgptVenting: Json = {
  title: 'A refactor that went badly',
  conversation_id: 'conv-venting',
  current_node: 'v10',
  mapping: mapping([
    { id: 'root', parent: null, children: ['v0'], message: null },
    ...VENTING_TURNS.map((text, i) =>
      node({
        id: `v${i}`,
        parent: i === 0 ? 'root' : `v${i - 1}`,
        children: i === VENTING_TURNS.length - 1 ? [] : [`v${i + 1}`],
        role: ROLES[i] as 'user' | 'assistant',
        text,
      }),
    ),
  ]),
};

/**
 * What a model that followed the rules would return for this conversation.
 *
 * Turns 4 to 8 are the argument; turns 2 and 9 are the traps. The reply names
 * the reserved id rather than proposing a topic of its own for the venting.
 */
export const VENTING_PROPOSAL = JSON.stringify({
  topics: [
    {
      id: 't1',
      name: 'Refactoring the function',
      description: 'Making the function handle an empty list.',
    },
    {
      id: 't2',
      name: 'How models handle long context',
      description: 'A general question about context windows.',
    },
  ],
  assignments: [
    { turn: 0, topic: 't1', uncertain: false },
    { turn: 1, topic: 't1', uncertain: false },
    { turn: 2, topic: 't1', uncertain: false },
    { turn: 3, topic: 't1', uncertain: false },
    { turn: 4, topic: 'venting', uncertain: false },
    { turn: 5, topic: 'venting', uncertain: false },
    { turn: 6, topic: 'venting', uncertain: false },
    { turn: 7, topic: 'venting', uncertain: false },
    { turn: 8, topic: 'venting', uncertain: false },
    { turn: 9, topic: 't2', uncertain: false },
    { turn: 10, topic: 't2', uncertain: false },
  ],
});

/** A reply that also echoes the built-in topic back in its topics list. */
export const VENTING_PROPOSAL_ECHOING_BUILT_IN = JSON.stringify({
  topics: [
    { id: 't1', name: 'Refactoring the function', description: 'The work.' },
    {
      id: 'venting',
      name: 'Frustration with the assistant',
      description: 'A duplicate of the topic that already exists.',
    },
  ],
  assignments: [
    { turn: 0, topic: 't1', uncertain: false },
    { turn: 4, topic: 'venting', uncertain: false },
    { turn: 8, topic: 'venting', uncertain: false },
  ],
});
