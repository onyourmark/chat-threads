/**
 * Chat Threads — common conversation representation.
 *
 * Everything above the provider adapters speaks only this vocabulary. No
 * ChatGPT- or Claude-specific field may appear in these types; provider quirks
 * stay behind the adapter's normalize step.
 */

/** Identifier of a supported provider. Adding a provider adds a member here. */
export type ProviderId = 'chatgpt' | 'claude';

/** Who spoke a turn. Only roles the user can actually see in the transcript. */
export type Role = 'user' | 'assistant';

/** How confident the adapter is that it retrieved the whole conversation. */
export type RetrievalCompleteness =
  /** Retrieved from provider-structured data covering the whole conversation. */
  | 'complete'
  /** Retrieved, but the adapter cannot prove nothing is missing. */
  | 'unverified'
  /** Known to be missing material (e.g. only what the page had rendered). */
  | 'partial';

/** A file or image the user attached to a turn, as far as it is visible. */
export interface Attachment {
  /** Visible file name, or a placeholder when the provider hides it. */
  name: string;
  /** Provider-reported MIME type, when available. */
  mimeType?: string;
  /** Provider-reported size in bytes, when available. */
  sizeBytes?: number;
}

/**
 * A place inside a turn's text where the provider pointed at something else —
 * usually a file the user attached.
 *
 * Providers mark these with private internal syntax that their own interface
 * renders and never shows the user. Adapters replace that syntax with readable
 * text and record what they found here, so the panel can show a tidy chip and
 * a reader can still tell that a reference existed.
 */
export interface TurnReference {
  /** What the reference points at, as far as the adapter could tell. */
  kind: 'file' | 'other';
  /**
   * The file or source name, when the provider supplied one. Absent means the
   * name could not be recovered — never guessed.
   */
  name?: string;
  /**
   * The provider's raw marker, kept for diagnostics when an adapter needs
   * repairing. Never rendered.
   */
  raw: string;
}

/**
 * Sentinel topic ids. Real topics use generated ids; these are states a turn
 * can be in that are not "belongs to topic X".
 */
export const UNASSIGNED = 'unassigned';
export const SHARED = 'shared';

/**
 * A turn's topic assignment.
 * - a topic id  -> appears only in that topic's transcript
 * - SHARED      -> appears in every topic transcript (documented in README)
 * - UNASSIGNED  -> appears in no topic transcript (but still in "Cleaned")
 *
 * Exclusion is deliberately not an assignment: it lives on `Turn.included`, so
 * a turn keeps its topic if the user re-includes it.
 */
export type TopicAssignment = string;

/** A named topic the user (or an accepted AI proposal) created. */
export interface Topic {
  id: string;
  name: string;
  /** Optional one-line description, usually from an AI proposal. */
  description?: string;
  /** True when this topic came from an AI proposal rather than the user. */
  fromProposal?: boolean;
}

/**
 * One conversation turn, in the form the whole application works with.
 *
 * `originalText` is written once at normalization and never mutated again; it
 * is the record of what the provider actually said. `workingText` is the copy
 * the user edits. Excluding, editing, and topic assignment all live here and
 * never travel back to the provider.
 */
export interface Turn {
  /** Chat Threads' own id. Stable for the lifetime of a loaded conversation. */
  id: string;
  provider: ProviderId;
  /** Provider's message id, when the provider exposes one. */
  providerMessageId?: string;
  /** Provider's conversation id, when available. */
  providerConversationId?: string;
  /** 0-based position along the active branch. */
  sequence: number;
  role: Role;
  /** Text exactly as retrieved. Never mutated after normalization. */
  originalText: string;
  /** The editable copy. Starts equal to `originalText`. */
  workingText: string;
  /** ISO-8601 timestamp, when the provider supplies one. */
  timestamp?: string;
  /** Provider id of the parent message, used for branch reconstruction. */
  parentMessageId?: string;
  attachments: Attachment[];
  /**
   * References found inside this turn's text. Informational: the text itself
   * already carries a readable replacement, so nothing downstream has to
   * consult this to produce a correct transcript.
   */
  references: TurnReference[];
  /** False means: leave this turn out of every generated transcript. */
  included: boolean;
  assignment: TopicAssignment;
  /** True once `workingText` differs from `originalText`. */
  edited: boolean;
  /** True when an AI proposal flagged this turn's assignment as uncertain. */
  uncertain: boolean;
  /** True when the user changed the assignment after an AI proposal. */
  assignmentOverridden: boolean;
}

/** Why retrieval ended up in the state it did — shown to the user verbatim. */
export interface RetrievalStatus {
  completeness: RetrievalCompleteness;
  /** How the turns were obtained, e.g. 'provider-api' or 'dom'. */
  method: string;
  /** Short, human-readable sentence. Safe to display. */
  detail: string;
  /** Non-fatal problems worth surfacing (skipped turns, missing metadata). */
  warnings: string[];
}

/** Which conversation we are looking at, before it has been loaded. */
export interface ConversationIdentity {
  provider: ProviderId;
  /** Provider's conversation id, when the URL or page exposes one. */
  conversationId?: string;
  title?: string;
  url: string;
}

/**
 * The immutable result of retrieval + normalization.
 *
 * Nothing in the application mutates a `SourceConversation`. The working state
 * holds its own turn array; this object stays as the reset point.
 */
export interface SourceConversation {
  provider: ProviderId;
  conversationId?: string;
  title?: string;
  url: string;
  /** ISO-8601 creation time, when available. */
  createdAt?: string;
  turns: readonly Turn[];
  retrieval: RetrievalStatus;
}

/** Machine-readable reason an adapter could not produce a conversation. */
export type AdapterFailureCode =
  | 'no-conversation'
  | 'not-authenticated'
  | 'provider-format-changed'
  | 'network'
  | 'unsupported-page'
  | 'unknown';

/** A retrieval that failed, described well enough to repair an adapter. */
export interface AdapterFailure {
  ok: false;
  /** Which adapter failed, so a report names the file to repair. */
  adapter: ProviderId;
  code: AdapterFailureCode;
  /** Sentence shown to the user. Must not contain tokens or conversation text. */
  message: string;
  /** Extra detail for a bug report. Must never contain credentials. */
  diagnostics?: Record<string, string | number | boolean>;
}

export interface AdapterSuccess {
  ok: true;
  conversation: SourceConversation;
}

export type AdapterResult = AdapterSuccess | AdapterFailure;
