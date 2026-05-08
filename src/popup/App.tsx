import { useEffect, useState } from 'react';
import type { Script } from '../shared/types';
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
  type RecordingState,
} from './api';

type View =
  | { kind: 'home' }
  | { kind: 'detail'; scriptId: string };

export function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [scripts, setScripts] = useState<Script[]>([]);
  const [rec, setRec] = useState<RecordingState>({ recording: false });
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setScripts(await listScripts());
      setRec(await getRecordingState());
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
      {error && <ErrorBar message={error} onClose={() => setError(null)} />}

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
      {script.lastRun && <LastRunBadge run={script.lastRun} />}
    </button>
  );
}

function ScheduleBadge({ time }: { time: string }) {
  if (!time) return <span className="text-xs text-neutral-400">未定时</span>;
  return <span className="text-xs text-blue-600">每天 {time}</span>;
}

function LastRunBadge({ run }: { run: import('../shared/types').RunResult }) {
  const ok = run.status === 'success';
  return (
    <div className={`text-xs ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
      上次：{ok ? `成功，${run.downloadedFiles.length} 个文件` : `失败 — ${run.error?.slice(0, 40)}`}
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
