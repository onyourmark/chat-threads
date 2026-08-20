/**
 * The working conversation and every operation on it.
 *
 * All functions here are pure: they take a state and return a new one. The
 * `source` field is the frozen conversation as retrieved and is never written
 * to, which is what guarantees "reset" and "restore original" always work and
 * that nothing here could ever reach back to ChatGPT or Claude.
 */

import type {
  SourceConversation,
  Topic,
  TopicAssignment,
  Turn,
} from '../model/types';
import { SHARED, UNASSIGNED } from '../model/types';
import {
  defaultTopics,
  isPristineDefaultTopic,
} from '../model/default-topic';

export interface WorkingState {
  /** The retrieved conversation. Immutable. */
  readonly source: SourceConversation;
  /** Editable copies of every turn, in conversation order. */
  readonly turns: readonly Turn[];
  /** Topics the user created or accepted from a proposal. */
  readonly topics: readonly Topic[];
}

/**
 * Start a working session from a freshly retrieved conversation.
 *
 * Every conversation starts with the built-in topic already present. Because
 * `resetAll` goes through here, Reset Changes puts it back — it is part of the
 * starting state, not an edit.
 */
export function createWorkingState(source: SourceConversation): WorkingState {
  return {
    source,
    turns: source.turns.map((t) => ({
      ...t,
      attachments: [...t.attachments],
      references: [...t.references],
    })),
    topics: defaultTopics(),
  };
}

/** Throw away every edit and go back to the conversation as retrieved. */
export function resetAll(state: WorkingState): WorkingState {
  return createWorkingState(state.source);
}

function mapTurn(
  state: WorkingState,
  turnId: string,
  fn: (t: Turn) => Turn,
): WorkingState {
  let changed = false;
  const turns = state.turns.map((t) => {
    if (t.id !== turnId) return t;
    changed = true;
    return fn(t);
  });
  return changed ? { ...state, turns } : state;
}

/** Include or exclude a turn from every generated transcript. */
export function setIncluded(
  state: WorkingState,
  turnId: string,
  included: boolean,
): WorkingState {
  return mapTurn(state, turnId, (t) => ({ ...t, included }));
}

export function toggleIncluded(
  state: WorkingState,
  turnId: string,
): WorkingState {
  return mapTurn(state, turnId, (t) => ({ ...t, included: !t.included }));
}

/**
 * Include or exclude several turns at once.
 *
 * This is what Topic Review commits when the user presses "Remove selected
 * turns". It deliberately writes the same `included` flag the Clean view
 * toggles, so a turn removed through a topic is excluded in exactly the sense
 * the rest of the application already understands — there is no second,
 * topic-shaped notion of removal to keep in step.
 */
export function setIncludedMany(
  state: WorkingState,
  turnIds: readonly string[],
  included: boolean,
): WorkingState {
  const wanted = new Set(turnIds);
  if (wanted.size === 0) return state;

  let changed = false;
  const turns = state.turns.map((t) => {
    if (!wanted.has(t.id) || t.included === included) return t;
    changed = true;
    return { ...t, included };
  });
  return changed ? { ...state, turns } : state;
}

/**
 * The turns a topic owns.
 *
 * Turns marked Shared are deliberately not here. They belong to every topic,
 * so removing one while reviewing a single topic would quietly take it out of
 * all the others too — Topic Review only offers what the topic actually owns.
 */
export function turnsAssignedTo(
  state: WorkingState,
  topicId: string,
): Turn[] {
  return state.turns.filter((t) => t.assignment === topicId);
}

/** How many turns each topic owns, for the topic list. */
export function countAssignedTo(state: WorkingState, topicId: string): number {
  return turnsAssignedTo(state, topicId).length;
}

/**
 * Edit the working copy of a turn.
 *
 * `edited` tracks whether the text still matches the original, so setting the
 * text back by hand clears the flag exactly like using Restore.
 */
export function setWorkingText(
  state: WorkingState,
  turnId: string,
  text: string,
): WorkingState {
  return mapTurn(state, turnId, (t) => ({
    ...t,
    workingText: text,
    edited: text !== t.originalText,
  }));
}

/** Put a turn's original text back. */
export function restoreOriginalText(
  state: WorkingState,
  turnId: string,
): WorkingState {
  return mapTurn(state, turnId, (t) => ({
    ...t,
    workingText: t.originalText,
    edited: false,
  }));
}

export interface AssignOptions {
  /**
   * True when the change came from the user rather than from applying an AI
   * proposal. A user assignment clears the "uncertain" flag and marks the turn
   * as overridden, so the panel can show that the person had the last word.
   */
  byUser?: boolean;
}

