import { findElement, extractText } from '../shared/selector';
import { checkSafety } from '../shared/safety';
import type { ContentToBackground } from '../shared/messages';
import type { Script, Step, ClickStep, InputStep, WaitStep } from '../shared/types';

const STEP_TIMEOUT_MS = 15_000;
const ACTION_GAP_MS = 400;

let isActive = false;

export function isReplayActive(): boolean {
  return isActive;
}

export async function replay(script: Script, fromIndex: number): Promise<void> {
  if (isActive) return;
  isActive = true;
  console.log('[webxport] replay start:', script.name, 'fromIndex:', fromIndex, 'totalSteps:', script.steps.length);
  try {
    for (let i = fromIndex; i < script.steps.length; i++) {
      const step = script.steps[i];
      console.log('[webxport] step', i, step.kind, 'css:', 'selector' in step ? step.selector.css.slice(0, 60) : '-');
      try {
        await runStep(step);
        console.log('[webxport] step', i, 'done');
        reportDone(i);
      } catch (e) {
        console.log('[webxport] step', i, 'failed:', (e as Error).message);
        reportFailed(i, (e as Error).message);
        return;
      }
      await sleep(ACTION_GAP_MS);
    }
    console.log('[webxport] replay complete');
    reportComplete();
  } finally {
    isActive = false;
  }
}

async function runStep(step: Step): Promise<void> {
  switch (step.kind) {
    case 'click':
      return runClick(step);
    case 'input':
      return runInput(step);
    case 'wait':
      return runWait(step);
  }
}

async function runClick(step: ClickStep): Promise<void> {
  const el = await waitForElement(step.selector, STEP_TIMEOUT_MS);
  const safety = checkSafety(extractText(el));
  if (!safety.safe) {
    throw new Error(`安全守护拒绝点击：元素文本含「${safety.matched}」`);
  }
  (el as HTMLElement).click();
}

async function runInput(step: InputStep): Promise<void> {
  const el = await waitForElement(step.selector, STEP_TIMEOUT_MS);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    throw new Error('目标元素不是输入控件');
  }
  el.focus();
  el.value = step.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function runWait(step: WaitStep): Promise<void> {
  if (step.reason === 'mutation-quiet') {
    await waitForMutationQuiet(step.timeoutMs);
  } else {
    await sleep(Math.min(step.timeoutMs, 5000));
  }
}

async function waitForElement(selector: import('../shared/types').SelectorBundle, timeoutMs: number): Promise<Element> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = findElement(selector);
    if (el && isInteractable(el)) return el;
    await sleep(150);
  }
  throw new Error(`超时未找到元素（${timeoutMs}ms）：${selector.css.slice(0, 80)}`);
}

function isInteractable(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el as HTMLElement);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

async function waitForMutationQuiet(timeoutMs: number, quietMs = 500): Promise<void> {
  return new Promise((resolve) => {
    let timer: number | null = null;
    const arm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, quietMs);
    };
    const observer = new MutationObserver(arm);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    arm();
    window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, timeoutMs);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function reportDone(index: number) {
  send({ type: 'replay/step-done', index });
}

function reportFailed(index: number, error: string) {
  send({ type: 'replay/step-failed', index, error });
}

function reportComplete() {
  send({ type: 'replay/complete' });
}

function send(msg: ContentToBackground) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
