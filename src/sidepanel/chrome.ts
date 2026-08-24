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
        conversationId:
          typeof i.conversationId === 'string' ? i.conversationId : undefined,
        supported: i.supported === true,
        invoked: i.invoked === true,
        invokedAt: typeof i.invokedAt === 'number' ? i.invokedAt : undefined,
        contentScriptReady: false,
      };
    }
  }
  return { supported: false, invoked: false, contentScriptReady: false };
}

/**
 * Make sure the reader script is present in the tab, injecting it if not.
 *
 * Chat Threads declares no content scripts and holds no standing site access,
 * so nothing runs on ChatGPT or Claude until this is called — which only
 * happens after the user has invoked the extension on that tab, or granted
 * ongoing access to the site.
 *
 * Returns false when the browser refused, which means the grant has lapsed
 * (usually a page reload) rather than anything being broken.
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await pingContentScript(tabId)) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    return false;
  }

  // Injection resolves before the listener is necessarily registered.
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await pingContentScript(tabId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** Site access the user can grant so the panel stops needing the icon. */
export function providerOrigins(): string[] {
  return [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://claude.ai/*',
  ];
}

/** True when the user has already granted ongoing access to the sites. */
export async function hasProviderAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: providerOrigins() });
  } catch {
    return false;
  }
}

/**
 * Ask for ongoing access to the provider sites. Must be called from a click:
 * Chrome only grants optional permissions during a user gesture.
 */
export async function requestProviderAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: providerOrigins() });
  } catch {
    return false;
  }
}

/** Give ongoing site access back. */
export async function dropProviderAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.remove({ origins: providerOrigins() });
  } catch {
    return false;
  }
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
  downloadBlob(fileName, new Blob([text], { type: `${mimeType};charset=utf-8` }));
}

/** Hand the browser a file. Same path for text and for an archive. */
export function downloadBlob(fileName: string, blob: Blob): void {
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

/**
 * Save several files, one after another.
 *
 * Chrome treats a burst of downloads from one gesture as suspicious and will
 * either ask the user to allow them or drop the later ones. Spacing them out
 * is what makes fifteen files actually arrive; the zip is offered alongside
 * precisely because this is the fragile route.
 */
export async function downloadMany(
  files: readonly { name: string; text: string; mimeType: string }[],
): Promise<void> {
  for (const [i, file] of files.entries()) {
    downloadText(file.name, file.text, file.mimeType);
    if (i < files.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
