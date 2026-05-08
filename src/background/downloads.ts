import { getActiveSession, noteDownload } from './runner';

const ROOT_FOLDER = 'webxport';

export function initDownloads(): void {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const session = getActiveSession();
    if (!session) {
      suggest();
      return;
    }
    const sub = sanitize(session.script.archive.folderName || session.script.name || 'unnamed');
    const date = todayLocal();
    const base = item.filename.split(/[/\\]/).pop() ?? item.filename;
    const filename = `${ROOT_FOLDER}/${sub}/${date}/${base}`;
    suggest({ filename, conflictAction: 'uniquify' });
    noteDownload(filename);
  });
}

function sanitize(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'unnamed';
}

function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
