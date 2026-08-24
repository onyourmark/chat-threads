/**
 * ChatGPT normalization: provider tree -> common representation.
 *
 * This module is pure so it can be tested against fixtures with no network and
 * no browser. Everything ChatGPT-shaped stops here.
 *
 * The shape below is ChatGPT's *undocumented* internal conversation format. It
 * can change without notice; when it does, this file is the one to repair.
 * See docs/LIMITATIONS.md.
 */

import { activeBranch, type BranchNode } from '../branch';
import { buildTurns, type RawTurnInput } from '../../model/conversation';
import type {
  Attachment,
  Role,
  SourceConversation,
  RetrievalStatus,
  TurnReference,
} from '../../model/types';
import { normalizeChatGptReferences } from './references';
import { detectChatGptBranches } from './branch-metadata';

/**
 * Content types that are part of the conversation the user can see.
 * Anything else is either provider scaffolding or model-internal material,
 * which Chat Threads deliberately does not collect.
 */
const VISIBLE_CONTENT_TYPES = new Set(['text', 'multimodal_text']);

/**
 * Content types we know about and intentionally skip. Listing them keeps them
 * out of the "unknown format" warning, so a real format change stays visible.
 *
 * `thoughts` and `reasoning_recap` carry model reasoning, which is out of
 * scope by design — Chat Threads works on the visible conversation only.
 */
const KNOWN_SKIPPED_CONTENT_TYPES = new Set([
  'thoughts',
  'reasoning_recap',
  'code',
  'execution_output',
  'tether_browsing_display',
  'tether_quote',
  'system_error',
  'user_editable_context',
  'model_editable_context',
  'sonic_webpage',
]);

/** Roles whose messages are never part of the visible transcript. */
const HIDDEN_ROLES = new Set(['system', 'tool']);

interface ChatGptNode extends BranchNode {
  raw: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function epochToIso(v: unknown): string | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const d = new Date(v * 1000);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Thrown when the payload is not recognizably a ChatGPT conversation. */
export class ChatGptFormatError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'ChatGptFormatError';
  }
}

interface ExtractedMessage {
  text: string;
  attachments: Attachment[];
  references: TurnReference[];
  role: Role;
  messageId?: string;
  timestamp?: string;
  /** Set when the node exists but holds nothing the user can see. */
  skipped?: 'hidden' | 'known' | 'unknown';
  /** The unrecognized content_type, when `skipped === 'unknown'`. */
  unknownType?: string;
}

/** Pull the visible text and attachments out of one ChatGPT message node. */
function extractMessage(message: unknown): ExtractedMessage | null {
  if (!isRecord(message)) return null;

  const author = isRecord(message.author) ? message.author : {};
  const roleRaw = typeof author.role === 'string' ? author.role : '';
  if (HIDDEN_ROLES.has(roleRaw)) return null;
  if (roleRaw !== 'user' && roleRaw !== 'assistant') return null;
  const role: Role = roleRaw;

  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const base: ExtractedMessage = {
    text: '',
    attachments: [],
    references: [],
    role,
    messageId: typeof message.id === 'string' ? message.id : undefined,
    timestamp: epochToIso(message.create_time),
  };

  // Messages ChatGPT itself hides from the transcript (context injections,
  // system nudges) are not part of what the user saw.
  if (metadata.is_visually_hidden_from_conversation === true) {
    return { ...base, skipped: 'hidden' };
  }
  // An assistant message addressed to a tool is a function call, not a reply.
  if (
    role === 'assistant' &&
    typeof message.recipient === 'string' &&
    message.recipient !== 'all'
  ) {
    return { ...base, skipped: 'hidden' };
  }

  const content = isRecord(message.content) ? message.content : null;
  if (!content) return { ...base, skipped: 'hidden' };
  const contentType =
    typeof content.content_type === 'string' ? content.content_type : '';

  if (!VISIBLE_CONTENT_TYPES.has(contentType)) {
    if (KNOWN_SKIPPED_CONTENT_TYPES.has(contentType)) {
      return { ...base, skipped: 'known' };
    }
    return { ...base, skipped: 'unknown', unknownType: contentType || '(none)' };
  }

  const parts = Array.isArray(content.parts) ? content.parts : [];
  const textPieces: string[] = [];
  const attachments: Attachment[] = [];

  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.length > 0) textPieces.push(part);
      continue;
    }
    if (isRecord(part)) {
      // Images inside a multimodal user turn: keep a visible reference so the
      // transcript records that something was attached, without the bytes.
      const partType =
        typeof part.content_type === 'string' ? part.content_type : '';
      if (partType === 'image_asset_pointer') {
        attachments.push({ name: 'image' });
      } else if (typeof part.text === 'string' && part.text.length > 0) {
        textPieces.push(part.text);
      }
    }
  }

  // Named file attachments live in metadata, not in the content parts.
  const rawAttachments = Array.isArray(metadata.attachments)
    ? metadata.attachments
    : [];
  for (const a of rawAttachments) {
    if (!isRecord(a)) continue;
    attachments.push({
      name: typeof a.name === 'string' ? a.name : 'attachment',
      mimeType: typeof a.mime_type === 'string' ? a.mime_type : undefined,
      sizeBytes: typeof a.size === 'number' ? a.size : undefined,
    });
  }

  // ChatGPT writes private markers where its own interface shows a file chip.
  // Swap them for readable text here, so no surface above the adapter ever
  // has to know they existed.
  const { text, references } = normalizeChatGptReferences(
    textPieces.join('\n\n'),
    { contentReferences: metadata.content_references },
  );

  return { ...base, text, attachments, references };
}

export interface NormalizeOptions {
  url: string;
  /** How the payload was obtained, recorded in the retrieval status. */
  method: string;
}

