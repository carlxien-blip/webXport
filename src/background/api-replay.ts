// v0.2 Phase 3 — API 重放路径
//
// 不模拟点击，直接 chrome.scripting.executeScript({ world: 'MAIN' }) 在 tab 内执行 fetch，
// 用浏览器现成 session cookie 调用平台导出 API，blob → base64 → 传回 background → 落盘。
//
// 支持两种链路：
//   - 单步：直接 fetch chain.final.url
//   - 多步（千帆模式）：submit → poll(task_id) → 提取 CDN URL → fetch
//
// 失败语义：返回 { ok: false, error } 让 runner 决定是否 fallback 到 click。

import type { ApiChain } from '../shared/types';

export interface ApiReplayResult {
  ok: boolean;
  /** base64 编码的文件内容（成功时） */
  base64?: string;
  /** 用于推断 chrome.downloads filename 的提示（成功时） */
  suggestedFilename?: string;
  error?: string;
}

/**
 * 在指定 tab 内执行一条 API 链路重放。
 * tab 必须已经 navigate 到目标平台并加载完成。
 */
export async function replayApiChain(tabId: number, chain: ApiChain): Promise<ApiReplayResult> {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: inTabReplay,
      args: [chain],
    });

    if (!result) return { ok: false, error: 'executeScript returned no result' };
    if ('error' in result && result.error) return { ok: false, error: result.error };
    if (!('base64' in result) || !result.base64) return { ok: false, error: 'no base64 in result' };

    return {
      ok: true,
      base64: result.base64,
      suggestedFilename: chain.downloadFilename || 'export.xlsx',
    };
  } catch (e) {
    return { ok: false, error: 'executeScript threw: ' + (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────
// 在 tab MAIN world 跑的函数。注意：
//  - 不能引用外部闭包变量
//  - 不能使用 TS 类型（运行时是 JS）
//  - args 通过 JSON 传过来
//  - 返回值结构必须是 plain object（被 JSON 序列化回来）
// ─────────────────────────────────────────────────────────────────────

function inTabReplay(chain: ApiChain): Promise<{ base64?: string; error?: string }> {
  return (async () => {
    try {
      async function blobToB64(blob: Blob): Promise<string> {
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.slice(i, i + chunk)));
        }
        return btoa(binary);
      }

      function buildHeaders(req: { requestHeaders?: Array<{ name: string; value?: string }> }, fallback?: Record<string, string>): Record<string, string> {
        // 只挑可能影响重放的 header：Content-Type, X-* 自定义头
        // fetch 会自动处理 Cookie / Origin / Referer / User-Agent
        const out: Record<string, string> = { ...(fallback ?? {}) };
        if (!req.requestHeaders) return out;
        for (const h of req.requestHeaders) {
          const name = h.name.toLowerCase();
          if (name === 'content-type' || name.startsWith('x-')) {
            if (h.value) out[h.name] = h.value;
          }
        }
        return out;
      }

      // ── 单步：直接 fetch final ──
      if (!chain.submit && chain.polls.length === 0) {
        const final = chain.final;
        const resp = await fetch(final.url, {
          method: final.method,
          credentials: 'include',
          headers: buildHeaders(final),
        });
        if (!resp.ok) return { error: 'final ' + final.method + ' HTTP ' + resp.status };
        const blob = await resp.blob();
        if (blob.size === 0) return { error: 'final returned empty blob' };
        return { base64: await blobToB64(blob) };
      }

      // ── 多步：submit → poll → final ──
      if (!chain.submit) return { error: 'multi-step chain missing submit' };
      if (chain.polls.length === 0) return { error: 'multi-step chain missing poll URL template' };

      // 1. submit
      const submitInit: RequestInit = {
        method: chain.submit.method,
        credentials: 'include',
      };
      const headers = buildHeaders(chain.submit);
      if (chain.submit.bodyText) {
        // 如果没显式 Content-Type，根据 body 形态推测
        if (!headers['Content-Type'] && !headers['content-type']) {
          const trimmed = chain.submit.bodyText.trim();
          headers['Content-Type'] = trimmed.startsWith('{') || trimmed.startsWith('[')
            ? 'application/json'
            : 'application/x-www-form-urlencoded';
        }
        submitInit.body = chain.submit.bodyText;
      } else if (chain.submit.bodyFormData) {
        const params = new URLSearchParams();
        for (const [k, vs] of Object.entries(chain.submit.bodyFormData)) {
          for (const v of vs) params.append(k, String(v));
        }
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
        submitInit.body = params.toString();
      }
      submitInit.headers = headers;

      const submitResp = await fetch(chain.submit.url, submitInit);
      if (!submitResp.ok) return { error: 'submit HTTP ' + submitResp.status };
      const submitData = await submitResp.json();

      // 2. 提取 task_id（递归搜常见字段名或形状像 task_id 的字符串）
      function findTaskId(obj: unknown): string | null {
        if (obj === null || obj === undefined) return null;
        if (typeof obj === 'string') {
          if (/^[0-9a-fA-F]{16,40}$/.test(obj)) return obj;
          return null;
        }
        if (typeof obj !== 'object') return null;
        const o = obj as Record<string, unknown>;
        for (const k of ['task_id', 'taskId', 'taskID', 'job_id', 'jobId', 'jobID', 'taskCode', 'request_id', 'requestId']) {
          const v = o[k];
          if (typeof v === 'string' && v.length > 0) return v;
        }
        for (const v of Object.values(o)) {
          const found = findTaskId(v);
          if (found) return found;
        }
        return null;
      }

      const taskId = findTaskId(submitData);
      if (!taskId) {
        return { error: 'no task_id in submit response: ' + JSON.stringify(submitData).slice(0, 240) };
      }

      // 3. 构建 poll URL：替换原 task_id 参数的值
      const pollUrlTemplate = chain.polls[0].url;
      let pollUrl: string;
      try {
        const u = new URL(pollUrlTemplate);
        // 通常 task_id 在 query string，找到第一个 task_id-like 参数替换
        for (const key of ['task_id', 'taskId', 'taskID', 'job_id', 'jobId']) {
          if (u.searchParams.has(key)) {
            u.searchParams.set(key, taskId);
            break;
          }
        }
        pollUrl = u.toString();
      } catch {
        // fallback: 用 regex 替换
        pollUrl = pollUrlTemplate.replace(/task_id=[^&]+/i, 'task_id=' + taskId);
      }

      // 4. poll until 出现可下载 URL
      function findDownloadableUrl(obj: unknown): string | null {
        if (obj === null || obj === undefined) return null;
        if (typeof obj === 'string') {
          if (/^https?:\/\//.test(obj) && /\.(xlsx?|csv|pdf|zip|docx?)(\?|$)/i.test(obj)) return obj;
          return null;
        }
        if (typeof obj !== 'object') return null;
        const o = obj as Record<string, unknown>;
        for (const k of ['url', 'download_url', 'downloadUrl', 'file_url', 'fileUrl', 'data_url', 'dataUrl', 'href']) {
          const v = o[k];
          if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
        }
        for (const v of Object.values(o)) {
          const found = findDownloadableUrl(v);
          if (found) return found;
        }
        return null;
      }

      const maxAttempts = 60;
      const pollIntervalMs = 1500;
      let finalUrl: string | null = null;
      let lastPollSnippet = '';
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        let pollResp: Response;
        try {
          pollResp = await fetch(pollUrl, { credentials: 'include' });
        } catch (e) {
          // 网络瞬时错误，继续重试
          lastPollSnippet = 'fetch err: ' + (e as Error).message;
          continue;
        }
        if (!pollResp.ok) {
          lastPollSnippet = 'HTTP ' + pollResp.status;
          continue;
        }
        let pollData: unknown;
        try {
          pollData = await pollResp.json();
        } catch {
          lastPollSnippet = 'non-JSON response';
          continue;
        }
        const url = findDownloadableUrl(pollData);
        if (url) {
          finalUrl = url;
          break;
        }
        lastPollSnippet = JSON.stringify(pollData).slice(0, 160);
      }

      if (!finalUrl) {
        return { error: 'poll timed out after ' + maxAttempts + ' attempts (last: ' + lastPollSnippet + ')' };
      }

      // 5. 拉最终文件
      const fileResp = await fetch(finalUrl, { credentials: 'include' });
      if (!fileResp.ok) return { error: 'final fetch HTTP ' + fileResp.status };
      const blob = await fileResp.blob();
      if (blob.size === 0) return { error: 'final blob empty' };
      return { base64: await blobToB64(blob) };
    } catch (e) {
      return { error: 'in-tab replay exception: ' + ((e as Error)?.message || String(e)) };
    }
  })();
}
