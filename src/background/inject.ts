import type { BackgroundToContent } from '../shared/messages';

const MISSING_RECEIVER_MARKERS = [
  'Could not establish connection',
  'Receiving end does not exist',
];

export async function deliverToTab(tabId: number, msg: BackgroundToContent): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
    return;
  } catch (e) {
    const text = (e as Error).message ?? '';
    const isMissingReceiver = MISSING_RECEIVER_MARKERS.some((m) => text.includes(m));
    if (!isMissingReceiver) throw e;
    console.log('[webxport] content script not present in tab, injecting');
    await injectContentScript(tabId);
    await new Promise<void>((r) => setTimeout(r, 200));
    await chrome.tabs.sendMessage(tabId, msg);
    console.log('[webxport] inject + retry succeeded');
  }
}

async function injectContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const entry = manifest.content_scripts?.[0];
  const files = entry?.js;
  if (!files || files.length === 0) {
    throw new Error('content_scripts manifest entry has no js files');
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files,
  });
}
