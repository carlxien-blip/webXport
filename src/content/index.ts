import { startRecording, stopRecording } from './recorder';
import { replay, isReplayActive } from './replayer';
import type { BackgroundToContent, ContentToBackground, StateQueryReply } from '../shared/messages';

const queryMsg: ContentToBackground = { type: 'state/query' };
chrome.runtime
  .sendMessage(queryMsg)
  .then((reply: StateQueryReply | undefined) => {
    if (!reply) {
      stopRecording();
      return;
    }
    if (reply.recording) startRecording();
    else stopRecording();

    if (reply.replay && !isReplayActive()) {
      kickoffReplay(reply.replay.script, reply.replay.fromIndex);
    }
  })
  .catch(() => {
    stopRecording();
  });

chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
  switch (msg.type) {
    case 'rec/start':
      startRecording();
      sendResponse({ ok: true });
      return false;
    case 'rec/stop':
      stopRecording();
      sendResponse({ ok: true });
      return false;
    case 'replay/start':
      if (!isReplayActive()) {
        kickoffReplay(msg.script, msg.fromIndex);
      }
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
