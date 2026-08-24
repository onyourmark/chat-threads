/**
 * Turning a provider's rejection into something a person can act on.
 *
 * This exists because of a specific, wasted afternoon. A long conversation was
 * refused for being too large, and the panel said "The OpenAI API rejected the
 * request. Check the model name." The model name was fine. Every HTTP 400 had
 * been collapsed into one guess, and the guess pointed at the wrong thing.
 *
 * So the status code is only the starting point here. Where the provider sent
 * a JSON error body — both do — its `code`, `type` and `message` are read and
 * used to tell apart the failures that need different actions from the user:
 * a bad key, an exhausted quota, a model they cannot reach, a request too big
 * for the model, a malformed request, and the provider simply being down.
 *
 * ## The one hard rule
 *
 * The user's API key must never appear in anything shown, logged or copied.
 * A provider's own message is not trusted to be free of it — an error can
 * quote the credential it rejected — so `redactSecrets` runs over every
 * provider-supplied string before it is used, and the tests in
 * `tests/api-key-security.test.ts` drive real error bodies containing a
 * key-shaped string through both clients to prove it.
 */

/** What went wrong, in terms of what the user would do about it. */
export type ProviderFault =
  | 'auth'
  | 'quota'
  | 'rate-limit'
  | 'model'
  | 'too-large'
  | 'bad-request'
  | 'server'
  | 'unknown';

/**
 * Remove anything key-shaped from provider text.
 *
 * Deliberately broad. Losing a few characters of an error message costs the
 * user nothing; leaking a credential into a screenshot costs them a key.
 */
export function redactSecrets(text: string): string {
  return (
    text
      // Both providers' keys, and anything else wearing the same clothes.
      .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{4,}/gi, '[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
      // A long opaque run carrying both letters and digits is a token, not
      // prose. Checked in the replacer rather than with lookahead, so the
      // condition stays readable.
      .replace(/[A-Za-z0-9_-]{24,}/g, (run) =>
        /\d/.test(run) && /[A-Za-z]/.test(run) ? '[redacted]' : run,
      )
  );
}

/**
 * Make a provider's own sentence safe to display.
 *
 * Redacted, stripped of control characters, and clamped — it is rendered as
 * text rather than markup, so this is about legibility and secrets rather than
 * injection.
 */
export function sanitizeProviderMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = redactSecrets(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 200) return cleaned;
  return `${cleaned.slice(0, 200)}…`;
}

/** The `{ error: { ... } }` object both providers return, when there is one. */
export interface ProviderError {
  code: string;
  type: string;
  message: string;
}

/** Read the error envelope without trusting any of its shape. */
export function readProviderError(body: unknown): ProviderError {
  const empty: ProviderError = { code: '', type: '', message: '' };
  if (typeof body !== 'object' || body === null) return empty;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== 'object' || error === null) return empty;
  const e = error as Record<string, unknown>;
  return {
    code: typeof e.code === 'string' ? e.code.toLowerCase() : '',
    type: typeof e.type === 'string' ? e.type.toLowerCase() : '',
    message: sanitizeProviderMessage(e.message),
  };
}

/** Read a response body as JSON, or give up quietly. */
export async function readErrorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Phrases a provider uses when the prompt did not fit. */
const TOO_LARGE = [
  'context length',
  'context_length',
  'maximum context',
  'too long',
  'too large',
  'reduce the length',
  'exceeds the maximum',
  'prompt is too long',
];

/** Phrases a provider uses when the model is not one this key can call. */
const NO_SUCH_MODEL = [
  'does not exist',
  'do not have access',
  'not found',
  'unknown model',
  'unsupported model',
];

function mentions(message: string, phrases: readonly string[]): boolean {
  const lower = message.toLowerCase();
  return phrases.some((p) => lower.includes(p));
}

/**
 * Classify a failed request.
 *
 * Body first, status second: the status code is coarse — one 400 covers a
 * prompt that was too big, a model that does not exist and a typo in a
 * parameter — while the body says which of those it was.
 */
export function classifyProviderError(
  status: number,
  error: ProviderError,
): ProviderFault {
  const { code, type, message } = error;

  if (code === 'context_length_exceeded' || mentions(message, TOO_LARGE)) {
    return 'too-large';
  }
  if (
    code === 'insufficient_quota' ||
    type === 'insufficient_quota' ||
    message.toLowerCase().includes('quota') ||
    message.toLowerCase().includes('billing')
  ) {
    return 'quota';
  }
  if (
    code === 'invalid_api_key' ||
    type === 'authentication_error' ||
    type === 'permission_error' ||
    status === 401 ||
    status === 403
  ) {
    return 'auth';
  }
  if (
    code === 'rate_limit_exceeded' ||
    type === 'rate_limit_error' ||
    status === 429
  ) {
    return 'rate-limit';
  }
  if (
    code === 'model_not_found' ||
    type === 'not_found_error' ||
    status === 404 ||
    mentions(message, NO_SUCH_MODEL)
  ) {
    return 'model';
  }
  if (type === 'overloaded_error' || status >= 500) return 'server';
  if (status === 400 || type === 'invalid_request_error') return 'bad-request';
  return 'unknown';
}

/**
 * Say what happened, in the second person, with the next step in it.
 *
 * The provider's own sentence is appended where it adds something the fault
 * alone does not — a malformed request, or a failure we could not classify.
 * For the faults that are already unambiguous, repeating the provider's
 * wording only makes the message longer.
 */
export function describeProviderFault(
  provider: string,
  fault: ProviderFault,
  status: number,
  error: ProviderError,
): string {
  const detail = error.message ? ` ${provider} said: ${error.message}` : '';

  switch (fault) {
    case 'auth':
      return `${provider} rejected that API key. Check that it is current and has access to this model.`;
    case 'quota':
      return `That ${provider} account is out of credit or over its quota. Check its billing, then try again.`;
    case 'rate-limit':
      return `${provider} is rate limiting this key. Wait a moment and try again.`;
    case 'model':
      return `${provider} does not have a model by that name, or this key cannot reach it. Check the model name.`;
    case 'too-large':
      return `The request was too large for this model, even after being split. Try a model with a larger context window, or exclude some turns.${detail}`;
    case 'bad-request':
      return `${provider} rejected the request as malformed.${detail}`;
    case 'server':
      return `${provider} had a problem at its end. Try again shortly.`;
    default:
      return `${provider} returned an error (${status}).${detail}`;
  }
}

/** The whole path: status and body in, one displayable sentence out. */
export function describeHttpFailure(
  provider: string,
  status: number,
  body: unknown,
): string {
  const error = readProviderError(body);
  return describeProviderFault(
    provider,
    classifyProviderError(status, error),
    status,
    error,
  );
}
