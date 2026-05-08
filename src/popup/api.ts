import type {
  PopupToBackground,
  BackgroundToPopup,
} from '../shared/messages';
import type { Script } from '../shared/types';

async function send<R extends BackgroundToPopup>(msg: PopupToBackground): Promise<R> {
  const reply = (await chrome.runtime.sendMessage(msg)) as R;
  if (reply.type === 'error') throw new Error(reply.error);
  return reply;
}

export async function listScripts(): Promise<Script[]> {
  const r = await send<Extract<BackgroundToPopup, { type: 'script/list-result' }>>({ type: 'script/list' });
  return r.scripts;
}

export async function updateScript(script: Script): Promise<void> {
  await send({ type: 'script/update', script });
}

export async function deleteScript(id: string): Promise<void> {
  await send({ type: 'script/delete', id });
}

export async function runScript(id: string): Promise<void> {
  await send({ type: 'script/run', id });
}

export interface RecordingState {
  recording: boolean;
  tabId?: number;
  stepCount?: number;
  name?: string;
}

export async function getRecordingState(): Promise<RecordingState> {
  const r = await send<Extract<BackgroundToPopup, { type: 'rec/state-result' }>>({ type: 'rec/state' });
  return { recording: r.recording, tabId: r.tabId, stepCount: r.stepCount, name: r.name };
}

export async function beginRecording(tabId: number, name: string): Promise<void> {
  await send({ type: 'rec/begin', tabId, name });
}

export async function endRecording(): Promise<void> {
  await send({ type: 'rec/end' });
}

export async function cancelRecording(): Promise<void> {
  await send({ type: 'rec/cancel' });
}

export async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}
