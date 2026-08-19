/**
 * Settings for the optional AI topic feature.
 *
 * The API key is kept in `chrome.storage.session` by default: it lives in
 * memory for the browser session, is never written to disk, and is not
 * reachable from a content script. "Remember on this device" moves it to
 * `chrome.storage.local`, which does persist — the panel says so plainly
 * before the user chooses it.
 *
 * Nothing here is ever synced, and the key is never included in any message
 * to the background worker or a content script.
 */

import type { AnalyzerConfig } from '../ai/types';
import { DEFAULT_MODELS } from '../ai/types';

const KEY_STORE = 'chatThreads.apiKey';
const PREFS_STORE = 'chatThreads.aiPrefs';

export interface AiPrefs {
  providerId: AnalyzerConfig['providerId'];
  model: string;
  /** True when the key should survive a browser restart. */
  rememberKey: boolean;
}

export const DEFAULT_PREFS: AiPrefs = {
  providerId: 'anthropic',
  model: DEFAULT_MODELS.anthropic,
  rememberKey: false,
};

export async function loadPrefs(): Promise<AiPrefs> {
  try {
    const stored = await chrome.storage.local.get(PREFS_STORE);
    const raw = stored[PREFS_STORE];
    if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFS;
    const r = raw as Record<string, unknown>;
    const providerId =
      r.providerId === 'openai' || r.providerId === 'anthropic'
        ? r.providerId
        : DEFAULT_PREFS.providerId;
    return {
      providerId,
      model: typeof r.model === 'string' && r.model ? r.model : DEFAULT_MODELS[providerId],
      rememberKey: r.rememberKey === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: AiPrefs): Promise<void> {
  try {
    await chrome.storage.local.set({ [PREFS_STORE]: prefs });
  } catch {
    // Storage being unavailable must not break the feature.
  }
}

/** Read the key from whichever store it was put in. */
export async function loadApiKey(): Promise<string> {
  try {
    const session = await chrome.storage.session.get(KEY_STORE);
    if (typeof session[KEY_STORE] === 'string') return session[KEY_STORE];
    const local = await chrome.storage.local.get(KEY_STORE);
    if (typeof local[KEY_STORE] === 'string') return local[KEY_STORE];
  } catch {
    // Fall through to "no key".
  }
  return '';
}

/**
 * Store the key. `remember` decides between the in-memory session store and
 * on-disk local storage; the other store is always cleared so a key cannot be
 * left behind after the user changes their mind.
 */
export async function saveApiKey(key: string, remember: boolean): Promise<void> {
  try {
    if (!key) {
      await clearApiKey();
      return;
    }
    if (remember) {
      await chrome.storage.local.set({ [KEY_STORE]: key });
      await chrome.storage.session.remove(KEY_STORE);
    } else {
      await chrome.storage.session.set({ [KEY_STORE]: key });
      await chrome.storage.local.remove(KEY_STORE);
    }
  } catch {
    // Ignore: the key simply will not be remembered.
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    await chrome.storage.session.remove(KEY_STORE);
    await chrome.storage.local.remove(KEY_STORE);
  } catch {
    // Nothing further to do.
  }
}

/** Ask for permission to call the chosen model host, at the moment of use. */
export async function ensureHostPermission(origin: string): Promise<boolean> {
  const origins = [`${origin}/*`];
  try {
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}
