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

// v0.2: API chain capture/replay types.
// These describe a captured HTTP request from chrome.webRequest during recording,
// and the inferred chain (submit → poll → final) that produces a download.

export interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  /** chrome.webRequest.ResourceType as string, e.g. 'xmlhttprequest' | 'other' */
  type: string;
  /** Date.now() at request start, for ordering and download correlation */
  startedAt: number;
  /** Raw body decoded as UTF-8, when available */
  bodyText?: string;
  /** Form-encoded body, when applicable */
  bodyFormData?: Record<string, string[]>;
  /** Headers; selected ones may be useful at replay time (e.g. Content-Type, X-Csrf-Token) */
  requestHeaders?: Array<{ name: string; value?: string }>;
  responseStatus?: number;
  responseContentType?: string;
  responseContentLength?: number;
}

export interface ApiChain {
  /** chrome.downloads item id at capture time (informational only) */
  downloadId: number;
  downloadFilename: string;
  /** Optional submit POST (multi-step pattern: 千帆 etc.) */
  submit?: CapturedRequest;
  /** Zero or more poll GETs (multi-step pattern) */
  polls: CapturedRequest[];
  /** The request that produced the actual file blob */
  final: CapturedRequest;
  confidence: 'high' | 'medium' | 'low';
  /** Detection reasoning, for debug + popup display */
  reasons: string[];
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
  /** v0.2: API chains captured during recording. Used for API replay (Phase 3+). */
  apiChains?: ApiChain[];
}

export const MAX_RUN_HISTORY = 10;

export interface RecordingDraft {
  scriptId: string;
  name: string;
  targetUrl: string;
  steps: Step[];
  startedAt: number;
}
