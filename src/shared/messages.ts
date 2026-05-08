import type { Script, Step } from './types';

export type ContentToBackground =
  | { type: 'rec/step'; step: Step }
  | { type: 'replay/step-done'; index: number }
  | { type: 'replay/step-failed'; index: number; error: string }
  | { type: 'replay/complete' };

export type BackgroundToContent =
  | { type: 'rec/start' }
  | { type: 'rec/stop' }
  | { type: 'replay/start'; script: Script };

export type PopupToBackground =
  | { type: 'rec/begin'; tabId: number; name: string }
  | { type: 'rec/end' }
  | { type: 'rec/cancel' }
  | { type: 'rec/state' }
  | { type: 'script/list' }
  | { type: 'script/get'; id: string }
  | { type: 'script/update'; script: Script }
  | { type: 'script/delete'; id: string }
  | { type: 'script/run'; id: string };

export type BackgroundToPopup =
  | { type: 'ok' }
  | { type: 'error'; error: string }
  | { type: 'rec/state-result'; recording: boolean; tabId?: number; stepCount?: number; name?: string }
  | { type: 'script/list-result'; scripts: Script[] }
  | { type: 'script/get-result'; script: Script | null };

export type AnyMessage =
  | ContentToBackground
  | BackgroundToContent
  | PopupToBackground
  | BackgroundToPopup;
