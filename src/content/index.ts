import { startRecording, stopRecording, setBarStepCount } from './recorder';
import { replay, isReplayActive, abortReplay } from './replayer';
import { frameMatches } from '../shared/frame';
import type { BackgroundToContent, ContentToBackground, StateQueryReply } from '../shared/messages';

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

refreshState();
document.addEventListener('__webxport_refresh_state__', refreshState);
document.addEventListener('__webxport_abort_replay__', () => abortReplay());

chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
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
});

function kickoffReplay(script: import('../shared/types').Script, fromIndex: number): void {
  replay(script, fromIndex).catch((e) => {
    chrome.runtime
      .sendMessage({ type: 'replay/step-failed', index: fromIndex, error: (e as Error).message })
      .catch(() => {});
  });
}
