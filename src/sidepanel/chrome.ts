/**
 * Talking to the rest of the extension from the side panel.
 *
 * Every reply is run through the validators in `model/messages` before it is
 * used, so a malformed or unexpected message becomes a clear failure rather
 * than corrupt state.
 */

import {
  parseAdapterResult,
  parseIdentity,
  type ActiveTabInfo,
} from '../model/messages';
import type { AdapterResult, ConversationIdentity } from '../model/types';

/** Which tab the panel is currently looking at. */
export async function getActiveTab(): Promise<ActiveTabInfo> {
  const reply = await sendToBackground({ type: 'bg:get-active-tab' });
  if (
    typeof reply === 'object' &&
    reply !== null &&
    (reply as { type?: unknown }).type === 'ok:active-tab'
  ) {
    const info = (reply as { info?: unknown }).info;
    if (typeof info === 'object' && info !== null) {
      const i = info as Record<string, unknown>;
      return {
        tabId: typeof i.tabId === 'number' ? i.tabId : undefined,
        url: typeof i.url === 'string' ? i.url : undefined,
        provider:
          i.provider === 'chatgpt' || i.provider === 'claude'
            ? i.provider
            : undefined,
        supported: i.supported === true,
        contentScriptReady: false,
      };
    }
  }
  return { supported: false, contentScriptReady: false };
}

/** Ask the content script which conversation is open, if any. */
export async function getIdentity(
  tabId: number,
): Promise<ConversationIdentity | null> {
  const reply = await sendToTab(tabId, { type: 'ct:identify' });
  if (
    typeof reply === 'object' &&
    reply !== null &&
    (reply as { type?: unknown }).type === 'ok:identity'
  ) {
    return parseIdentity((reply as { identity?: unknown }).identity);
  }
  return null;
}

/** Ask the content script to retrieve and normalize the conversation. */
export async function loadConversation(tabId: number): Promise<AdapterResult> {
  const reply = await sendToTab(tabId, { type: 'ct:load' });
  if (
    typeof reply === 'object' &&
    reply !== null &&
    (reply as { type?: unknown }).type === 'ok:conversation'
  ) {
    const result = parseAdapterResult((reply as { result?: unknown }).result);
    if (result) return result;
  }
  return {
    ok: false,
    adapter: 'chatgpt',
    code: 'unknown',
    message: 'Chat Threads could not read the reply from the page.',
  };
}

/** True when a content script is loaded in the tab and answering. */
export async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const reply = await sendToTab(tabId, { type: 'ct:ping' });
    return (
      typeof reply === 'object' &&
      reply !== null &&
      (reply as { type?: unknown }).type === 'ok:pong'
    );
  } catch {
    return false;
  }
}

function sendToBackground(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      // Reading lastError stops Chrome logging an unchecked-error warning.
      void chrome.runtime.lastError;
      resolve(reply);
    });
  });
}

function sendToTab(tabId: number, message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (reply) => {
      void chrome.runtime.lastError;
      resolve(reply);
    });
  });
}

/** Copy text to the clipboard, reporting whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Offer a file to the user.
 *
 * Uses an object URL and a synthetic click rather than the downloads API, so
 * the extension does not need the `downloads` permission.
 */
export function downloadText(
  fileName: string,
  text: string,
  mimeType: string,
): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
