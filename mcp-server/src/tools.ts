import { homedir } from 'node:os';
import { join } from 'node:path';
import { bridge } from './ws-bridge.js';

const DOWNLOADS_DIR = join(homedir(), 'Downloads');

export const TOOLS = [
  {
    name: 'list_scripts',
    description:
      'List all webxport scripts the user has recorded. Each script entry includes name, targetUrl, schedule (HH:mm or empty), archive folder, step count, and the latest run summary if any.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'run_script',
    description:
      'Run a recorded webxport script by name. By default waits for the run to fully complete (including the trailing-download drain phase) and returns absolute file paths of any downloaded files. Set waitForResult=false to fire-and-forget; in that case poll get_run_status to track progress.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Script name as returned by list_scripts (exact match).' },
        waitForResult: {
          type: 'boolean',
          description: 'Default true. If true, this call blocks until the run finishes.',
          default: true,
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_runs',
    description:
      'Return the recent run history (up to 10 runs, newest first) for a single script (if name is given) or all scripts (if name omitted). Each run has startedAt, endedAt, status (success | failed | aborted), error message if failed, and absolute file paths.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Optional script name. If omitted, returns history for every script.' },
      },
      required: [],
    },
  },
  {
    name: 'get_run_status',
    description:
      'Returns whether a script is currently running. If yes, returns scriptName, current step / total steps, phase (replay or draining), startedAt timestamp, and number of files captured so far.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

interface RawScript {
  id: string;
  name: string;
  targetUrl: string;
  steps: { kind: string }[];
  archive: { folderName: string };
  schedule: { timeOfDay: string };
  createdAt: number;
  updatedAt: number;
  runs: RawRun[];
}

interface RawRun {
  startedAt: number;
  endedAt: number;
  status: 'success' | 'failed' | 'aborted';
  error?: string;
  failedAtStep?: number;
  downloadedFiles: string[];
}

function absolutize(relativePath: string): string {
  return join(DOWNLOADS_DIR, relativePath);
}

function summarizeRun(run: RawRun) {
  return {
    startedAt: new Date(run.startedAt).toISOString(),
    endedAt: new Date(run.endedAt).toISOString(),
    durationSeconds: Math.round((run.endedAt - run.startedAt) / 1000),
    status: run.status,
    error: run.error,
    failedAtStep: run.failedAtStep,
    files: run.downloadedFiles.map(absolutize),
  };
}

function summarizeScript(s: RawScript) {
  return {
    name: s.name,
    targetUrl: s.targetUrl,
    stepCount: s.steps.length,
    schedule: s.schedule.timeOfDay || null,
    archiveFolder: `~/Downloads/webxport/${s.archive.folderName}/`,
    latestRun: s.runs[0] ? summarizeRun(s.runs[0]) : null,
  };
}

export async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_scripts': {
      const scripts = (await bridge.call('list_scripts', {})) as RawScript[];
      return scripts.map(summarizeScript);
    }
    case 'run_script': {
      const scriptName = args.name as string;
      const wait = (args.waitForResult as boolean | undefined) ?? true;
      const timeoutMs = wait ? 5 * 60_000 + 30_000 : 5_000;
      const result = (await bridge.call(
        'run_script',
        { name: scriptName, waitForResult: wait },
        timeoutMs
      )) as { status: string; error?: string; failedAtStep?: number; downloadedFiles?: string[] } | { started: true };

      if ('started' in result) return { started: true };

      return {
        status: result.status,
        error: result.error,
        failedAtStep: result.failedAtStep,
        files: (result.downloadedFiles ?? []).map(absolutize),
      };
    }
    case 'get_runs': {
      const scriptName = args.name as string | undefined;
      const data = (await bridge.call('get_runs', { name: scriptName })) as
        | { name: string; runs: RawRun[] }[]
        | { runs: RawRun[] };
      if (Array.isArray(data)) {
        return data.map((entry) => ({
          name: entry.name,
          runs: entry.runs.map(summarizeRun),
        }));
      }
      return data.runs.map(summarizeRun);
    }
    case 'get_run_status': {
      return await bridge.call('get_run_status', {});
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
