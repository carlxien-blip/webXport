import type { Script, RunResult } from '../shared/types';

const KEY = 'webxport.scripts.v1';

interface Stored {
  scripts: Script[];
}

async function readAll(): Promise<Stored> {
  const out = await chrome.storage.local.get(KEY);
  return (out[KEY] as Stored | undefined) ?? { scripts: [] };
}

async function writeAll(data: Stored): Promise<void> {
  await chrome.storage.local.set({ [KEY]: data });
}

export async function listScripts(): Promise<Script[]> {
  const { scripts } = await readAll();
  return scripts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getScript(id: string): Promise<Script | null> {
  const { scripts } = await readAll();
  return scripts.find((s) => s.id === id) ?? null;
}

export async function upsertScript(script: Script): Promise<void> {
  const data = await readAll();
  const idx = data.scripts.findIndex((s) => s.id === script.id);
  const next = { ...script, updatedAt: Date.now() };
  if (idx >= 0) data.scripts[idx] = next;
  else data.scripts.push(next);
  await writeAll(data);
}

export async function deleteScript(id: string): Promise<void> {
  const data = await readAll();
  data.scripts = data.scripts.filter((s) => s.id !== id);
  await writeAll(data);
}

export async function recordRunResult(scriptId: string, result: RunResult): Promise<void> {
  const data = await readAll();
  const s = data.scripts.find((s) => s.id === scriptId);
  if (!s) return;
  s.lastRun = result;
  s.updatedAt = Date.now();
  await writeAll(data);
}
