import { buildSelectorBundle } from '../shared/selector';
import type { ContentToBackground } from '../shared/messages';
import type { Step } from '../shared/types';

type State = 'unknown' | 'active' | 'inactive';
const BAR_HOST_ID = '__webxport_recording_bar';
const isTopFrame = window.top === window;

let state: State = 'unknown';
let buffer: Step[] = [];
let bar: RecordingBar | null = null;
let stepCount = 0;

const onClick = (e: MouseEvent) => {
  if (state === 'inactive') return;
  const target = e.target as Element | null;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
  if (target.closest(`#${BAR_HOST_ID}`)) return;
  handleStep({
    kind: 'click',
    selector: buildSelectorBundle(target),
    recordedAt: Date.now(),
    frameUrl: location.href,
  });
};

const onChange = (e: Event) => {
  if (state === 'inactive') return;
  const target = e.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }
  if ((target as Element).closest(`#${BAR_HOST_ID}`)) return;
  if (target instanceof HTMLInputElement && (target.type === 'password' || target.type === 'hidden')) {
    return;
  }
  handleStep({
    kind: 'input',
    selector: buildSelectorBundle(target),
    value: target.value,
    recordedAt: Date.now(),
    frameUrl: location.href,
  });
};

function handleStep(step: Step) {
  if (state === 'active') {
    emit(step);
    stepCount++;
    bar?.setStepCount(stepCount);
  } else {
    buffer.push(step);
  }
}

function emit(step: Step) {
  const msg: ContentToBackground = { type: 'rec/step', step };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

document.addEventListener('click', onClick, true);
document.addEventListener('change', onChange, true);

export function startRecording(name: string, initialStepCount: number): void {
  state = 'active';
  stepCount = initialStepCount;
  for (const step of buffer) {
    emit(step);
    stepCount++;
  }
  buffer = [];
  if (isTopFrame) {
    if (!bar) bar = createRecordingBar(name, stepCount);
    else bar.setStepCount(stepCount);
  }
}

export function setBarStepCount(count: number): void {
  if (!isTopFrame || !bar) return;
  stepCount = count;
  bar.setStepCount(count);
}

export function stopRecording(): void {
  state = 'inactive';
  buffer = [];
  stepCount = 0;
  if (bar) {
    bar.remove();
    bar = null;
  }
}

interface RecordingBar {
  setStepCount(n: number): void;
  remove(): void;
}

function createRecordingBar(name: string, initialCount: number): RecordingBar {
  const existing = document.getElementById(BAR_HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = BAR_HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      .bar {
        background: rgba(245, 158, 11, 0.96);
        color: white;
        padding: 10px 14px;
        border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
        font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 10px;
        user-select: none;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        animation: pulse 1.4s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
      }
      .label { display: flex; flex-direction: column; line-height: 1.25; }
      .name { font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .count { font-size: 11px; opacity: 0.9; }
      button {
        background: rgba(255, 255, 255, 0.22);
        border: 0;
        color: white;
        padding: 5px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        transition: background 0.15s;
      }
      button:hover { background: rgba(255, 255, 255, 0.36); }
      button.cancel { background: rgba(0, 0, 0, 0.18); }
      button.cancel:hover { background: rgba(0, 0, 0, 0.32); }
    </style>
    <div class="bar">
      <div class="dot"></div>
      <div class="label">
        <div class="name"></div>
        <div class="count"></div>
      </div>
      <button class="finish">完成</button>
      <button class="cancel">取消</button>
    </div>
  `;

  const nameEl = shadow.querySelector('.name')!;
  nameEl.textContent = name;
  const countEl = shadow.querySelector('.count')!;
  countEl.textContent = `${initialCount} 步`;

  shadow.querySelector('.finish')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'rec/end' }).catch(() => {});
  });
  shadow.querySelector('.cancel')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'rec/cancel' }).catch(() => {});
  });

  document.documentElement.appendChild(host);

  return {
    setStepCount(n: number) {
      countEl.textContent = `${n} 步`;
    },
    remove() {
      host.remove();
    },
  };
}
