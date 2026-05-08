import { startRecording, stopRecording } from './recorder';
import { replay } from './replayer';
import type { BackgroundToContent, ContentToBackground, RecCheckReply } from '../shared/messages';

const checkMsg: ContentToBackground = { type: 'rec/check' };
chrome.runtime
  .sendMessage(checkMsg)
  .then((reply: RecCheckReply | undefined) => {
    if (reply?.active) startRecording();
    else stopRecording();
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
      replay(msg.script).catch((e) => {
        chrome.runtime
          .sendMessage({ type: 'replay/step-failed', index: -1, error: (e as Error).message })
          .catch(() => {});
      });
      sendResponse({ ok: true });
      return false;
  }
});
