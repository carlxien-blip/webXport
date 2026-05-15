import { frameMatches } from '../shared/frame';
import type { BackgroundToContent } from '../shared/messages';

const MISSING_RECEIVER_MARKERS = [
  'Could not establish connection',
  'Receiving end does not exist',
];

/** Retry sendMessage on "Receiving end does not exist". After a couple failed
 *  retries, inject the content script manually — manifest content_scripts may
 *  not yet have run on heavy SPAs (抖音 creator) by tabs.status='complete'. */
async function deliverWithRetry(
  send: () => Promise<unknown>,
  injectFallback: () => Promise<void>,
): Promise<void> {
  const delays = [0, 200, 400, 600, 800, 1000];
  let lastErr: unknown;
  let injected = false;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      await send();
      return;
    } catch (e) {
      lastErr = e;
      const text = (e as Error).message ?? '';
      if (!MISSING_RECEIVER_MARKERS.some((m) => text.includes(m))) throw e;
      // After ~600ms of retries, try injecting once.
      if (!injected && i >= 2) {
        injected = true;
        try {
          await injectFallback();
        } catch (injErr) {
          console.log('[webxport bg] inject fallback failed:', (injErr as Error).message);
        }
      }
    }
  }
  throw lastErr;
}

async function injectContentScript(tabId: number, frameId?: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files || files.length === 0) {
    throw new Error('content_scripts manifest entry has no js files');
  }
  const target: chrome.scripting.InjectionTarget =
    frameId === undefined ? { tabId } : { tabId, frameIds: [frameId] };
  await chrome.scripting.executeScript({ target, files });
}

export function deliverToTab(tabId: number, msg: BackgroundToContent): Promise<void> {
  return deliverWithRetry(
    () => chrome.tabs.sendMessage(tabId, msg),
    () => injectContentScript(tabId),
  );
}

export function deliverToFrame(tabId: number, frameId: number, msg: BackgroundToContent): Promise<void> {
  return deliverWithRetry(
    () => chrome.tabs.sendMessage(tabId, msg, { frameId }),
    () => injectContentScript(tabId, frameId),
  );
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
  const summary = `找不到 URL 匹配的 frame：${requiredFrameUrl}`;
  console.error('[webxport bg]', summary, '— observed frames:', lastSeenUrls);
  throw new Error(summary);
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
