import { useEffect, useState } from 'react';
import type { Script, RunResult } from '../shared/types';
import type { RunState, LicenseStatusWire } from '../shared/messages';
import {
  listScripts,
  deleteScript,
  runScript,
  updateScript,
  getRecordingState,
  beginRecording,
  endRecording,
  cancelRecording,
  getActiveTabId,
  abortScript,
  getRunState,
  getLicense,
  applyLicense,
  clearLicense,
  type RecordingState,
} from './api';

type View =
  | { kind: 'home' }
  | { kind: 'detail'; scriptId: string };

export function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [scripts, setScripts] = useState<Script[]>([]);
  const [rec, setRec] = useState<RecordingState>({ recording: false });
  const [run, setRun] = useState<RunState>({ running: false });
  const [license, setLicense] = useState<LicenseStatusWire | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [s, r, rs, lc] = await Promise.all([listScripts(), getRecordingState(), getRunState(), getLicense()]);
      setScripts(s);
      setRec(r);
      setRun(rs);
      setLicense(lc);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-3 flex flex-col gap-3">
      <Header />
      <LicenseBar
        status={license}
        onApply={async (lic) => {
          const next = await applyLicense(lic);
          setLicense(next);
        }}
        onClear={async () => {
          const next = await clearLicense();
          setLicense(next);
        }}
      />
      {error && <ErrorBar message={error} onClose={() => setError(null)} />}

      {run.running && (
        <RunningBanner
          state={run}
          onAbort={async () => {
            try { await abortScript(); await refresh(); }
            catch (e) { setError((e as Error).message); }
          }}
        />
      )}

      {rec.recording && (
        <RecordingBar
          rec={rec}
          onStop={async () => {
            try { await endRecording(); await refresh(); }
            catch (e) { setError((e as Error).message); }
          }}
          onCancel={async () => {
            await cancelRecording();
            await refresh();
          }}
        />
      )}

      {!rec.recording && view.kind === 'home' && (
        <HomeView
          scripts={scripts}
          onStartRecording={async (name) => {
            try {
              const tabId = await getActiveTabId();
              if (tabId == null) throw new Error('找不到当前 tab');
              await beginRecording(tabId, name);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
          onOpen={(id) => setView({ kind: 'detail', scriptId: id })}
        />
      )}

      {view.kind === 'detail' && (
        <DetailView
          scriptId={view.scriptId}
          scripts={scripts}
          onBack={() => setView({ kind: 'home' })}
          onSave={async (s) => {
            try { await updateScript(s); await refresh(); }
            catch (e) { setError((e as Error).message); }
          }}
          onRun={async (id) => {
            try { await runScript(id); }
            catch (e) { setError((e as Error).message); }
          }}
          onDelete={async (id) => {
            try {
              await deleteScript(id);
              setView({ kind: 'home' });
              await refresh();
            } catch (e) { setError((e as Error).message); }
          }}
        />
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <h1 className="text-base font-semibold">webXport</h1>
      <span className="text-xs text-neutral-500">已登录浏览器中的录制重放</span>
    </div>
  );
}

function LicenseBar({
  status,
  onApply,
  onClear,
}: {
  status: LicenseStatusWire | null;
  onApply: (license: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tone = !status ? 'neutral'
    : status.kind === 'paid' ? 'paid'
      : status.kind === 'trial' ? 'trial'
        : 'expired';

  const colorMap = {
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    trial: 'bg-blue-50 text-blue-700 border-blue-200',
    expired: 'bg-red-50 text-red-700 border-red-200',
    neutral: 'bg-neutral-50 text-neutral-600 border-neutral-200',
  };

  return (
    <div className={`border rounded text-xs ${colorMap[tone]}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2 py-1 flex items-center gap-2"
      >
        <span className="flex-1 text-left">{licenseSummary(status)}</span>
        <span className="opacity-60">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-2 border-t border-current/20 pt-2">
          {status?.kind === 'paid' && (
            <div className="text-neutral-700">
              {status.email} · 到期：{new Date(status.expiresAt).toISOString().slice(0, 10)}
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴 license（base64.base64 格式）"
            className="font-mono text-xs border rounded p-1 bg-white text-neutral-800 resize-y"
            rows={2}
          />
          {err && <div className="text-red-600">{err}</div>}
          <div className="flex gap-1">
            <button
              disabled={!input.trim() || busy}
              onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await onApply(input.trim());
                  setInput('');
                  setExpanded(false);
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="flex-1 px-2 py-1 rounded bg-blue-600 text-white disabled:bg-neutral-300"
            >
              {busy ? '校验中…' : '应用 license'}
            </button>
            {status?.kind === 'paid' && (
              <button
                disabled={busy}
                onClick={async () => {
                  await onClear();
                  setExpanded(false);
                }}
                className="px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50"
              >
                清除
              </button>
            )}
          </div>
          {status && (status.kind === 'trial' || status.kind === 'trial-expired' || status.kind === 'paid-expired') && (
            <div className="text-neutral-500">
              试用结束 / 过期后 MCP 接入会停用（录制 / 重放 / 定时不受影响）。¥30 / 月、¥288 / 年。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function licenseSummary(status: LicenseStatusWire | null): string {
  if (!status) return '加载中…';
  switch (status.kind) {
    case 'trial': return `试用中 · 还有 ${status.daysLeft} 天`;
    case 'trial-expired': return '试用已结束 — 点开激活付费';
    case 'paid': return `已激活 · 还有 ${status.daysLeft} 天`;
    case 'paid-expired': return 'license 已过期 — 点开续费';
  }
}

function ErrorBar({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700">
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="text-red-500 hover:text-red-700">×</button>
    </div>
  );
}

function RecordingBar({
  rec,
  onStop,
  onCancel,
}: {
  rec: RecordingState;
  onStop: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded bg-amber-50 border border-amber-300 p-2 flex items-center gap-2 text-sm">
      <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="flex-1">
        正在录制：<b>{rec.name}</b>（{rec.stepCount ?? 0} 步）
      </span>
      <button
        onClick={onStop}
        className="px-2 py-1 rounded bg-emerald-600 text-white text-xs hover:bg-emerald-700"
      >
        完成
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 rounded bg-neutral-200 text-neutral-700 text-xs hover:bg-neutral-300"
      >
        取消
      </button>
    </div>
  );
}

function HomeView({
  scripts,
  onStartRecording,
  onOpen,
}: {
  scripts: Script[];
  onStartRecording: (name: string) => void;
  onOpen: (id: string) => void;
}) {
  const [name, setName] = useState('');

  return (
    <>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新脚本名称（如：千帆笔记）"
          className="flex-1 border rounded px-2 py-1 text-sm"
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            onStartRecording(name.trim());
            setName('');
          }}
          className="px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:bg-neutral-300"
        >
          开始录制
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="text-xs text-neutral-500">已保存脚本（{scripts.length}）</div>
        {scripts.length === 0 && (
          <div className="text-sm text-neutral-400 py-4 text-center">还没有脚本，先去录一个</div>
        )}
        {scripts.map((s) => (
          <ScriptRow key={s.id} script={s} onOpen={() => onOpen(s.id)} />
        ))}
      </div>
    </>
  );
}

function ScriptRow({ script, onOpen }: { script: Script; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="text-left border rounded p-2 hover:bg-neutral-100 flex flex-col gap-1"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{script.name}</span>
        <ScheduleBadge time={script.schedule.timeOfDay} />
      </div>
      <div className="text-xs text-neutral-500 truncate">
        {script.steps.length} 步 · {hostnameOf(script.targetUrl)}
      </div>
      {script.runs[0] && <LastRunBadge run={script.runs[0]} />}
    </button>
  );
}

function ScheduleBadge({ time }: { time: string }) {
  if (!time) return <span className="text-xs text-neutral-400">未定时</span>;
  return <span className="text-xs text-blue-600">每天 {time}</span>;
}

function LastRunBadge({ run }: { run: RunResult }) {
  const color = run.status === 'success' ? 'text-emerald-600' : run.status === 'aborted' ? 'text-amber-600' : 'text-red-600';
  return (
    <div className={`text-xs ${color}`}>
      上次：{describeRun(run)}
    </div>
  );
}

function describeRun(run: RunResult): string {
  if (run.status === 'success') return `成功，${run.downloadedFiles.length} 个文件`;
  if (run.status === 'aborted') return '已中止';
  return `失败 — ${run.error?.slice(0, 40) ?? ''}`;
}

function RunningBanner({ state, onAbort }: { state: Extract<RunState, { running: true }>; onAbort: () => void }) {
  const phase = state.phase === 'draining' ? '等待下载完成' : `第 ${state.doneSteps} / ${state.totalSteps} 步`;
  return (
    <div className="rounded bg-blue-50 border border-blue-200 p-2 flex items-center gap-2 text-sm">
      <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">正在运行：{state.scriptName}</div>
        <div className="text-xs text-neutral-600">
          {phase}
          {state.downloadedFiles > 0 && ` · 已下 ${state.downloadedFiles} 个文件`}
        </div>
      </div>
      <button
        onClick={onAbort}
        className="px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700"
      >
        中止
      </button>
    </div>
  );
}

function DetailView({
  scriptId,
  scripts,
  onBack,
  onSave,
  onRun,
  onDelete,
}: {
  scriptId: string;
  scripts: Script[];
  onBack: () => void;
  onSave: (s: Script) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const script = scripts.find((s) => s.id === scriptId);
  const [time, setTime] = useState(script?.schedule.timeOfDay ?? '');
  const [folder, setFolder] = useState(script?.archive.folderName ?? '');

  useEffect(() => {
    if (script) {
      setTime(script.schedule.timeOfDay);
      setFolder(script.archive.folderName);
    }
  }, [scriptId]);

  if (!script) {
    return (
      <div className="text-sm text-neutral-500">
        脚本不存在 <button onClick={onBack} className="underline">返回</button>
      </div>
    );
  }

  const dirty = time !== script.schedule.timeOfDay || folder !== script.archive.folderName;

  return (
    <>
      <button onClick={onBack} className="text-xs text-neutral-500 hover:text-neutral-700 self-start">
        ← 返回
      </button>

      <div>
        <div className="text-base font-semibold">{script.name}</div>
        <div className="text-xs text-neutral-500 break-all">{script.targetUrl}</div>
      </div>

      <div className="text-sm flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <span className="w-20 text-neutral-500">每天</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
          {time && (
            <button onClick={() => setTime('')} className="text-xs text-neutral-500 hover:underline">
              清除
            </button>
          )}
        </label>

        <label className="flex items-center gap-2">
          <span className="w-20 text-neutral-500">归档</span>
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="子文件夹名"
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
        </label>
        <div className="text-xs text-neutral-400 ml-22">
          下载到 Downloads/webxport/{folder || '(待填)'}/{'{日期}'}/...
        </div>
      </div>

      <div className="flex gap-2">
        <button
          disabled={!dirty}
          onClick={() => onSave({ ...script, schedule: { timeOfDay: time }, archive: { folderName: folder } })}
          className="flex-1 px-3 py-1 rounded bg-blue-600 text-white text-sm disabled:bg-neutral-300"
        >
          保存
        </button>
        <button
          onClick={() => onRun(script.id)}
          className="flex-1 px-3 py-1 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
        >
          立即运行
        </button>
      </div>

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer">步骤详情（{script.steps.length}）</summary>
        <ol className="mt-2 flex flex-col gap-1 list-decimal list-inside">
          {script.steps.map((s, i) => (
            <li key={i}>
              <code className="text-neutral-700">{s.kind}</code>
              {s.kind === 'click' && ` · ${s.selector.textContent ?? s.selector.css.slice(0, 40)}`}
              {s.kind === 'input' && ` · ${s.selector.css.slice(0, 40)} = "${s.value.slice(0, 20)}"`}
            </li>
          ))}
        </ol>
      </details>

      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer">运行历史（{script.runs.length}）</summary>
        {script.runs.length === 0 && (
          <div className="mt-2 text-neutral-400">还没有运行过</div>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          {script.runs.map((r, i) => (
            <RunHistoryRow key={i} run={r} />
          ))}
        </ul>
      </details>

      <button
        onClick={() => {
          if (confirm(`删除脚本「${script.name}」？`)) onDelete(script.id);
        }}
        className="text-xs text-red-600 hover:underline self-start"
      >
        删除脚本
      </button>
    </>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function RunHistoryRow({ run }: { run: RunResult }) {
  const color =
    run.status === 'success' ? 'text-emerald-600'
      : run.status === 'aborted' ? 'text-amber-600'
        : 'text-red-600';
  const when = new Date(run.startedAt);
  const stamp = `${pad2(when.getMonth() + 1)}-${pad2(when.getDate())} ${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
  const dur = Math.round((run.endedAt - run.startedAt) / 1000);
  return (
    <li className="border-l-2 border-neutral-200 pl-2">
      <div className="flex justify-between items-center">
        <span className="font-mono text-neutral-700">{stamp}</span>
        <span className="text-neutral-400">{dur}s</span>
      </div>
      <div className={color}>{describeRun(run)}</div>
    </li>
  );
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
