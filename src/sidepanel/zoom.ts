/**
 * Making the panel bigger or smaller.
 *
 * Chrome's page zoom applies to the page, not to a side panel: zooming a
 * ChatGPT conversation leaves this document exactly the size it was, and there
 * is no obvious control for it. On a small screen, or for anyone who wants
 * larger text, that leaves the panel stuck.
 *
 * So the panel carries its own control. It uses the `zoom` property rather
 * than rescaling a font size, because every dimension here is in pixels and
 * `zoom` scales the lot — text, padding, controls and borders together —
 * without a stylesheet rewrite. It is a Chromium property, which is all this
 * extension runs on.
 *
 * The choice is remembered on this computer. It is a display preference, not
 * conversation data, so it lives in the same local storage as the model
 * settings and nothing about it ever leaves the machine.
 */

const STORE = 'chatThreads.zoom';

/** The steps offered, smallest first. 1 is the browser's own size. */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

export const DEFAULT_ZOOM = 1;

/** Round to a step, so a stored value from anywhere is still one of ours. */
export function nearestStep(value: number): number {
  let best: number = ZOOM_STEPS[0];
  for (const step of ZOOM_STEPS) {
    if (Math.abs(step - value) < Math.abs(best - value)) best = step;
  }
  return best;
}

/** The next step up or down, stopping at the ends rather than wrapping. */
export function stepFrom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.indexOf(nearestStep(current) as never);
  const next = index + direction;
  if (next < 0 || next >= ZOOM_STEPS.length) return ZOOM_STEPS[index]!;
  return ZOOM_STEPS[next]!;
}

/** How it is written on the button. */
export function zoomLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export async function loadZoom(): Promise<number> {
  try {
    const stored = await chrome.storage.local.get(STORE);
    const raw = stored[STORE];
    return typeof raw === 'number' && Number.isFinite(raw)
      ? nearestStep(raw)
      : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export async function saveZoom(value: number): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORE]: value });
  } catch {
    // A display preference is not worth failing over.
  }
}
