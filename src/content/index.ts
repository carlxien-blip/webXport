import { startRecording, stopRecording, setBarStepCount } from './recorder';
import { replay, isReplayActive, abortReplay } from './replayer';
import { frameMatches } from '../shared/frame';
import type { BackgroundToContent, ContentToBackground, StateQueryReply } from '../shared/messages';

declare global {
  interface Window {
    __webxport_content_initialized__?: boolean;
  }
}

function refreshState(): void {
  const queryMsg: ContentToBackground = { type: 'state/query' };
  chrome.runtime
    .sendMessage(queryMsg)
    .then((reply: StateQueryReply | undefined) => {
      if (!reply) {
        stopRecording();
        return;
      }
      if (reply.recording) startRecording(reply.recording.name, reply.recording.stepCount);
      else stopRecording();

      if (reply.replay && !isReplayActive()) {
        const step = reply.replay.script.steps[reply.replay.fromIndex];
        const stepFrameUrl = step && 'frameUrl' in step ? step.frameUrl : undefined;
        if (frameMatches(stepFrameUrl, location.href)) {
          kickoffReplay(reply.replay.script, reply.replay.fromIndex);
        }
      }
    })
    .catch((e) => {
      console.log('[webxport content] state/query failed:', (e as Error).message);
      stopRecording();
    });
}

function kickoffReplay(script: import('../shared/types').Script, fromIndex: number): void {
  replay(script, fromIndex).catch((e) => {
    chrome.runtime
      .sendMessage({ type: 'replay/step-failed', index: fromIndex, error: (e as Error).message })
      .catch(() => {});
  });
}

function handleBackgroundMessage(
  msg: BackgroundToContent,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: { ok: boolean }) => void,
): boolean {
  switch (msg.type) {
    case 'rec/start':
      startRecording(msg.name, msg.stepCount);
      sendResponse({ ok: true });
      return false;
    case 'rec/stop':
      stopRecording();
      sendResponse({ ok: true });
      return false;
    case 'rec/step-count':
      setBarStepCount(msg.count);
      sendResponse({ ok: true });
      return false;
    case 'replay/start':
      console.log('[webxport content] received replay/start, fromIndex:', msg.fromIndex);
      if (!isReplayActive()) {
        kickoffReplay(msg.script, msg.fromIndex);
      } else {
        console.log('[webxport content] replay already active, ignoring');
      }
      sendResponse({ ok: true });
      return false;
    case 'replay/abort':
      abortReplay();
      sendResponse({ ok: true });
      return false;
  }
  return false;
}

// Module can re-execute when chrome.scripting.executeScript injects content_scripts
// as a fallback for unreliable manifest auto-injection (e.g. heavy SPAs). Guard
// top-level side effects so listeners and onMessage handlers don't accumulate.
if (!window.__webxport_content_initialized__) {
  window.__webxport_content_initialized__ = true;
  document.addEventListener('__webxport_refresh_state__', refreshState);
  document.addEventListener('__webxport_abort_replay__', () => abortReplay());
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}
refreshState();
