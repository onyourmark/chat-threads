/**
 * The message protocol between the side panel, the background service worker,
 * and the content scripts.
 *
 * Everything crossing an extension boundary is validated here before use. A
 * content script runs in a page we do not control, so its replies are treated
 * as untrusted input just like conversation text is.
 */

import type {
  AdapterFailureCode,
  AdapterResult,
  ConversationIdentity,
  ProviderId,
  RetrievalCompleteness,
  Role,
  SourceConversation,
} from './types';

/** Sent by the side panel to a content script. */
export type PanelRequest =
  | { type: 'ct:ping' }
  | { type: 'ct:identify' }
  | { type: 'ct:load' };

/** Sent by the side panel to the background service worker. */
export type BackgroundRequest =
  | { type: 'bg:get-active-tab' }
  | { type: 'bg:load-active-tab' };

/** What the background reports about the active tab. */
export interface ActiveTabInfo {
  tabId?: number;
  /**
   * The tab's address, when Chat Threads is allowed to read it. Absent means
   * the extension has no access to this tab — not that the tab has no URL.
   */
  url?: string;
  provider?: ProviderId;
  /** True when the URL matches a supported provider host. */
  supported: boolean;
  /** True when the user invoked Chat Threads on this specific tab. */
  invoked: boolean;
  /** True when the content script answered a ping. */
  contentScriptReady: boolean;
}

export type PanelResponse =
  | { type: 'ok:pong' }
  | { type: 'ok:identity'; identity: ConversationIdentity | null }
  | { type: 'ok:conversation'; result: AdapterResult }
  | { type: 'ok:active-tab'; info: ActiveTabInfo }
  | { type: 'error'; message: string };

