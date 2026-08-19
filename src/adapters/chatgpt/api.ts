/**
 * ChatGPT retrieval.
 *
 * Runs inside a content script on ChatGPT's own origin, so these are ordinary
 * same-origin requests made with the session the user is already signed in
 * with. Chat Threads never stores, reads, or transmits that session anywhere:
 * the short-lived access token below stays in this function's scope and is
 * never sent to the side panel, the service worker, or any other server.
 *
 * These endpoints are ChatGPT's own undocumented web-app endpoints. They may
 * change without notice — see docs/LIMITATIONS.md.
 */

/** Conversation id from a /c/<uuid> URL, when there is one. */
export function conversationIdFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const m = u.pathname.match(
      /\/c\/([0-9a-fA-F-]{8,}(?:-[0-9a-fA-F]{4,}){0,4})/,
    );
    return m?.[1];
  } catch {
    return undefined;
  }
}

export class ChatGptRetrievalError extends Error {
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
    this.name = 'ChatGptRetrievalError';
  }
}

/**
 * Fetch the access token the ChatGPT web app itself uses.
 *
 * Same-origin and cookie-authenticated; the value is returned to the caller
 * for immediate use in one request and then discarded.
 */
async function getAccessToken(origin: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${origin}/api/auth/session`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ChatGptRetrievalError(
      'network',
      'Chat Threads could not reach ChatGPT to check your session.',
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ChatGptRetrievalError(
      'not-authenticated',
      'You appear to be signed out of ChatGPT.',
      res.status,
    );
  }
  if (!res.ok) {
    throw new ChatGptRetrievalError(
      'network',
      `ChatGPT returned ${res.status} when Chat Threads checked your session.`,
      res.status,
    );
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ChatGptRetrievalError(
      'provider-format-changed',
      'ChatGPT’s session response was not readable.',
    );
  }
  const token =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).accessToken === 'string'
      ? ((body as Record<string, unknown>).accessToken as string)
      : '';
  if (!token) {
    throw new ChatGptRetrievalError(
      'not-authenticated',
      'You appear to be signed out of ChatGPT.',
    );
  }
  return token;
}

/** Retrieve one conversation's full structured data. */
export async function fetchConversation(
  origin: string,
  conversationId: string,
): Promise<unknown> {
  const token = await getAccessToken(origin);

  let res: Response;
  try {
    res = await fetch(
      `${origin}/backend-api/conversation/${encodeURIComponent(conversationId)}`,
      {
        credentials: 'include',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
      },
    );
  } catch {
    throw new ChatGptRetrievalError(
      'network',
      'Chat Threads could not reach ChatGPT to load this conversation.',
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new ChatGptRetrievalError(
      'not-authenticated',
      'ChatGPT refused the request. Try reloading the page and signing in again.',
      res.status,
    );
  }
  if (res.status === 404) {
    throw new ChatGptRetrievalError(
      'no-conversation',
      'ChatGPT does not have a saved conversation at this address yet.',
      404,
    );
  }
  if (!res.ok) {
    throw new ChatGptRetrievalError(
      'network',
      `ChatGPT returned ${res.status} when Chat Threads asked for this conversation.`,
      res.status,
    );
  }

  try {
    return await res.json();
  } catch {
    throw new ChatGptRetrievalError(
      'provider-format-changed',
      'ChatGPT’s reply was not readable as conversation data.',
    );
  }
}
