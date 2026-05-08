import type { Script, RunResult } from '../shared/types';
import type { BackgroundToContent, ContentToBackground, RunState } from '../shared/messages';
import { recordRunResult } from './storage';
import { deliverToTab } from './inject';

interface ActiveSession {
  scriptId: string;
  script: Script;
  tabId: number;
  startedAt: number;
  downloadedFiles: string[];
  lastDoneStepIndex: number;
  drainEndsAt: number | null;
  drainTimer: ReturnType<typeof setTimeout> | null;
  resolve: (r: RunResult) => void;
}

const RUN_TIMEOUT_MS = 5 * 60_000;
const TAB_LOAD_TIMEOUT_MS = 30_000;
// After replay/complete, keep active session alive for trailing async downloads
// (e.g. Xiaohongshu/Taobao back-end "submit task → poll → COS download" pattern).
// Resets every time noteDownload fires so a chain of files all get archived.
const DRAIN_INITIAL_MS = 20_000;
const DRAIN_AFTER_DOWNLOAD_MS = 3_000;

let active: ActiveSession | null = null;
let isRunning = false;

export function getActiveSession(): ActiveSession | null {
  return active;
}

export function getRunState(): RunState {
  if (!active) return { running: false };
  return {
    running: true,
    scriptId: active.scriptId,
    scriptName: active.script.name,
    doneSteps: active.lastDoneStepIndex + 1,
    totalSteps: active.script.steps.length,
    phase: active.drainEndsAt !== null ? 'draining' : 'replay',
    startedAt: active.startedAt,
    downloadedFiles: active.downloadedFiles.length,
  };
}

export async function abortRun(): Promise<void> {
  if (!active) return;
  const tabId = active.tabId;
  console.log('[webxport] abort requested for run on tab', tabId);
  cancelDrain();
  try {
    await deliverToTab(tabId, { type: 'replay/abort' });
  } catch (e) {
    console.log('[webxport] could not notify content of abort:', (e as Error).message);
  }
  finish({
    startedAt: active.startedAt,
    endedAt: Date.now(),
    status: 'aborted',
    error: '用户中止',
    downloadedFiles: [...active.downloadedFiles],
  });
}

export function getActiveReplayForTab(tabId: number): { script: Script; fromIndex: number } | null {
  if (!active || active.tabId !== tabId) return null;
  return {
    script: active.script,
    fromIndex: active.lastDoneStepIndex + 1,
  };
}

export function noteDownload(filename: string): void {
  if (!active) return;
  active.downloadedFiles.push(filename);
  if (active.drainEndsAt !== null) {
    active.drainEndsAt = Date.now() + DRAIN_AFTER_DOWNLOAD_MS;
  }
}

export async function runScript(script: Script): Promise<RunResult> {
  if (isRunning) throw new Error('已有任务在运行，等它结束再来');
  isRunning = true;
  const startedAt = Date.now();
  console.log('[webxport] runScript start:', script.name, 'targetUrl:', script.targetUrl, 'steps:', script.steps.length);

  try {
    const result = await doRun(script, startedAt);
    console.log('[webxport] runScript done:', result.status, result.error ?? '', 'files:', result.downloadedFiles.length);
    await recordRunResult(script.id, result);
    return result;
  } catch (e) {
    const result: RunResult = {
      startedAt,
      endedAt: Date.now(),
      status: 'failed',
      error: (e as Error).message,
      downloadedFiles: active ? [...active.downloadedFiles] : [],
    };
    await recordRunResult(script.id, result);
    return result;
  } finally {
    if (active?.drainTimer !== null && active?.drainTimer !== undefined) {
      clearTimeout(active.drainTimer);
    }
    active = null;
    isRunning = false;
  }
}

