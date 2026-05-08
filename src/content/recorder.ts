import { buildSelectorBundle } from '../shared/selector';
import type { ContentToBackground } from '../shared/messages';
import type { Step } from '../shared/types';

let active = false;

const onClick = (e: MouseEvent) => {
  if (!active) return;
  const target = e.target as Element | null;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
  emit({
    kind: 'click',
    selector: buildSelectorBundle(target),
    recordedAt: Date.now(),
  });
};

const onChange = (e: Event) => {
  if (!active) return;
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!target) return;
  if (!('value' in target)) return;
  if (target instanceof HTMLInputElement && (target.type === 'password' || target.type === 'hidden')) {
    return;
  }
  emit({
    kind: 'input',
    selector: buildSelectorBundle(target),
    value: target.value,
    recordedAt: Date.now(),
  });
};

function emit(step: Step) {
  const msg: ContentToBackground = { type: 'rec/step', step };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

export function startRecording() {
  if (active) return;
  active = true;
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
}

export function stopRecording() {
  active = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('change', onChange, true);
}

export function isRecording() {
  return active;
}