const PROVIDERS: readonly ProviderId[] = ['chatgpt', 'claude'];
const ROLES: readonly Role[] = ['user', 'assistant'];
const COMPLETENESS: readonly RetrievalCompleteness[] = [
  'complete',
  'unverified',
  'partial',
];
const FAILURE_CODES: readonly AdapterFailureCode[] = [
  'no-conversation',
  'not-authenticated',
  'provider-format-changed',
  'network',
  'unsupported-page',
  'unknown',
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Validate a message arriving at a content script.
 *
 * Only messages from this extension reach here (Chrome enforces the sender),
 * but the shape is still checked so a malformed message is rejected rather
 * than dispatched.
 */
export function parsePanelRequest(v: unknown): PanelRequest | null {
  if (!isRecord(v) || !isString(v.type)) return null;
  switch (v.type) {
    case 'ct:ping':
    case 'ct:identify':
    case 'ct:load':
      return { type: v.type };
    default:
      return null;
  }
}

export function parseBackgroundRequest(v: unknown): BackgroundRequest | null {
  if (!isRecord(v) || !isString(v.type)) return null;
  if (v.type === 'bg:get-active-tab' || v.type === 'bg:load-active-tab') {
    return { type: v.type };
  }
  return null;
}

/**
 * Validate an `AdapterResult` that crossed a boundary.
 *
 * Returns `null` when the payload is not a well-formed result. Unknown extra
 * fields are dropped rather than passed through, so nothing a page injected
 * can reach the rest of the application.
 */
export function parseAdapterResult(v: unknown): AdapterResult | null {
  if (!isRecord(v)) return null;

  if (v.ok === false) {
    const adapter = v.adapter;
    if (!isString(adapter) || !PROVIDERS.includes(adapter as ProviderId)) {
      return null;
    }
    if (!isString(v.message)) return null;
    const code =
      isString(v.code) && FAILURE_CODES.includes(v.code as AdapterFailureCode)
        ? (v.code as AdapterFailureCode)
        : 'unknown';
    const diagnostics: Record<string, string | number | boolean> = {};
    if (isRecord(v.diagnostics)) {
      for (const [k, dv] of Object.entries(v.diagnostics)) {
        if (
          typeof dv === 'string' ||
          typeof dv === 'number' ||
          typeof dv === 'boolean'
        ) {
          diagnostics[k] = dv;
        }
      }
    }
    return {
      ok: false,
      adapter: adapter as ProviderId,
      code,
      message: v.message,
      diagnostics,
    };
  }

  if (v.ok !== true) return null;
  const conversation = parseSourceConversation(v.conversation);
  if (!conversation) return null;
  return { ok: true, conversation };
}

/** Validate and rebuild a `SourceConversation`, dropping anything unexpected. */
export function parseSourceConversation(v: unknown): SourceConversation | null {
  if (!isRecord(v)) return null;
  const provider = v.provider;
  if (!isString(provider) || !PROVIDERS.includes(provider as ProviderId)) {
    return null;
  }
  if (!isString(v.url)) return null;
  if (!Array.isArray(v.turns)) return null;
  if (!isRecord(v.retrieval)) return null;

  const r = v.retrieval;
  const completeness = COMPLETENESS.includes(
    r.completeness as RetrievalCompleteness,
  )
    ? (r.completeness as RetrievalCompleteness)
    : 'unverified';

  const turns: SourceConversation['turns'] = v.turns.flatMap((t: unknown) => {
    if (!isRecord(t)) return [];
    if (!isString(t.id) || !isString(t.originalText)) return [];
    if (!isString(t.role) || !ROLES.includes(t.role as Role)) return [];
    const attachments = Array.isArray(t.attachments)
      ? t.attachments.flatMap((a: unknown) => {
          if (!isRecord(a) || !isString(a.name)) return [];
          return [
            {
              name: a.name,
              mimeType: optString(a.mimeType),
              sizeBytes:
                typeof a.sizeBytes === 'number' ? a.sizeBytes : undefined,
            },
          ];
        })
      : [];
    const references = Array.isArray(t.references)
      ? t.references.flatMap((r: unknown) => {
          if (!isRecord(r)) return [];
          const kind = r.kind === 'file' ? 'file' : 'other';
          return [
            {
              kind: kind as 'file' | 'other',
              name: optString(r.name),
              raw: isString(r.raw) ? r.raw : '',
            },
          ];
        })
      : [];
    return [
      {
        id: t.id,
        provider: provider as ProviderId,
        providerMessageId: optString(t.providerMessageId),
        providerConversationId: optString(t.providerConversationId),
        sequence: typeof t.sequence === 'number' ? t.sequence : 0,
        role: t.role as Role,
        originalText: t.originalText,
        workingText: isString(t.workingText) ? t.workingText : t.originalText,
        timestamp: optString(t.timestamp),
        parentMessageId: optString(t.parentMessageId),
        attachments,
        references,
        included: t.included !== false,
        assignment: isString(t.assignment) ? t.assignment : 'unassigned',
        edited: t.edited === true,
        uncertain: t.uncertain === true,
        assignmentOverridden: t.assignmentOverridden === true,
      },
    ];
  });

  return {
    provider: provider as ProviderId,
    conversationId: optString(v.conversationId),
    title: optString(v.title),
    url: v.url,
    createdAt: optString(v.createdAt),
    turns,
    retrieval: {
      completeness,
      method: isString(r.method) ? r.method : 'unknown',
      detail: isString(r.detail) ? r.detail : '',
      warnings: Array.isArray(r.warnings) ? r.warnings.filter(isString) : [],
    },
  };
}

/** Validate a `ConversationIdentity` that crossed a boundary. */
export function parseIdentity(v: unknown): ConversationIdentity | null {
  if (!isRecord(v)) return null;
  const provider = v.provider;
  if (!isString(provider) || !PROVIDERS.includes(provider as ProviderId)) {
    return null;
  }
  if (!isString(v.url)) return null;
  return {
    provider: provider as ProviderId,
    conversationId: optString(v.conversationId),
    title: optString(v.title),
    url: v.url,
  };
}
