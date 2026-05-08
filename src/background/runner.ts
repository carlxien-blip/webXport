import type { Script, RunResult } from '../shared/types';
import type { BackgroundToContent, ContentToBackground } from '../shared/messages';
import { recordRunResult } from './storage';

interface ActiveSession {
  scriptId: string;
  script: Script;
  tabId: number;
  startedAt: number;
  downloadedFiles: string[];
  lastDoneStepIndex: number;
  resolve: (r: RunResult) => void;
}

const RUN_TIMEOUT_MS = 5 * 60_000;
const TAB_LOAD_TIMEOUT_MS = 30_000;

let active: ActiveSession | null = null;
let isRunning = false;

export function getActiveSession(): ActiveSession | null {
  return active;
}

export function getActiveReplayForTab(tabId: number): { script: Script; fromIndex: number } | null {
  if (!active || active.tabId !== tabId) return null;
  return {
    script: active.script,
    fromIndex: active.lastDoneStepIndex + 1,
  };
}

export function noteDownload(filename: string): void {
  if (active) active.downloadedFiles.push(filename);
}

export async function runScript(script: Script): Promise<RunResult> {
  if (isRunning) throw new Error('已有任务在运行，等它结束再来');
  isRunning = true;
  const startedAt = Date.now();

  try {
    const result = await doRun(script, startedAt);
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
    active = null;
    isRunning = false;
  }
}

async function doRun(script: Script, startedAt: number): Promise<RunResult> {
  const tab = await openOrFocusTab(script.targetUrl);
  if (tab.id === undefined) throw new Error('无法获取 tab id');
  const tabId = tab.id;

  await waitForTabComplete(tabId);

  return new Promise<RunResult>((resolve) => {
    const timeout = setTimeout(() => {
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
      resolve: (r) => {
        clearTimeout(timeout);
        resolve(r);
      },
    };

    const startMsg: BackgroundToContent = { type: 'replay/start', script, fromIndex: 0 };
    chrome.tabs.sendMessage(tabId, startMsg).catch((e) => {
      clearTimeout(timeout);
      resolve({
        startedAt,
        endedAt: Date.now(),
        status: 'failed',
        error: `无法连接到目标 tab：${(e as Error).message}`,
        downloadedFiles: [],
      });
    });
  });
}

export function handleContentMessage(msg: ContentToBackground): void {
  if (!active) return;

  if (msg.type === 'replay/step-done') {
    if (msg.index > active.lastDoneStepIndex) {
      active.lastDoneStepIndex = msg.index;
    }
    return;
  }

  if (msg.type === 'replay/complete') {
    finish({
      startedAt: active.startedAt,
      endedAt: Date.now(),
      status: 'success',
      downloadedFiles: [...active.downloadedFiles],
    });
    return;
  }

  if (msg.type === 'replay/step-failed') {
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

function finish(result: RunResult): void {
  if (!active) return;
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
