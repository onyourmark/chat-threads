/**
 * Claude normalization: provider payload -> common representation.
 *
 * Pure, so fixtures can drive it with no network and no browser. Everything
 * Claude-shaped stops here.
 *
 * The shape below is claude.ai's *undocumented* internal conversation format.
 * It can change without notice; when it does, this file is the one to repair.
 * See docs/LIMITATIONS.md.
 */

import { activeBranch, type BranchNode } from '../branch';
import { buildTurns, type RawTurnInput } from '../../model/conversation';
import { unsupportedBranches } from '../../model/branch';
import type {
  Attachment,
  Role,
  RetrievalStatus,
  SourceConversation,
} from '../../model/types';

/**
 * Content block types that are part of the visible conversation.
 *
 * `thinking` is deliberately absent: extended-thinking blocks are model
 * reasoning, which Chat Threads does not collect.
 */
const VISIBLE_BLOCK_TYPES = new Set(['text']);

/** Block types we know about and intentionally skip. */
const KNOWN_SKIPPED_BLOCK_TYPES = new Set([
  'thinking',
  'redacted_thinking',
  'tool_use',
  'tool_result',
  'knowledge',
]);

export class ClaudeFormatError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'ClaudeFormatError';
  }
}

interface ClaudeNode extends BranchNode {
  raw: Record<string, unknown>;
  index: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isoOrUndefined(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function roleOf(message: Record<string, unknown>): Role | null {
  const sender = message.sender;
  if (sender === 'human') return 'user';
  if (sender === 'assistant') return 'assistant';
  return null;
}

interface Extracted {
  text: string;
  attachments: Attachment[];
  unknownBlockTypes: string[];
}

/** Pull visible text and attachment names out of one Claude message. */
function extractMessage(message: Record<string, unknown>): Extracted {
  const pieces: string[] = [];
  const attachments: Attachment[] = [];
  const unknownBlockTypes: string[] = [];

  const blocks = Array.isArray(message.content) ? message.content : null;
  if (blocks) {
    for (const block of blocks) {
      if (!isRecord(block)) continue;
      const type = typeof block.type === 'string' ? block.type : '';
      if (VISIBLE_BLOCK_TYPES.has(type)) {
        if (typeof block.text === 'string' && block.text.length > 0) {
          pieces.push(block.text);
        }
        continue;
      }
      if (!KNOWN_SKIPPED_BLOCK_TYPES.has(type)) {
        unknownBlockTypes.push(type || '(none)');
      }
    }
  }

  // Older payloads (and `rendering_mode=raw`) carry a flat `text` field.
  if (pieces.length === 0 && typeof message.text === 'string' && message.text) {
    pieces.push(message.text);
  }

  // Uploaded documents.
  const rawAttachments = Array.isArray(message.attachments)
    ? message.attachments
    : [];
  for (const a of rawAttachments) {
    if (!isRecord(a)) continue;
    attachments.push({
      name: typeof a.file_name === 'string' ? a.file_name : 'attachment',
      mimeType: typeof a.file_type === 'string' ? a.file_type : undefined,
      sizeBytes: typeof a.file_size === 'number' ? a.file_size : undefined,
    });
  }
  // Pasted or uploaded images.
  const files = Array.isArray(message.files) ? message.files : [];
  for (const f of files) {
    if (!isRecord(f)) continue;
    attachments.push({
      name: typeof f.file_name === 'string' ? f.file_name : 'image',
    });
  }

  return { text: pieces.join('\n\n'), attachments, unknownBlockTypes };
}

export interface NormalizeOptions {
  url: string;
  method: string;
}

export function normalizeClaudeConversation(
  payload: unknown,
  options: NormalizeOptions,
): SourceConversation {
  if (!isRecord(payload)) {
    throw new ClaudeFormatError(
      'Claude returned a conversation in a format Chat Threads does not recognize.',
      'payload was not an object',
    );
  }
  const messages = payload.chat_messages;
  if (!Array.isArray(messages)) {
    throw new ClaudeFormatError(
      'Claude returned a conversation in a format Chat Threads does not recognize.',
      'missing "chat_messages"',
    );
  }
  if (messages.length === 0) {
    throw new ClaudeFormatError(
      'Claude returned a conversation with no messages in it.',
      'chat_messages was empty',
    );
  }

  const nodes = new Map<string, ClaudeNode>();
  messages.forEach((m: unknown, i: number) => {
    if (!isRecord(m)) return;
    const uuid = typeof m.uuid === 'string' ? m.uuid : `index-${i}`;
    nodes.set(uuid, {
      id: uuid,
      parentId:
        typeof m.parent_message_uuid === 'string' ? m.parent_message_uuid : null,
      raw: m,
      index: typeof m.index === 'number' ? m.index : i,
    });
  });

  // Claude marks the root with a sentinel parent uuid that is not itself a
  // message. Treat any parent we do not hold as "this is the root" so the
  // branch walk ends cleanly instead of reporting a gap.
  for (const node of nodes.values()) {
    if (node.parentId && !nodes.has(node.parentId)) node.parentId = null;
  }

  const warnings: string[] = [];
  const leaf =
    typeof payload.current_leaf_message_uuid === 'string'
      ? payload.current_leaf_message_uuid
      : undefined;

  let ordered: ClaudeNode[];
  let branchReliable: boolean;

  if (leaf && nodes.has(leaf)) {
    const branch = activeBranch(nodes, leaf);
    ordered = branch.path;
    branchReliable = branch.reliable;
    if (branch.warning) warnings.push(branch.warning);
  } else {
    // No usable leaf pointer: fall back to the order Claude served, which is
    // the display order for a conversation that was never branched.
    ordered = [...nodes.values()].sort((a, b) => a.index - b.index);
    branchReliable = false;
    warnings.push(
      'Claude did not say which reply is currently displayed. If you have edited a message or asked for another try, this transcript may follow a different branch than the page shows.',
    );
  }

  const raw: RawTurnInput[] = [];
  const unknownTypes = new Set<string>();
  let unknownCount = 0;

  for (const node of ordered) {
    const role = roleOf(node.raw);
    if (!role) continue;
    const extracted = extractMessage(node.raw);
    if (extracted.unknownBlockTypes.length > 0) {
      unknownCount += 1;
      extracted.unknownBlockTypes.forEach((t) => unknownTypes.add(t));
    }
    if (!extracted.text && extracted.attachments.length === 0) continue;
    raw.push({
      role,
      text: extracted.text,
      providerMessageId: node.id,
      parentMessageId: node.parentId ?? undefined,
      timestamp: isoOrUndefined(node.raw.created_at),
      attachments: extracted.attachments,
    });
  }

  if (unknownCount > 0) {
    warnings.push(
      `${unknownCount} message${unknownCount === 1 ? '' : 's'} contained parts in a format Chat Threads did not recognize (${[...unknownTypes].join(', ')}). Their text was still included; the unrecognized parts were not.`,
    );
  }

  const conversationId = typeof payload.uuid === 'string' ? payload.uuid : undefined;
  const completeness: RetrievalStatus['completeness'] =
    branchReliable && unknownCount === 0 ? 'complete' : 'unverified';

  return {
    provider: 'claude',
    conversationId,
    title: typeof payload.name === 'string' && payload.name ? payload.name : undefined,
    url: options.url,
    createdAt: isoOrUndefined(payload.created_at),
    turns: buildTurns('claude', conversationId, raw),
    retrieval: {
      completeness,
      method: options.method,
      detail:
        completeness === 'complete'
          ? 'Loaded from Claude’s own conversation data, following the branch you are viewing.'
          : 'Loaded from Claude’s own conversation data, but Chat Threads could not confirm it is complete.',
      warnings,
    },
    // Claude's conversation tree forks for edits and regenerations, exactly as
    // ChatGPT's does, but it has no equivalent of "Branch in new chat" and
    // records nothing that ties one conversation to another. Saying so is not
    // the same as saying this conversation has no branches, and the panel
    // shows the two differently.
    branches: unsupportedBranches(
      'Claude does not record where a conversation was branched from, so Chat Threads cannot find a branch point in a Claude chat.',
    ),
  };
}
