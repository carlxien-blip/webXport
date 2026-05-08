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
}

export interface InputStep {
  kind: 'input';
  selector: SelectorBundle;
  value: string;
  recordedAt: number;
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
  status: 'success' | 'failed';
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
  lastRun?: RunResult;
}

export interface RecordingDraft {
  scriptId: string;
  name: string;
  targetUrl: string;
  steps: Step[];
  startedAt: number;
}
