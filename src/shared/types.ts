export interface SelectorBundle {
  css: string;
  xpath: string;
  textContent: string | null;
  tagName: string;
  attributes: Record<string, string>;
}

export type Step =
  | ClickStep
  | InputStep
  | WaitStep;

export interface ClickStep {
  kind: 'click';
  selector: SelectorBundle;
  recordedAt: number;
  /** URL of the frame where this step was recorded. Absent on pre-frame-aware scripts. */
  frameUrl?: string;
}

export interface InputStep {
  kind: 'input';
  selector: SelectorBundle;
  value: string;
  recordedAt: number;
  frameUrl?: string;
}

export interface WaitStep {
  kind: 'wait';
  reason: 'mutation-quiet' | 'network-idle';
  timeoutMs: number;
}

export interface ArchiveConfig {
  /** Subfolder name under `Downloads/webxport/`. Date will be appended automatically. */
  folderName: string;
}

export interface ScheduleConfig {
  /** "HH:mm" 24h, local time. Empty string = no schedule. */
  timeOfDay: string;
}

export interface RunResult {
  startedAt: number;
  endedAt: number;
  status: 'success' | 'failed' | 'aborted';
  error?: string;
  failedAtStep?: number;
  downloadedFiles: string[];
}

export interface Script {
  id: string;
  name: string;
  targetUrl: string;
  steps: Step[];
  archive: ArchiveConfig;
  schedule: ScheduleConfig;
  createdAt: number;
  updatedAt: number;
  /** Most recent first, capped at MAX_RUN_HISTORY in storage. */
  runs: RunResult[];
}

export const MAX_RUN_HISTORY = 10;

export interface RecordingDraft {
  scriptId: string;
  name: string;
  targetUrl: string;
  steps: Step[];
  startedAt: number;
}
