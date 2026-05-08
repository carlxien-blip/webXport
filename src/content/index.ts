import { startRecording, stopRecording } from './recorder';
import { replay, isReplayActive, abortReplay } from './replayer';
import type { BackgroundToContent, ContentToBackground, StateQueryReply } from '../shared/messages';

const queryMsg: ContentToBackground = { type: 'state/query' };
chrome.runtime
  .sendMessage(queryMsg)
  .then((reply: StateQueryReply | undefined) => {
    console.log('[webxport content] state/query reply:', reply);
    if (!reply) {
      stopRecording();
      return;
    }
    if (reply.recording) startRecording(reply.recording.name, reply.recording.stepCount);
    else stopRecording();

    if (reply.replay && !isReplayActive()) {
      kickoffReplay(reply.replay.script, reply.replay.fromIndex);
    }
  })
  .catch((e) => {
    console.log('[webxport content] state/query failed:', (e as Error).message);
    stopRecording();
  });

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
