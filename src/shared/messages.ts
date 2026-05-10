import type { Script, Step } from './types';

export type ContentToBackground =
  | { type: 'rec/step'; step: Step }
  | { type: 'state/query' }
  | { type: 'replay/step-done'; index: number }
  | { type: 'replay/step-failed'; index: number; error: string }
  | { type: 'replay/complete' };

export type BackgroundToContent =
  | { type: 'rec/start'; name: string; stepCount: number }
  | { type: 'rec/stop' }
  | { type: 'replay/start'; script: Script; fromIndex: number }
  | { type: 'replay/abort' };

export type PopupToBackground =
  | { type: 'rec/begin'; tabId: number; name: string }
  | { type: 'rec/end' }
  | { type: 'rec/cancel' }
  | { type: 'rec/state' }
  | { type: 'script/list' }
  | { type: 'script/get'; id: string }
  | { type: 'script/update'; script: Script }
  | { type: 'script/delete'; id: string }
  | { type: 'script/run'; id: string }
  | { type: 'script/abort' }
  | { type: 'script/run-state' }
  | { type: 'license/get' }
  | { type: 'license/apply'; license: string }
  | { type: 'license/clear' };

export type RunPhase = 'replay' | 'draining';

export type RunState =
  | { running: false }
  | {
      running: true;
      scriptId: string;
      scriptName: string;
      doneSteps: number;
      totalSteps: number;
      phase: RunPhase;
      startedAt: number;
      downloadedFiles: number;
    };

export type BackgroundToPopup =
  | { type: 'ok' }
  | { type: 'error'; error: string }
  | { type: 'rec/state-result'; recording: boolean; tabId?: number; stepCount?: number; name?: string }
  | { type: 'script/list-result'; scripts: Script[] }
  | { type: 'script/get-result'; script: Script | null }
  | { type: 'script/run-state-result'; state: RunState }
  | { type: 'license/result'; status: LicenseStatusWire };

/** Wire format of LicenseStatus (background/license.ts owns the impl). */
export type LicenseStatusWire =
  | { kind: 'trial'; daysLeft: number; expiresAt: number }
  | { kind: 'trial-expired'; trialEndedAt: number }
  | { kind: 'paid'; email: string; daysLeft: number; expiresAt: number }
  | { kind: 'paid-expired'; email: string; expiredAt: number };

export interface StateQueryReply {
  recording: false | { name: string; stepCount: number };
  replay?: { script: Script; fromIndex: number };
}

export type AnyMessage =
  | ContentToBackground
  | BackgroundToContent
  | PopupToBackground
  | BackgroundToPopup;