export function setAssignment(
  state: WorkingState,
  turnId: string,
  assignment: TopicAssignment,
  options: AssignOptions = {},
): WorkingState {
  const byUser = options.byUser !== false;
  return mapTurn(state, turnId, (t) => ({
    ...t,
    assignment,
    uncertain: byUser ? false : t.uncertain,
    assignmentOverridden: byUser ? true : t.assignmentOverridden,
  }));
}

/** Assign several turns at once, used when applying an AI proposal. */
export function setAssignments(
  state: WorkingState,
  updates: ReadonlyArray<{
    turnId: string;
    assignment: TopicAssignment;
    uncertain?: boolean;
  }>,
  options: AssignOptions = {},
): WorkingState {
  const byUser = options.byUser === true;
  const byId = new Map(updates.map((u) => [u.turnId, u]));
  if (byId.size === 0) return state;
  return {
    ...state,
    turns: state.turns.map((t) => {
      const u = byId.get(t.id);
      if (!u) return t;
      return {
        ...t,
        assignment: u.assignment,
        uncertain: byUser ? false : (u.uncertain ?? false),
        assignmentOverridden: byUser ? true : false,
      };
    }),
  };
}

let topicCounter = 0;
/** Ids only need to be unique within a session, not stable across reloads. */
function nextTopicId(): string {
  topicCounter += 1;
  return `topic-${topicCounter}`;
}

/** Reset the id counter. Used by tests so ids are predictable. */
export function resetTopicIds(): void {
  topicCounter = 0;
}

export function addTopic(state: WorkingState, name?: string): WorkingState {
  const topic: Topic = {
    id: nextTopicId(),
    name: name?.trim() || `Topic ${state.topics.length + 1}`,
  };
  return { ...state, topics: [...state.topics, topic] };
}

export function renameTopic(
  state: WorkingState,
  topicId: string,
  name: string,
): WorkingState {
  return {
    ...state,
    topics: state.topics.map((t) => (t.id === topicId ? { ...t, name } : t)),
  };
}

/** Remove a topic; its turns fall back to Unassigned rather than vanishing. */
export function removeTopic(
  state: WorkingState,
  topicId: string,
): WorkingState {
  return {
    ...state,
    topics: state.topics.filter((t) => t.id !== topicId),
    turns: state.turns.map((t) =>
      t.assignment === topicId ? { ...t, assignment: UNASSIGNED } : t,
    ),
  };
}

/** Replace the topic list wholesale, used when accepting an AI proposal. */
export function setTopics(
  state: WorkingState,
  topics: readonly Topic[],
): WorkingState {
  const valid = new Set<string>(topics.map((t) => t.id));
  return {
    ...state,
    topics: [...topics],
    turns: state.turns.map((t) =>
      t.assignment === SHARED ||
      t.assignment === UNASSIGNED ||
      valid.has(t.assignment)
        ? t
        : { ...t, assignment: UNASSIGNED },
    ),
  };
}

/** Discard an applied proposal: clear topics and every assignment. */
export function clearTopics(state: WorkingState): WorkingState {
  return {
    ...state,
    topics: [],
    turns: state.turns.map((t) => ({
      ...t,
      assignment: UNASSIGNED,
      uncertain: false,
      assignmentOverridden: false,
    })),
  };
}

export function findTurn(
  state: WorkingState,
  turnId: string,
): Turn | undefined {
  return state.turns.find((t) => t.id === turnId);
}

export interface WorkingStats {
  total: number;
  included: number;
  excluded: number;
  edited: number;
  userTurns: number;
  assistantTurns: number;
  unassigned: number;
  shared: number;
  uncertain: number;
}

export function stats(state: WorkingState): WorkingStats {
  const s: WorkingStats = {
    total: state.turns.length,
    included: 0,
    excluded: 0,
    edited: 0,
    userTurns: 0,
    assistantTurns: 0,
    unassigned: 0,
    shared: 0,
    uncertain: 0,
  };
  for (const t of state.turns) {
    if (t.included) s.included += 1;
    else s.excluded += 1;
    if (t.edited) s.edited += 1;
    if (t.role === 'user') s.userTurns += 1;
    else s.assistantTurns += 1;
    if (t.assignment === UNASSIGNED) s.unassigned += 1;
    if (t.assignment === SHARED) s.shared += 1;
    if (t.uncertain) s.uncertain += 1;
  }
  return s;
}

/** True when anything has been changed from the retrieved conversation. */
export function hasChanges(state: WorkingState): boolean {
  // The built-in topic is part of the starting state, so its mere presence is
  // not a change; renaming it, removing it, or adding to it is.
  const topicsAreDefault =
    state.topics.length === 1 &&
    state.topics[0] !== undefined &&
    isPristineDefaultTopic(state.topics[0]);
  if (!topicsAreDefault) return true;

  return state.turns.some(
    (t) => !t.included || t.edited || t.assignment !== UNASSIGNED,
  );
}
