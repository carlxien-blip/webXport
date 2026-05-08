import { buildSelectorBundle } from '../shared/selector';
import type { ContentToBackground } from '../shared/messages';
import type { Step } from '../shared/types';

type State = 'unknown' | 'active' | 'inactive';
let state: State = 'unknown';
let buffer: Step[] = [];

const onClick = (e: MouseEvent) => {
  if (state === 'inactive') return;
  const target = e.target as Element | null;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
  handleStep({
    kind: 'click',
    selector: buildSelectorBundle(target),
    recordedAt: Date.now(),
  });
};

const onChange = (e: Event) => {
  if (state === 'inactive') return;
  const target = e.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
    return;
  }
  if (target instanceof HTMLInputElement && (target.type === 'password' || target.type === 'hidden')) {
    return;
  }
  handleStep({
    kind: 'input',
    selector: buildSelectorBundle(target),
    value: target.value,
    recordedAt: Date.now(),
  });
};

function handleStep(step: Step) {
  if (state === 'active') {
    emit(step);
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

export function startRecording() {
  state = 'active';
  for (const step of buffer) emit(step);
  buffer = [];
}

export function stopRecording() {
  state = 'inactive';
  buffer = [];
}
