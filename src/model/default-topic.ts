/**
 * The one topic Chat Threads creates for you.
 *
 * Nearly every long conversation with an AI contains a few turns that are not
 * really part of the discussion: swearing at it, arguing with it about its own
 * behaviour, or venting when it gets something wrong. Those turns are usually
 * the first thing a person wants out of a transcript they are about to carry
 * forward, and they are tedious to pick out by hand.
 *
 * So the Split view starts with a topic for them already made. It is an
 * ordinary topic in every other respect — rename it, remove it, or ignore it.
 * Reset Changes brings it back, because it is part of the starting state
 * rather than something the user did.
 */

import type { Topic } from './types';

/** Stable id, so the topic survives a proposal being applied over it. */
export const BUILT_IN_TOPIC_ID = 'built-in-venting';

/**
 * The id the model is told to use for it.
 *
 * Deliberately different from the internal id: model output is untrusted, so
 * it names a reserved id that is translated on the way in rather than being
 * allowed to write an internal id directly.
 */
export const BUILT_IN_TOPIC_MODEL_ID = 'venting';

export const BUILT_IN_TOPIC_NAME = 'Why is AI so stupid?';

export const BUILT_IN_TOPIC_DESCRIPTION =
  'Cursing, arguing, or venting at the AI.';

/**
 * A fresh copy of the default topic.
 *
 * A factory rather than a shared constant: renaming a topic must not reach
 * back and change the default for every other conversation.
 */
export function createDefaultTopic(): Topic {
  return {
    id: BUILT_IN_TOPIC_ID,
    name: BUILT_IN_TOPIC_NAME,
    description: BUILT_IN_TOPIC_DESCRIPTION,
    builtIn: true,
  };
}

/** The topics a freshly loaded conversation starts with. */
export function defaultTopics(): Topic[] {
  return [createDefaultTopic()];
}

/**
 * True when this topic is the built-in one exactly as Chat Threads made it.
 *
 * Used to tell "the user has not touched this" from "the user renamed it and
 * means to use it", which is the difference between quietly leaving it out of
 * the Output list and showing it.
 */
export function isPristineDefaultTopic(topic: Topic): boolean {
  return (
    topic.builtIn === true &&
    topic.id === BUILT_IN_TOPIC_ID &&
    topic.name === BUILT_IN_TOPIC_NAME
  );
}

/**
 * How the built-in topic is explained to a model, and what belongs in it.
 *
 * The negative rules matter more than the positive one. Telling a model to
 * find "frustration" without them produces a topic that swallows every
 * bug report and every correction, which would quietly delete the most useful
 * part of a technical conversation.
 */
export const BUILT_IN_TOPIC_RULES = [
  `A topic with the id "${BUILT_IN_TOPIC_MODEL_ID}" already exists. It is called "${BUILT_IN_TOPIC_NAME}" and it collects turns that are cursing, arguing, or venting at the assistant.`,
  `- Do not create your own topic for this. Do not include "${BUILT_IN_TOPIC_MODEL_ID}" in the "topics" list. Just use that id in "assignments".`,
  `- Assign a user turn to "${BUILT_IN_TOPIC_MODEL_ID}" when the main purpose of the turn is swearing at the assistant, arguing with it about its own behaviour, or venting frustration at it.`,
  `- When an assistant turn is clearly part of that same exchange — apologising for it, defending itself, or responding to the complaint rather than to the subject — assign that turn to "${BUILT_IN_TOPIC_MODEL_ID}" as well, so the whole exchange can be removed together.`,
  `- Do not use it for ordinary discussion about AI, its abilities, or its limitations. That is a normal topic.`,
  `- Do not use it for normal technical criticism, for pointing out a mistake, for correcting an answer, or for disagreeing — even when the person says the assistant is wrong, and even when they sound annoyed. If the turn is trying to move the work forward, it belongs with the work.`,
  `- The test is whether the turn is mainly a personal argument with the assistant, or mainly part of the actual discussion. When it is both, prefer the actual discussion.`,
  `- If nothing in the conversation fits, assign nothing to it. An empty "${BUILT_IN_TOPIC_MODEL_ID}" is a perfectly good answer.`,
].join('\n');
