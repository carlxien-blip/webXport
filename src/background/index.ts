import type {
  ContentToBackground,
  PopupToBackground,
  BackgroundToPopup,
  BackgroundToContent,
} from '../shared/messages';
import type { RecordingDraft, Script } from '../shared/types';
import {
  listScripts,
  getScript,
  upsertScript,
  deleteScript,
} from './storage';
import { runScript, handleContentMessage } from './runner';
import { initScheduler, syncAllAlarms, scheduleScript, unscheduleScript } from './scheduler';
import { initDownloads } from './downloads';

const DRAFT_KEY = 'webxport.draft';

initScheduler();
initDownloads();
chrome.runtime.onInstalled.addListener(() => {
  void syncAllAlarms();
});
chrome.runtime.onStartup.addListener(() => {
  void syncAllAlarms();
});

chrome.runtime.onMessage.addListener((msg: PopupToBackground | ContentToBackground, sender, sendResponse) => {
  if ('type' in msg && msg.type.startsWith('replay/')) {
    handleContentMessage(msg as ContentToBackground);
    sendResponse({ type: 'ok' } satisfies BackgroundToPopup);
    return false;
  }

  if (msg.type === 'rec/step') {
    queueAppendStep((msg as Extract<ContentToBackground, { type: 'rec/step' }>).step);
    sendResponse({ type: 'ok' } satisfies BackgroundToPopup);
    return false;
  }

  handlePopupMessage(msg as PopupToBackground, sender)
    .then((reply) => sendResponse(reply))
    .catch((e) => sendResponse({ type: 'error', error: (e as Error).message } satisfies BackgroundToPopup));
  return true;
});

let appendChain: Promise<void> = Promise.resolve();
function queueAppendStep(step: import('../shared/types').Step): void {
  appendChain = appendChain
    .then(() => appendStepToDraft(step))
    .catch((e) => console.error('[webxport] append step failed:', e));
}

async function handlePopupMessage(msg: PopupToBackground, _sender: chrome.runtime.MessageSender): Promise<BackgroundToPopup> {
  switch (msg.type) {
    case 'rec/begin':
      return beginRecording(msg.tabId, msg.name);
    case 'rec/end':
      return endRecording();
    case 'rec/cancel':
      return cancelRecording();
    case 'rec/state':
      return readRecordingState();
    case 'script/list':
      return { type: 'script/list-result', scripts: await listScripts() };
    case 'script/get':
      return { type: 'script/get-result', script: await getScript(msg.id) };
    case 'script/update':
      await upsertScript(msg.script);
      if (msg.script.schedule.timeOfDay) {
        await scheduleScript(msg.script.id, msg.script.schedule.timeOfDay);
      } else {
        await unscheduleScript(msg.script.id);
      }
      return { type: 'ok' };
    case 'script/delete':
      await unscheduleScript(msg.id);
      await deleteScript(msg.id);
      return { type: 'ok' };
    case 'script/run': {
      const s = await getScript(msg.id);
      if (!s) return { type: 'error', error: '脚本不存在' };
      runScript(s).catch((e) => console.error('[webxport] run failed:', e));
      return { type: 'ok' };
    }
  }
}

async function beginRecording(tabId: number, name: string): Promise<BackgroundToPopup> {
  const existing = await readDraft();
  if (existing) return { type: 'error', error: '已有录制进行中' };

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return { type: 'error', error: '不能在 chrome:// 页面录制' };
  }

  const draft: RecordingDraft = {
    scriptId: cryptoRandomId(),
    name,
    targetUrl: url,
    steps: [],
    startedAt: Date.now(),
  };
  await writeDraft(draft, tabId);

  const startMsg: BackgroundToContent = { type: 'rec/start' };
  try {
    await chrome.tabs.sendMessage(tabId, startMsg);
  } catch {
    await clearDraft();
    return { type: 'error', error: '无法连接到目标 tab，请刷新页面后重试' };
  }
  return { type: 'ok' };
}

async function endRecording(): Promise<BackgroundToPopup> {
  const session = await readDraftSession();
  if (!session) return { type: 'error', error: '当前没有录制' };

  try {
    await chrome.tabs.sendMessage(session.tabId, { type: 'rec/stop' } satisfies BackgroundToContent);
  } catch {
    // tab may have been closed; that's fine, we still save what we have
  }

  if (session.draft.steps.length === 0) {
    await clearDraft();
    return { type: 'error', error: '没有录到任何动作，已丢弃' };
  }

  const script: Script = {
    id: session.draft.scriptId,
    name: session.draft.name,
    targetUrl: session.draft.targetUrl,
    steps: session.draft.steps,
    archive: { folderName: session.draft.name },
    schedule: { timeOfDay: '' },
    createdAt: session.draft.startedAt,
    updatedAt: Date.now(),
  };
  await upsertScript(script);
  await clearDraft();
  return { type: 'ok' };
}

async function cancelRecording(): Promise<BackgroundToPopup> {
  const session = await readDraftSession();
  if (!session) return { type: 'ok' };
  try {
    await chrome.tabs.sendMessage(session.tabId, { type: 'rec/stop' } satisfies BackgroundToContent);
  } catch {}
  await clearDraft();
  return { type: 'ok' };
}

async function readRecordingState(): Promise<BackgroundToPopup> {
  const session = await readDraftSession();
  if (!session) return { type: 'rec/state-result', recording: false };
  return {
    type: 'rec/state-result',
    recording: true,
    tabId: session.tabId,
    stepCount: session.draft.steps.length,
    name: session.draft.name,
  };
}

async function appendStepToDraft(step: import('../shared/types').Step): Promise<void> {
  const session = await readDraftSession();
  if (!session) return;
  session.draft.steps.push(step);
  await writeDraft(session.draft, session.tabId);
}

interface DraftSession {
  draft: RecordingDraft;
  tabId: number;
}

async function readDraft(): Promise<RecordingDraft | null> {
  const session = await readDraftSession();
  return session?.draft ?? null;
}

async function readDraftSession(): Promise<DraftSession | null> {
  const out = await chrome.storage.session.get(DRAFT_KEY);
  return (out[DRAFT_KEY] as DraftSession | undefined) ?? null;
}

async function writeDraft(draft: RecordingDraft, tabId: number): Promise<void> {
  await chrome.storage.session.set({ [DRAFT_KEY]: { draft, tabId } satisfies DraftSession });
}

async function clearDraft(): Promise<void> {
  await chrome.storage.session.remove(DRAFT_KEY);
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}
