import type { Script, RunResult } from '../shared/types';
import type { ContentToBackground, RunState } from '../shared/messages';
import { recordRunResult } from './storage';
import { deliverToFrame, resolveFrameId } from './inject';
import { replayApiChain } from './api-replay';

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
  /** 'click' = 传统 content-script 重放; 'api' = chrome.scripting fetch 重放 */
  mode: 'click' | 'api';
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
  const mode = active.mode;
  console.log('[webxport] abort requested for run on tab', tabId, 'mode=', mode);
  cancelDrain();
  try {
    if (mode === 'api') {
      // API 模式：在 isolated world 设置 abort 标志，inTabReplay 的 poll loop 会检测到
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          (window as unknown as { __webxport_api_abort?: boolean }).__webxport_api_abort = true;
        },
      });
    } else {
      // Click 模式：派事件给页面，replayer 监听 __webxport_abort_replay__
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => document.dispatchEvent(new CustomEvent('__webxport_abort_replay__')),
      });
    }
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
  // API 模式不要让 content script 自动接管——它会在跨导航 resume 时点起 click replay
  if (active.mode === 'api') return null;
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
  console.log('[webxport] runScript start:', script.name, 'targetUrl:', script.targetUrl, 'steps:', script.steps.length, 'apiChains:', script.apiChains?.length ?? 0);

  try {
    let result: RunResult | undefined;

    // v0.2: prefer API replay if the script has captured chains. Fall back to click on any non-success.
    if (script.apiChains && script.apiChains.length > 0) {
      try {
        result = await runApiReplay(script, startedAt);
        if (result.status === 'success' && result.downloadedFiles.length > 0) {
          console.log('[webxport] API replay succeeded, files:', result.downloadedFiles.length);
          await recordRunResult(script.id, result);
          return result;
        }
        console.warn('[webxport] API replay produced no usable result:', result.error ?? '(no error msg)', '— falling back to click');
      } catch (e) {
        console.warn('[webxport] API replay threw:', (e as Error).message, '— falling back to click');
      }
      // Reset state for click path
      active = null;
    }

    result = await doRun(script, startedAt);
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

/**
 * v0.2 API replay path. Skips click simulation entirely:
 * - open/focus target tab (so cookies are live)
 * - for each captured ApiChain, run chain in MAIN-world fetch
 * - save returned blob via chrome.downloads.download (downloads.ts archives it)
 */
async function runApiReplay(script: Script, startedAt: number): Promise<RunResult> {
  if (!script.apiChains?.length) throw new Error('runApiReplay called without apiChains');

  const tab = await openOrFocusTab(script.targetUrl);
  if (tab.id === undefined) throw new Error('no tab id');
  const tabId = tab.id;
  console.log('[api-replay] tab=', tabId, 'chains=', script.apiChains.length);
  await waitForTabComplete(tabId);

  // Set up active so downloads.ts archives correctly and getRunState reports it.
  active = {
    scriptId: script.id,
    script,
    tabId,
    startedAt,
    downloadedFiles: [],
    lastDoneStepIndex: -1,
    drainEndsAt: null,
    drainTimer: null,
    resolve: () => {
      // no-op; API replay doesn't use the click-replay completion machinery
    },
    mode: 'api',
  };

  const errors: string[] = [];

  for (let i = 0; i < script.apiChains.length; i++) {
    const chain = script.apiChains[i];
    console.log('[api-replay] chain', i + 1, '/', script.apiChains.length, ':', chain.downloadFilename);

    const result = await replayApiChain(tabId, chain);
    if (!result.ok) {
      console.warn('[api-replay] chain', i + 1, 'failed:', result.error);
      errors.push('chain ' + (i + 1) + ': ' + result.error);
      continue;
    }

    const filename = result.suggestedFilename ?? 'export-' + Date.now() + '.xlsx';
    const dataUrl = 'data:application/octet-stream;base64,' + result.base64;
    try {
      await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify' });
      console.log('[api-replay] chain', i + 1, 'queued download:', filename);
    } catch (e) {
      console.warn('[api-replay] chain', i + 1, 'download failed:', (e as Error).message);
      errors.push('chain ' + (i + 1) + ' save: ' + (e as Error).message);
    }
  }

  // 让 chrome.downloads.onDeterminingFilename → noteDownload 有时间执行
  await new Promise(r => setTimeout(r, 500));

  return {
    startedAt,
    endedAt: Date.now(),
    status: errors.length === 0 ? 'success' : 'failed',
    error: errors.length > 0 ? errors.join('; ') : undefined,
    downloadedFiles: active ? [...active.downloadedFiles] : [],
  };
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
      mode: 'click',
    };

    dispatchReplay(tabId, script, 0).then(
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

/** Dispatch replay/start to the frame whose URL matches the step's recorded frameUrl.
 *  Old steps without frameUrl run in the top frame. */
async function dispatchReplay(tabId: number, script: Script, fromIndex: number): Promise<void> {
  const step = script.steps[fromIndex];
  const frameUrl = step && 'frameUrl' in step ? step.frameUrl : undefined;
  const frameId = await resolveFrameId(tabId, frameUrl);
  if (!active || active.tabId !== tabId) return;
  await deliverToFrame(tabId, frameId, { type: 'replay/start', script, fromIndex });
}

export function handleContentMessage(msg: ContentToBackground): void {
  console.log('[webxport] handleContentMessage:', msg.type, 'active?', !!active, 'mode=', active?.mode);
  if (!active) return;
  // API 模式直接忽略 content script 的事件——免得 click replay 被旁路触发
  if (active.mode === 'api') return;

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

  if (msg.type === 'replay/frame-switch') {
    const fromIndex = msg.index;
    const session = active;
    dispatchReplay(session.tabId, session.script, fromIndex).catch((e) => {
      if (!active) return;
      cancelDrain();
      finish({
        startedAt: active.startedAt,
        endedAt: Date.now(),
        status: 'failed',
        error: `frame 切换失败：${(e as Error).message}`,
        failedAtStep: fromIndex,
        downloadedFiles: [...active.downloadedFiles],
      });
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
  if (tabs[0] && tabs[0].id !== undefined) {
    const tabId = tabs[0].id;
    if (tabs[0].url === url) {
      await reloadAndWait(tabId);
    } else {
      await chrome.tabs.update(tabId, { url });
    }
    return tabs[0];
  }
  return chrome.tabs.create({ url, active: false });
}

/** chrome.tabs.reload() resolves immediately, before the tab actually navigates.
 *  Listen for a full loading→complete cycle so callers know the page is fresh. */
async function reloadAndWait(tabId: number, timeoutMs = TAB_LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    let sawLoading = false;
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id !== tabId) return;
      if (info.status === 'loading') sawLoading = true;
      if (info.status === 'complete' && sawLoading) {
        cleanup();
        resolve();
      }
    };
    const onRemoved = (id: number) => {
      if (id !== tabId) return;
      cleanup();
      reject(new Error('目标 tab 在 reload 过程中被关闭'));
    };
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`reload 等待超时（${timeoutMs}ms）`));
    }, timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.reload(tabId).catch((e) => {
      cleanup();
      reject(e);
    });
  });
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
