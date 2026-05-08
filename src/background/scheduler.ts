import { listScripts, getScript } from './storage';
import { runScript } from './runner';

const PREFIX = 'webxport:';

export function initScheduler(): void {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith(PREFIX)) return;
    const id = alarm.name.slice(PREFIX.length);
    const script = await getScript(id);
    if (!script) {
      chrome.alarms.clear(alarm.name);
      return;
    }
    try {
      await runScript(script);
    } catch (e) {
      console.error('[webxport] scheduled run failed:', e);
    }
  });
}

export async function syncAllAlarms(): Promise<void> {
  const all = await chrome.alarms.getAll();
  for (const a of all) {
    if (a.name.startsWith(PREFIX)) chrome.alarms.clear(a.name);
  }
  const scripts = await listScripts();
  for (const s of scripts) {
    if (s.schedule.timeOfDay) await scheduleScript(s.id, s.schedule.timeOfDay);
  }
}

export async function scheduleScript(scriptId: string, timeOfDay: string): Promise<void> {
  const [hh, mm] = timeOfDay.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return;

  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  await chrome.alarms.create(PREFIX + scriptId, {
    when: next.getTime(),
    periodInMinutes: 24 * 60,
  });
}

export async function unscheduleScript(scriptId: string): Promise<void> {
  await chrome.alarms.clear(PREFIX + scriptId);
}