/**
 * Convert a ChatGPT conversation payload into the common representation,
 * following only the branch the user is currently viewing.
 */
export function normalizeChatGptConversation(
  payload: unknown,
  options: NormalizeOptions,
): SourceConversation {
  if (!isRecord(payload)) {
    throw new ChatGptFormatError(
      'ChatGPT returned a conversation in a format Chat Threads does not recognize.',
      'payload was not an object',
    );
  }
  const mapping = payload.mapping;
  if (!isRecord(mapping)) {
    throw new ChatGptFormatError(
      'ChatGPT returned a conversation in a format Chat Threads does not recognize.',
      'missing "mapping"',
    );
  }

  const nodes = new Map<string, ChatGptNode>();
  for (const [id, node] of Object.entries(mapping)) {
    if (!isRecord(node)) continue;
    nodes.set(id, {
      id,
      parentId: typeof node.parent === 'string' ? node.parent : null,
      raw: node.message,
    });
  }

  if (nodes.size === 0) {
    throw new ChatGptFormatError(
      'ChatGPT returned a conversation with no messages in it.',
      'mapping was empty',
    );
  }

  const currentNode =
    typeof payload.current_node === 'string' ? payload.current_node : undefined;
  const branch = activeBranch(nodes, currentNode ?? findDeepestLeaf(nodes));

  const warnings: string[] = [];
  if (branch.warning) warnings.push(branch.warning);
  if (!currentNode) {
    warnings.push(
      'ChatGPT did not say which reply is currently displayed, so the longest branch was used.',
    );
  }

  const raw: RawTurnInput[] = [];
  let unknownSkipped = 0;
  const unknownTypes = new Set<string>();

  // Built alongside the turns so a branch marker can be tied back to the turn
  // it belongs to. `lastVisibleSequence` advances only when a turn is actually
  // emitted, which is what lets a marker on a hidden provider node resolve to
  // the visible turn before it instead of being lost.
  const sequenceByMessageId = new Map<string, number>();
  const lastVisibleSequenceByNodeId = new Map<string, number>();
  let lastVisibleSequence: number | undefined;

  for (const node of branch.path) {
    const extracted = extractMessage(node.raw);
    const emit =
      extracted !== null &&
      extracted.skipped === undefined &&
      (extracted.text !== '' || extracted.attachments.length > 0);

    if (emit) {
      const sequence = raw.length;
      if (extracted.messageId) {
        sequenceByMessageId.set(extracted.messageId, sequence);
      }
      lastVisibleSequence = sequence;

      raw.push({
        role: extracted.role,
        text: extracted.text,
        providerMessageId: extracted.messageId,
        parentMessageId: node.parentId ?? undefined,
        timestamp: extracted.timestamp,
        attachments: extracted.attachments,
        references: extracted.references,
      });
    } else if (extracted?.skipped === 'unknown') {
      unknownSkipped += 1;
      if (extracted.unknownType) unknownTypes.add(extracted.unknownType);
    }

    if (lastVisibleSequence !== undefined) {
      lastVisibleSequenceByNodeId.set(node.id, lastVisibleSequence);
    }
  }

  if (unknownSkipped > 0) {
    warnings.push(
      `${unknownSkipped} message${unknownSkipped === 1 ? '' : 's'} used a format Chat Threads did not recognize (${[...unknownTypes].join(', ')}) and ${unknownSkipped === 1 ? 'was' : 'were'} left out.`,
    );
  }

  const conversationId =
    typeof payload.conversation_id === 'string'
      ? payload.conversation_id
      : undefined;

  // "Complete" requires that ChatGPT told us which branch is on screen. A
  // guessed branch may be a perfectly good conversation, but it is not
  // necessarily the one the user is looking at, so it is never called complete.
  const completeness: RetrievalStatus['completeness'] =
    branch.reliable && unknownSkipped === 0 && currentNode
      ? 'complete'
      : 'unverified';

  const retrieval: RetrievalStatus = {
    completeness,
    method: options.method,
    detail:
      completeness === 'complete'
        ? 'Loaded from ChatGPT’s own conversation data, following the branch you are viewing.'
        : 'Loaded from ChatGPT’s own conversation data, but Chat Threads could not confirm it is complete.',
    warnings,
  };

  // Read only; nothing about branch detection leaves the machine, and it runs
  // whether or not the user has ever configured Find Topics.
  const branches = detectChatGptBranches({
    path: branch.path,
    sequenceByMessageId,
    lastVisibleSequenceByNodeId,
  });

  return {
    provider: 'chatgpt',
    conversationId,
    title: typeof payload.title === 'string' ? payload.title : undefined,
    url: options.url,
    createdAt: epochToIso(payload.create_time),
    turns: buildTurns('chatgpt', conversationId, raw),
    retrieval,
    branches,
  };
}

/**
 * Fallback leaf when `current_node` is absent: the deepest node reachable from
 * a root. Used only so a conversation still loads, and always accompanied by a
 * warning that the displayed branch could not be confirmed.
 */
function findDeepestLeaf(nodes: Map<string, ChatGptNode>): string | undefined {
  const depth = new Map<string, number>();
  const depthOf = (id: string, guard: Set<string>): number => {
    if (depth.has(id)) return depth.get(id) as number;
    if (guard.has(id)) return 0;
    guard.add(id);
    const node = nodes.get(id);
    const parent = node?.parentId;
    const d = parent && nodes.has(parent) ? depthOf(parent, guard) + 1 : 0;
    depth.set(id, d);
    return d;
  };

  let best: string | undefined;
  let bestDepth = -1;
  for (const id of nodes.keys()) {
    const d = depthOf(id, new Set());
    if (d > bestDepth) {
      bestDepth = d;
      best = id;
    }
  }
  return best;
}
