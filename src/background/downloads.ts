import { getActiveSession, noteDownload } from './runner';

const ROOT_FOLDER = 'webxport';

export function initDownloads(): void {
  chrome.downloads.onCreated.addListener((item) => {
    console.log('[webxport] download created:', item.id, 'url:', item.url?.slice(0, 80), 'filename:', item.filename, 'state:', item.state);
  });

  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    console.log('[webxport] determining filename for:', item.id, 'original:', item.filename);
    const session = getActiveSession();
    if (!session) {
      console.log('[webxport] no active session, letting Chrome use default filename');
      suggest();
      return;
    }
    const sub = sanitize(session.script.archive.folderName || session.script.name || 'unnamed');
    const date = todayLocal();
    const origBase = item.filename.split(/[/\\]/).pop() ?? item.filename;
    const ext = extractExt(origBase);
    const seq = session.downloadedFiles.length;
    const suffix = seq > 0 ? `_${seq + 1}` : '';
    const newBase = `${sub}_${date}${suffix}${ext}`;
    const filename = `${ROOT_FOLDER}/${sub}/${date}/${newBase}`;
    console.log('[webxport] redirecting download to:', filename);
    suggest({ filename, conflictAction: 'uniquify' });
    noteDownload(filename);
  });
}

function extractExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
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