async function doRun(script: Script, startedAt: number): Promise<RunResult> {
  const tab = await openOrFocusTab(script.targetUrl);
  if (tab.id === undefined) throw new Error('无法获取 tab id');
  const tabId = tab.id;
  console.log('[webxport] doRun: tab id=', tabId, 'url=', tab.url);

  await waitForTabComplete(tabId);
  console.log('[webxport] doRun: tab complete, sending replay/start');

  return new Promise<RunResult>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[webxport] doRun: 5min timeout fired');
      resolve({
        startedAt,
        endedAt: Date.now(),
        status: 'failed',
        error: `运行超时（${Math.round(RUN_TIMEOUT_MS / 1000)}秒）`,
        downloadedFiles: active ? [...active.downloadedFiles] : [],
      });
    }, RUN_TIMEOUT_MS);

    active = {
      scriptId: script.id,
      script,
      tabId,
      startedAt,
      downloadedFiles: [],
      lastDoneStepIndex: -1,
      drainEndsAt: null,
      drainTimer: null,
      resolve: (r) => {
        clearTimeout(timeout);
        resolve(r);
      },
    };

    const startMsg: BackgroundToContent = { type: 'replay/start', script, fromIndex: 0 };
    deliverToTab(tabId, startMsg).then(
      () => console.log('[webxport] doRun: replay/start delivered'),
      (e) => {
        console.log('[webxport] doRun: replay/start delivery failed:', (e as Error).message);
        clearTimeout(timeout);
        resolve({
          startedAt,
          endedAt: Date.now(),
          status: 'failed',
          error: `无法连接到目标 tab：${(e as Error).message}`,
          downloadedFiles: [],
        });
      }
    );
  });
}

export function handleContentMessage(msg: ContentToBackground): void {
  console.log('[webxport] handleContentMessage:', msg.type, 'active?', !!active);
  if (!active) return;

  if (msg.type === 'replay/step-done') {
    if (msg.index > active.lastDoneStepIndex) {
      active.lastDoneStepIndex = msg.index;
    }
    return;
  }

  if (msg.type === 'replay/complete') {
    if (active.drainEndsAt === null) {
      console.log('[webxport] replay complete, draining for trailing downloads');
      active.drainEndsAt = Date.now() + DRAIN_INITIAL_MS;
      scheduleDrainCheck();
    }
    return;
  }

  if (msg.type === 'replay/step-failed') {
    cancelDrain();
    finish({
      startedAt: active.startedAt,
      endedAt: Date.now(),
      status: 'failed',
      error: msg.error,
      failedAtStep: msg.index,
      downloadedFiles: [...active.downloadedFiles],
    });
    return;
  }
}

function scheduleDrainCheck(): void {
  if (!active || active.drainEndsAt === null) return;
  if (active.drainTimer !== null) clearTimeout(active.drainTimer);
  const remaining = active.drainEndsAt - Date.now();
  if (remaining <= 0) {
    finalizeDrain();
    return;
  }
  active.drainTimer = setTimeout(() => {
    if (!active || active.drainEndsAt === null) return;
    if (Date.now() >= active.drainEndsAt) {
      finalizeDrain();
    } else {
      scheduleDrainCheck();
    }
  }, remaining);
}

function finalizeDrain(): void {
  if (!active) return;
  console.log('[webxport] drain complete, files captured:', active.downloadedFiles.length);
  finish({
    startedAt: active.startedAt,
    endedAt: Date.now(),
    status: 'success',
    downloadedFiles: [...active.downloadedFiles],
  });
}

function cancelDrain(): void {
  if (!active) return;
  if (active.drainTimer !== null) {
    clearTimeout(active.drainTimer);
    active.drainTimer = null;
  }
  active.drainEndsAt = null;
}

function finish(result: RunResult): void {
  if (!active) return;
  cancelDrain();
  active.resolve(result);
}

async function openOrFocusTab(url: string): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ url: matchPattern(url) });
  if (tabs[0]) {
    if (tabs[0].url !== url && tabs[0].id !== undefined) {
      await chrome.tabs.update(tabs[0].id, { url });
    }
    return tabs[0];
  }
  return chrome.tabs.create({ url, active: false });
}

function matchPattern(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}*`;
  } catch {
    return url;
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = TAB_LOAD_TIMEOUT_MS): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        cleanup();
        resolve();
      }
    };
    const onRemoved = (id: number) => {
      if (id === tabId) {
        cleanup();
        reject(new Error('目标 tab 在加载完成前被关闭'));
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`tab 加载超时（${timeoutMs}ms）`));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}
