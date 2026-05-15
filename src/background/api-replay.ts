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
  console.log('[api-replay] replayApiChain enter tab=', tabId, 'chain has submit/polls/final:', !!chain.submit, chain.polls.length, !!chain.final);
  try {
    console.log('[api-replay] calling chrome.scripting.executeScript (ISOLATED world)...');
    // ISOLATED：默认世界，有 chrome.* API，对 fetch+credentials 足够。
    // MAIN 留给后续需要调用页面 sign 函数（抖店 a_bogus）时再切。
    const injection = await chrome.scripting.executeScript({
      target: { tabId },
      func: inTabReplay,
      args: [chain],
    });
    console.log('[api-replay] executeScript returned, frames:', injection.length);

    if (injection.length === 0) {
      return { ok: false, error: 'executeScript returned 0 frames' };
    }
    const first = injection[0];
    const result = first.result as { base64?: string; error?: string; debug?: string[] } | undefined;
    if (result?.debug?.length) {
      console.log('[api-replay] in-tab debug breadcrumbs:');
      for (const line of result.debug) console.log('   →', line);
    }
    if (!result) return { ok: false, error: 'executeScript returned no result' };
    if (result.error) return { ok: false, error: result.error };
    if (!result.base64) return { ok: false, error: 'no base64 in result' };

    console.log('[api-replay] got base64 length=', result.base64.length);
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

function inTabReplay(chain: ApiChain): Promise<{ base64?: string; error?: string; debug?: string[] }> {
  return (async () => {
    const debug: string[] = [];
    debug.push('entered ISOLATED world, chain has submit=' + !!chain.submit + ', polls=' + chain.polls.length + ', final=' + !!chain.final);
    // 重置 abort 标志（每次 replay 重新开始）
    (window as unknown as { __webxport_api_abort?: boolean }).__webxport_api_abort = false;

    function isAborted(): boolean {
      return !!(window as unknown as { __webxport_api_abort?: boolean }).__webxport_api_abort;
    }

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

      // 浏览器自管的 header（这些 fetch 会拒绝/覆盖；不要重放）
      const SKIP_HEADERS = new Set([
        'cookie', 'user-agent', 'accept-encoding', 'host', 'connection',
        'content-length', 'origin', 'referer', 'accept-language',
        'transfer-encoding', 'expect', 'te', 'trailer', 'upgrade',
      ]);

      function buildHeaders(req: { requestHeaders?: Array<{ name: string; value?: string }> }, fallback?: Record<string, string>): Record<string, string> {
        // 把录制时捕获的所有 application headers 带过来——除了浏览器管控的
        const out: Record<string, string> = { ...(fallback ?? {}) };
        if (!req.requestHeaders) return out;
        for (const h of req.requestHeaders) {
          const name = h.name.toLowerCase();
          if (SKIP_HEADERS.has(name)) continue;
          if (name.startsWith('sec-')) continue;   // Sec-Fetch-*, Sec-CH-* by Chrome
          if (name.startsWith(':')) continue;       // HTTP/2 pseudo-headers
          if (h.value === undefined) continue;
          out[h.name] = h.value;
        }
        return out;
      }

      // ── 单步：直接 fetch final ──
      if (!chain.submit && chain.polls.length === 0) {
        debug.push('single-step branch');
        const final = chain.final;
        debug.push('fetching final: ' + final.method + ' ' + final.url.slice(0, 100));
        const resp = await fetch(final.url, {
          method: final.method,
          credentials: 'include',
          headers: buildHeaders(final),
        });
        debug.push('final HTTP ' + resp.status);
        if (!resp.ok) return { error: 'final ' + final.method + ' HTTP ' + resp.status, debug };
        const blob = await resp.blob();
        debug.push('blob size=' + blob.size);
        if (blob.size === 0) return { error: 'final returned empty blob', debug };
        const b64 = await blobToB64(blob);
        debug.push('base64 length=' + b64.length);
        return { base64: b64, debug };
      }

      // ── 多步：submit → poll → final ──
      debug.push('multi-step branch');
      if (!chain.submit) return { error: 'multi-step chain missing submit', debug };
      if (chain.polls.length === 0) return { error: 'multi-step chain missing poll URL template', debug };

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

      debug.push('submit: ' + chain.submit.method + ' ' + chain.submit.url.slice(0, 80));
      const submitResp = await fetch(chain.submit.url, submitInit);
      debug.push('submit HTTP ' + submitResp.status);
      if (!submitResp.ok) return { error: 'submit HTTP ' + submitResp.status, debug };
      const submitData = await submitResp.json();
      debug.push('submit body: ' + JSON.stringify(submitData).slice(0, 200));

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
        return { error: 'no task_id in submit response: ' + JSON.stringify(submitData).slice(0, 240), debug };
      }
      debug.push('task_id=' + taskId);

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

      const maxAttempts = 40;
      const pollIntervalMs = 1500;
      const maxConsecutive4xx = 5; // 连续 5 个 4xx 直接放弃，不傻等
      const pollHeaders = buildHeaders(chain.polls[0]);
      let finalUrl: string | null = null;
      let lastPollSnippet = '';
      let consecutive4xx = 0;
      for (let i = 0; i < maxAttempts; i++) {
        if (isAborted()) return { error: 'aborted by user', debug };
        await new Promise(r => setTimeout(r, pollIntervalMs));
        if (isAborted()) return { error: 'aborted by user', debug };
        let pollResp: Response;
        try {
          pollResp = await fetch(pollUrl, { credentials: 'include', headers: pollHeaders });
        } catch (e) {
          lastPollSnippet = 'fetch err: ' + (e as Error).message;
          continue;
        }
        if (pollResp.status >= 400 && pollResp.status < 500) {
          consecutive4xx++;
          lastPollSnippet = 'HTTP ' + pollResp.status;
          if (consecutive4xx >= maxConsecutive4xx) {
            return { error: 'poll auth failed (' + consecutive4xx + ' consecutive ' + pollResp.status + 's)', debug };
          }
          continue;
        }
        consecutive4xx = 0;
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
          debug.push('poll #' + (i + 1) + ' got url');
          break;
        }
        lastPollSnippet = JSON.stringify(pollData).slice(0, 160);
      }

      if (!finalUrl) {
        return { error: 'poll exhausted (last: ' + lastPollSnippet + ')', debug };
      }
      debug.push('finalUrl: ' + finalUrl.slice(0, 100));

      // 5. 拉最终文件。CDN（COS / OSS）签名 URL 不需要 cookie 鉴权，强行带 credentials 可能触发 CORS 阻断
      if (isAborted()) return { error: 'aborted by user', debug };
      const isCdn = /\.(cos|oss|s3|cloudfront|qcloud|amazonaws|cdn)\./i.test(new URL(finalUrl).host);
      const finalHeaders = isCdn ? {} : buildHeaders(chain.final);
      const fileResp = await fetch(finalUrl, {
        credentials: isCdn ? 'omit' : 'include',
        headers: finalHeaders,
      });
      debug.push('final HTTP ' + fileResp.status + ' (cred=' + (isCdn ? 'omit' : 'include') + ')');
      if (!fileResp.ok) return { error: 'final fetch HTTP ' + fileResp.status, debug };
      const blob = await fileResp.blob();
      debug.push('blob size=' + blob.size);
      if (blob.size === 0) return { error: 'final blob empty', debug };
      const b64 = await blobToB64(blob);
      debug.push('base64 length=' + b64.length);
      return { base64: b64, debug };
    } catch (e) {
      return { error: 'in-tab replay exception: ' + ((e as Error)?.message || String(e)), debug };
    }
  })();
}
