/**
 * Claude retrieval.
 *
 * Runs inside a content script on claude.ai, so these are same-origin requests
 * carrying the session cookie the browser already holds. Chat Threads never
 * reads, stores, or transmits that cookie — the browser attaches it, and the
 * response never leaves the user's machine.
 *
 * These are claude.ai's own undocumented web-app endpoints and may change
 * without notice — see docs/LIMITATIONS.md.
 */

/** Conversation id from a /chat/<uuid> URL, when there is one. */
export function conversationIdFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/chat\/([0-9a-fA-F-]{8,}(?:-[0-9a-fA-F]{4,}){0,4})/,
    );
    return m?.[1];
  } catch {
    return undefined;
  }
}

export class ClaudeRetrievalError extends Error {
  constructor(
    readonly code:
      | 'not-authenticated'
      | 'no-conversation'
      | 'network'
      | 'provider-format-changed',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ClaudeRetrievalError';
  }
}

async function getJson(url: string, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ClaudeRetrievalError(
      'network',
      `Chat Threads could not reach Claude to load ${what}.`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ClaudeRetrievalError(
      'not-authenticated',
      'You appear to be signed out of Claude.',
      res.status,
    );
  }
  if (res.status === 404) {
    throw new ClaudeRetrievalError(
      'no-conversation',
      'Claude does not have a saved conversation at this address yet.',
      404,
    );
  }
  if (!res.ok) {
    throw new ClaudeRetrievalError(
      'network',
      `Claude returned ${res.status} when Chat Threads asked for ${what}.`,
      res.status,
    );
  }
  try {
    return await res.json();
  } catch {
    throw new ClaudeRetrievalError(
      'provider-format-changed',
      `Claude’s reply for ${what} was not readable.`,
    );
  }
}

/**
 * Find the organization the conversation belongs to.
 *
 * Claude scopes conversations under an organization id that does not appear in
 * the chat URL, so it has to be looked up. Accounts with more than one
 * organization use the one Claude lists first with chat enabled.
 */
export async function getOrganizationId(origin: string): Promise<string> {
  const body = await getJson(`${origin}/api/organizations`, 'your account');
  if (!Array.isArray(body) || body.length === 0) {
    throw new ClaudeRetrievalError(
      'not-authenticated',
      'Chat Threads could not tell which Claude account is signed in.',
    );
  }
  const orgs = body.filter(
    (o): o is Record<string, unknown> =>
      typeof o === 'object' && o !== null && typeof (o as { uuid?: unknown }).uuid === 'string',
  );
  const withChat = orgs.find((o) => {
    const caps = o.capabilities;
    return Array.isArray(caps) && caps.includes('chat');
  });
  const chosen = withChat ?? orgs[0];
  if (!chosen) {
    throw new ClaudeRetrievalError(
      'provider-format-changed',
      'Claude listed your account in a format Chat Threads does not recognize.',
    );
  }
  return chosen.uuid as string;
}

/** Retrieve one conversation, including its branch structure. */
export async function fetchConversation(
  origin: string,
  organizationId: string,
  conversationId: string,
): Promise<unknown> {
  const url =
    `${origin}/api/organizations/${encodeURIComponent(organizationId)}` +
    `/chat_conversations/${encodeURIComponent(conversationId)}` +
    `?tree=True&rendering_mode=messages`;
  return getJson(url, 'this conversation');
}
