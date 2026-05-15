import { frameMatches } from '../shared/frame';
import type { BackgroundToContent } from '../shared/messages';

const MISSING_RECEIVER_MARKERS = [
  'Could not establish connection',
  'Receiving end does not exist',
];

export async function deliverToTab(tabId: number, msg: BackgroundToContent): Promise<void> {
  const delays = [0, 200, 400, 600, 800, 1000];
  let lastErr: unknown;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      await chrome.tabs.sendMessage(tabId, msg);
      return;
    } catch (e) {
      lastErr = e;
      const text = (e as Error).message ?? '';
      if (!MISSING_RECEIVER_MARKERS.some((m) => text.includes(m))) throw e;
    }
  }
  throw lastErr;
}

export async function deliverToFrame(tabId: number, frameId: number, msg: BackgroundToContent): Promise<void> {
  const delays = [0, 200, 400, 600, 800, 1000];
  let lastErr: unknown;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      await chrome.tabs.sendMessage(tabId, msg, { frameId });
      return;
    } catch (e) {
      lastErr = e;
      const text = (e as Error).message ?? '';
      if (!MISSING_RECEIVER_MARKERS.some((m) => text.includes(m))) throw e;
    }
  }
  throw lastErr;
}

const FRAME_RESOLVE_TIMEOUT_MS = 10_000;
const FRAME_RESOLVE_POLL_MS = 300;

/** Find the frameId of the (sub)frame whose URL origin+pathname matches `requiredFrameUrl`.
 *  Returns 0 (top) for empty/undefined. Polls up to FRAME_RESOLVE_TIMEOUT_MS waiting for
 *  the iframe to load. Throws with all observed frame URLs if no match found. */
export async function resolveFrameId(tabId: number, requiredFrameUrl: string | undefined): Promise<number> {
  if (!requiredFrameUrl) return 0;
  const start = Date.now();
  let lastSeenUrls: string[] = [];
  while (Date.now() - start < FRAME_RESOLVE_TIMEOUT_MS) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => location.href,
      });
      lastSeenUrls = results
        .map((r) => (typeof r.result === 'string' ? r.result : ''))
        .filter((u) => u.length > 0);
      for (const r of results) {
        if (typeof r.result === 'string' && frameMatches(requiredFrameUrl, r.result)) {
          return r.frameId;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, FRAME_RESOLVE_POLL_MS));
  }
  throw new Error(
    `找不到 URL 匹配的 frame：${requiredFrameUrl}\n当前 tab 内 frame URL：\n${lastSeenUrls.join('\n')}`,
  );
}

export async function broadcastStateRefresh(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        document.dispatchEvent(new CustomEvent('__webxport_refresh_state__'));
      },
    });
  } catch (e) {
    console.log('[webxport bg] broadcastStateRefresh failed:', (e as Error).message);
  }
}
