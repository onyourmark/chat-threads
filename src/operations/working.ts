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
  return state.turns.filter((t) => belongsTo(t, topicId));
}

/**
 * Does this turn belong to this topic in its own right?
 *
 * Deliberately does not consider SHARED. A shared turn appears in every topic
 * transcript, but it is not *about* any of them, and counting it as though it
 * were is what let a topic with nothing of its own export most of the
 * conversation.
 */
export function belongsTo(turn: Turn, topicId: string): boolean {
  return turn.assignment === topicId || turn.alsoIn.includes(topicId);
}

/** How many turns each topic owns, for the topic list. */
export function countAssignedTo(state: WorkingState, topicId: string): number {
  return turnsAssignedTo(state, topicId).length;
}

/** Turns marked Shared, which reach every topic conversation. */
export function sharedTurns(state: WorkingState): Turn[] {
  return state.turns.filter((t) => t.included && t.assignment === SHARED);
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
    // Choosing one topic from the dropdown is a definitive statement about
    // where this turn goes, so it replaces every other membership rather than
    // quietly leaving the turn in topics the user can no longer see named.
    alsoIn: [],
    uncertain: byUser ? false : t.uncertain,
    assignmentOverridden: byUser ? true : t.assignmentOverridden,
  }));
}

/**
 * Put a turn in another topic as well, without moving it out of the one it is
 * already in.
 */
export function addTurnToTopic(
  state: WorkingState,
  turnId: string,
  topicId: string,
): WorkingState {
  return mapTurn(state, turnId, (t) => {
    if (t.assignment === topicId || t.alsoIn.includes(topicId)) return t;
    // A turn that was nowhere becomes a turn that is somewhere, rather than
    // gaining a second home it does not have a first one for.
    if (t.assignment === UNASSIGNED || t.assignment === SHARED) {
      return { ...t, assignment: topicId, alsoIn: [], assignmentOverridden: true, uncertain: false };
    }
    return {
      ...t,
      alsoIn: [...t.alsoIn, topicId],
      assignmentOverridden: true,
      uncertain: false,
    };
  });
}

/** Take a turn out of one topic, leaving any others it belongs to alone. */
export function removeTurnFromTopic(
  state: WorkingState,
  turnId: string,
  topicId: string,
): WorkingState {
  return mapTurn(state, turnId, (t) => {
    if (t.alsoIn.includes(topicId)) {
      return {
        ...t,
        alsoIn: t.alsoIn.filter((id) => id !== topicId),
        assignmentOverridden: true,
        uncertain: false,
      };
    }
    if (t.assignment !== topicId) return t;
    // Removing the primary promotes the next membership, so a turn in two
    // topics does not fall out of both at once.
    const [next, ...rest] = t.alsoIn;
    return {
      ...t,
      assignment: next ?? UNASSIGNED,
      alsoIn: rest,
      assignmentOverridden: true,
      uncertain: false,
    };
  });
}

/** Assign several turns at once, used when applying an AI proposal. */
export function setAssignments(
  state: WorkingState,
  updates: ReadonlyArray<{
    turnId: string;
    assignment: TopicAssignment;
    /** Further topics, for a turn that genuinely belongs to more than one. */
    alsoIn?: readonly string[];
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
        alsoIn: (u.alsoIn ?? []).filter((id) => id !== u.assignment),
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
    turns: state.turns.map((t) => {
      if (!belongsTo(t, topicId)) return t;
      const alsoIn = t.alsoIn.filter((id) => id !== topicId);
      if (t.assignment !== topicId) return { ...t, alsoIn };
      // Promote the next membership rather than dropping the turn entirely.
      const [next, ...rest] = alsoIn;
      return { ...t, assignment: next ?? UNASSIGNED, alsoIn: rest };
    }),
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
    turns: state.turns.map((t) => {
      const alsoIn = t.alsoIn.filter((id) => valid.has(id));
      const keepsPrimary =
        t.assignment === SHARED ||
        t.assignment === UNASSIGNED ||
        valid.has(t.assignment);
      if (keepsPrimary) {
        return alsoIn.length === t.alsoIn.length ? t : { ...t, alsoIn };
      }
      const [next, ...rest] = alsoIn;
      return { ...t, assignment: next ?? UNASSIGNED, alsoIn: rest };
    }),
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
      alsoIn: [],
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

/**
 * How the included turns are spread across topics — counts only.
 *
 * Deliberately carries no text of any kind: topic ids and numbers, nothing
 * else. It exists because "why is every topic file the size of the whole
 * conversation?" is a question about distribution, and answering it should
 * never involve printing somebody's conversation. Safe to show, safe to paste
 * into a bug report, and not sent anywhere.
 */
export interface AssignmentSummary {
  /** Included turns that belong to at least one topic. */
  placed: number;
  /** Included turns marked Shared, which reach every topic. */
  shared: number;
  /** Included turns in no topic at all. */
  unassigned: number;
  /** Turns belonging to more than one topic. */
  multiTopic: number;
  /** Topic id -> how many turns it owns. */
  perTopic: ReadonlyMap<string, number>;
  /** What the largest topic file would be, as a share of the cleaned one. */
  largestTopicShare: number;
}

export function assignmentSummary(state: WorkingState): AssignmentSummary {
  const perTopic = new Map<string, number>();
  for (const topic of state.topics) perTopic.set(topic.id, 0);

  let placed = 0;
  let shared = 0;
  let unassigned = 0;
  let multiTopic = 0;
  let included = 0;

  for (const turn of state.turns) {
    if (!turn.included) continue;
    included += 1;
    if (turn.assignment === SHARED) {
      shared += 1;
      continue;
    }
    if (turn.assignment === UNASSIGNED && turn.alsoIn.length === 0) {
      unassigned += 1;
      continue;
    }
    placed += 1;
    if (turn.alsoIn.length > 0) multiTopic += 1;
    for (const id of [turn.assignment, ...turn.alsoIn]) {
      if (id === UNASSIGNED) continue;
      perTopic.set(id, (perTopic.get(id) ?? 0) + 1);
    }
  }

  const largest = Math.max(0, ...perTopic.values());
  return {
    placed,
    shared,
    unassigned,
    multiTopic,
    perTopic,
    // The number that would have been near 1 during the live failure.
    largestTopicShare: included === 0 ? 0 : (largest + shared) / included,
  };
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
    (t) =>
      !t.included || t.edited || t.assignment !== UNASSIGNED || t.alsoIn.length > 0,
  );
}
