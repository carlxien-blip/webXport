// 录制期间挂 chrome.webRequest 监听器，抓当前 tab 的 outgoing 请求 + 响应元数据。
// 关联 chrome.downloads.onCreated 找出"导出 API"是哪一个。
//
// Phase 1a：只捕获 + 日志输出到 SW console，不持久化、不重放。验证基本路径。

export interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  type: chrome.webRequest.ResourceType;
  /** Date.now() 时间戳，方便和 downloads.onCreated 关联 */
  startedAt: number;
  bodyText?: string;
  bodyFormData?: Record<string, string[]>;
  requestHeaders?: chrome.webRequest.HttpHeader[];
  responseStatus?: number;
  responseContentType?: string;
  responseContentLength?: number;
}

/** key = tabId, value = recordingId → request map */
const capturedByTab = new Map<number, Map<string, CapturedRequest>>();
let listenersInstalled = false;

export function startCapture(tabId: number): void {
  ensureListeners();
  capturedByTab.set(tabId, new Map());
  console.log('[api-capture] start tab=', tabId);
}

export function stopCapture(tabId: number): CapturedRequest[] {
  const buf = capturedByTab.get(tabId);
  capturedByTab.delete(tabId);
  if (!buf) return [];
  const list = Array.from(buf.values()).sort((a, b) => a.startedAt - b.startedAt);
  console.log('[api-capture] stop tab=', tabId, 'total=', list.length, 'interesting=', list.filter(isInteresting).length);
  logInterestingList(list);
  return list;
}

export function isCapturing(tabId: number): boolean {
  return capturedByTab.has(tabId);
}

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  chrome.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    { urls: ['<all_urls>'] },
    ['requestBody']
  );

  chrome.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeaders,
    { urls: ['<all_urls>'] },
    ['requestHeaders']
  );

  chrome.webRequest.onResponseStarted.addListener(
    onResponseStarted,
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  chrome.downloads.onCreated.addListener(onDownloadCreated);

  console.log('[api-capture] listeners installed');
}

function onBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
  const buf = capturedByTab.get(details.tabId);
  if (!buf) return;
  if (!isMaybeRelevantType(details.type)) return;

  const req: CapturedRequest = {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    startedAt: Date.now(),
  };

  // requestBody 解析（raw bytes / formData）
  if (details.requestBody) {
    if (details.requestBody.raw) {
      try {
        const decoder = new TextDecoder('utf-8');
        req.bodyText = details.requestBody.raw
          .map(chunk => (chunk.bytes ? decoder.decode(chunk.bytes) : ''))
          .join('');
      } catch (e) {
        // binary body, skip text decode
      }
    }
    if (details.requestBody.formData) {
      req.bodyFormData = details.requestBody.formData;
    }
  }

  buf.set(details.requestId, req);
}

function onBeforeSendHeaders(details: chrome.webRequest.WebRequestHeadersDetails): void {
  const buf = capturedByTab.get(details.tabId);
  if (!buf) return;
  const req = buf.get(details.requestId);
  if (req && details.requestHeaders) {
    req.requestHeaders = details.requestHeaders;
  }
}

function onResponseStarted(details: chrome.webRequest.WebResponseCacheDetails): void {
  const buf = capturedByTab.get(details.tabId);
  if (!buf) return;
  const req = buf.get(details.requestId);
  if (!req) return;

  req.responseStatus = details.statusCode;
  if (details.responseHeaders) {
    const ct = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value;
    const cl = details.responseHeaders.find(h => h.name.toLowerCase() === 'content-length')?.value;
    if (ct) req.responseContentType = ct;
    if (cl) req.responseContentLength = parseInt(cl, 10);
  }
}

function onDownloadCreated(item: chrome.downloads.DownloadItem): void {
  // 找正在录制的 tab。理论上 download.tabId 不可靠（有时为 -1），所以遍历所有 capturing tabs
  // 找时间窗内最可能的 candidate
  for (const [tabId, buf] of capturedByTab) {
    void tabId; // 暂时不区分，所有 capturing tab 一起看
    const recent = Array.from(buf.values())
      .filter(r => Date.now() - r.startedAt < 15_000)
      .filter(isInteresting)
      .sort((a, b) => b.startedAt - a.startedAt);

    if (recent.length === 0) continue;

    console.log(`[api-capture] download #${item.id} (${item.filename || '?'}) — top API candidates:`);
    for (const r of recent.slice(0, 3)) {
      const bodyPreview = r.bodyText ? r.bodyText.slice(0, 80) : (r.bodyFormData ? JSON.stringify(r.bodyFormData).slice(0, 80) : '');
      console.log(
        '   ', r.method.padEnd(5), r.url,
        '\n     ', r.responseStatus, r.responseContentType ?? '(no ct)', r.responseContentLength ? `${r.responseContentLength}B` : '',
        bodyPreview ? `\n      body: ${bodyPreview}` : ''
      );
    }
  }
}

function isMaybeRelevantType(t: chrome.webRequest.ResourceType): boolean {
  return t === 'xmlhttprequest' || t === 'other';
}

function isInteresting(r: CapturedRequest): boolean {
  // 通过响应内容类型过滤掉显然不是 API 的
  if (!r.responseContentType) return r.responseStatus !== undefined; // 已完成但无 ct，可疑保留
  const ct = r.responseContentType.toLowerCase();
  if (ct.startsWith('text/html')) return false;
  if (ct.startsWith('text/css')) return false;
  if (ct.includes('javascript')) return false;
  if (ct.startsWith('image/')) return false;
  if (ct.startsWith('font/')) return false;
  if (ct.startsWith('audio/')) return false;
  if (ct.startsWith('video/')) return false;
  // 保留：application/json, application/octet-stream, text/csv, application/vnd.ms-excel, etc
  return true;
}

function logInterestingList(list: CapturedRequest[]): void {
  const interesting = list.filter(isInteresting);
  if (interesting.length === 0) {
    console.log('[api-capture] (no interesting requests this session)');
    return;
  }
  console.log('[api-capture] interesting requests this session:');
  for (const r of interesting) {
    console.log('   ', r.method.padEnd(5), r.url.slice(0, 140), r.responseContentType ?? '');
  }
}
