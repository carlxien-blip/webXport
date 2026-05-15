// 录制期间挂 chrome.webRequest 监听器，抓当前 tab 的 outgoing 请求 + 响应元数据。
// 录制停止时按 chrome.downloads.onCreated 事件锚点，回推每个下载的 API 调用链路。
//
// Phase 1b：
//   - 噪音过滤（字节系 / 小红书 telemetry / APM / 通用 tracker）
//   - 链路推断：识别"提交任务 → 轮询 → 最终下载"三段式 + 单步 GET 直返
//   - 输出 ApiChain 结构，供 Phase 1c 持久化、Phase 3 重放

console.log('[api-capture] module loaded — v0.2 phase 1b');

export interface CapturedRequest {
  requestId: string;
  url: string;
  method: string;
  type: chrome.webRequest.ResourceType;
  /** Date.now() 时间戳 */
  startedAt: number;
  bodyText?: string;
  bodyFormData?: Record<string, string[]>;
  requestHeaders?: chrome.webRequest.HttpHeader[];
  responseStatus?: number;
  responseContentType?: string;
  responseContentLength?: number;
}

export interface ApiChain {
  /** 关联的 chrome.downloads.onCreated item.id */
  downloadId: number;
  downloadFilename: string;
  /** 多段链路：提交任务的 POST */
  submit?: CapturedRequest;
  /** 多段链路：轮询任务状态的 GET 们 */
  polls: CapturedRequest[];
  /** 实际拿到文件的请求 */
  final: CapturedRequest;
  confidence: 'high' | 'medium' | 'low';
  /** 检测推理过程，给用户和 debug 看 */
  reasons: string[];
}

/** key = tabId */
const capturedByTab = new Map<number, Map<string, CapturedRequest>>();
const downloadsByTab = new Map<number, Array<{ id: number; filename: string; at: number }>>();
let listenersInstalled = false;

export function startCapture(tabId: number): void {
  ensureListeners();
  capturedByTab.set(tabId, new Map());
  downloadsByTab.set(tabId, []);
  console.log('[api-capture] start tab=', tabId);
}

export function stopCapture(tabId: number): { requests: CapturedRequest[]; chains: ApiChain[] } {
  const buf = capturedByTab.get(tabId);
  const downloads = downloadsByTab.get(tabId) ?? [];
  capturedByTab.delete(tabId);
  downloadsByTab.delete(tabId);

  if (!buf) return { requests: [], chains: [] };

  const requests = Array.from(buf.values()).sort((a, b) => a.startedAt - b.startedAt);
  const interesting = requests.filter(isInteresting);

  console.log(
    '[api-capture] stop tab=', tabId,
    'total=', requests.length,
    'noise=', requests.length - interesting.length,
    'interesting=', interesting.length,
    'downloads=', downloads.length
  );

  // 对每个下载事件，回推链路
  const chains: ApiChain[] = [];
  for (const d of downloads) {
    const windowReqs = interesting.filter(r => r.startedAt <= d.at && r.startedAt > d.at - 30_000);
    const chain = detectChain(d, windowReqs);
    if (chain) chains.push(chain);
  }

  // 漂亮地打印
  logChains(chains);

  return { requests, chains };
}

export function isCapturing(tabId: number): boolean {
  return capturedByTab.has(tabId);
}

// ─────────────────────────────────────────────────────────────────────
// 监听器
// ─────────────────────────────────────────────────────────────────────

function ensureListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ['<all_urls>'] }, ['requestBody']);
  chrome.webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls: ['<all_urls>'] }, ['requestHeaders']);
  chrome.webRequest.onResponseStarted.addListener(onResponseStarted, { urls: ['<all_urls>'] }, ['responseHeaders']);
  chrome.downloads.onCreated.addListener(onDownloadCreated);
  console.log('[api-capture] listeners installed');
}

function onBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): void {
  const buf = capturedByTab.get(details.tabId);
  if (!buf) return;
  if (!isMaybeRelevantType(details.type)) return;
  if (isNoise(details.url)) return; // 早过滤，省内存

  const req: CapturedRequest = {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    startedAt: Date.now(),
  };

  if (details.requestBody) {
    if (details.requestBody.raw) {
      try {
        const decoder = new TextDecoder('utf-8');
        req.bodyText = details.requestBody.raw
          .map(chunk => (chunk.bytes ? decoder.decode(chunk.bytes) : ''))
          .join('');
      } catch {
        // binary body, skip
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
  for (const [, list] of downloadsByTab) {
    list.push({ id: item.id, filename: item.filename || '?', at: Date.now() });
  }
}

// ─────────────────────────────────────────────────────────────────────
// 噪音过滤
// ─────────────────────────────────────────────────────────────────────

/** 早期硬剔：这些域名/路径完全不进 buffer */
function isNoise(url: string): boolean {
  for (const re of NOISE_URL_PATTERNS) if (re.test(url)) return true;
  try {
    const u = new URL(url);
    for (const re of NOISE_DOMAIN_PATTERNS) if (re.test(u.hostname)) return true;
    for (const re of NOISE_PATH_PATTERNS) if (re.test(u.pathname)) return true;
  } catch {
    // bad URL, treat as noise
    return true;
  }
  return false;
}

/** 内容类型 + 噪音过滤的综合判断 */
function isInteresting(r: CapturedRequest): boolean {
  if (!r.responseStatus) return false; // 没收到响应不算
  if (isNoise(r.url)) return false;

  const ct = (r.responseContentType ?? '').toLowerCase();
  if (!ct) return true;
  if (ct.startsWith('text/html')) return false;
  if (ct.startsWith('text/css')) return false;
  if (ct.includes('javascript')) return false;
  if (ct.startsWith('image/')) return false;
  if (ct.startsWith('font/')) return false;
  if (ct.startsWith('audio/')) return false;
  if (ct.startsWith('video/')) return false;
  return true;
}

function isMaybeRelevantType(t: chrome.webRequest.ResourceType): boolean {
  return t === 'xmlhttprequest' || t === 'other';
}

// 黑名单（按需扩充）
const NOISE_DOMAIN_PATTERNS = [
  /^tracker\./i,
  /^apm[-.]?fe\./i,
  /^apm\./i,
  /^mon\./i,
  /^mcs\./i,
  /tracker$/i,
  /telemetry/i,
  /sentry/i,
  /^lf3-config\./i,
  /-config\.bytetcc\./i,
  /^spider-tracker\./i,
];

const NOISE_PATH_PATTERNS = [
  /^\/track(\/|$)/i,
  /^\/collect(\/|$)/i,
  /^\/event(\/|$)/i,
  /^\/pixel(\/|$)/i,
  /^\/beacon(\/|$)/i,
  /^\/monitor_browser(\/|$)/i,
];

const NOISE_URL_PATTERNS = [
  /mcs\.zijieapi\.com\/list/i,
  /mon\.zijieapi\.com\/monitor_browser/i,
  /lf3-config\.bytetcc\.com/i,
  /apm-fe\.xiaohongshu\.com/i,
  /apm\.xiaohongshu\.com/i,
  /spider-tracker\.xiaohongshu\.com/i,
];

// ─────────────────────────────────────────────────────────────────────
// 链路推断
// ─────────────────────────────────────────────────────────────────────

const BINARY_CT_PATTERNS = [
  /application\/octet-stream/i,
  /application\/vnd\.openxmlformats/i,
  /application\/vnd\.ms-excel/i,
  /application\/zip/i,
  /application\/x-zip/i,
  /application\/pdf/i,
  /text\/csv/i,
];

/** URL 看着像最终下载（即使响应 content-type 不老实） */
const FINAL_URL_HINTS = [
  /\.(xlsx?|csv|pdf|zip|docx?)(\?|$)/i,
  /download[_-]?file/i,
  /export[_-]?(file|data|report)/i,
  /generate[_-]?report/i,
];

/** URL 看着像 submit / start task */
const SUBMIT_URL_PATTERNS = [
  /\/(submit|start|create|export|generate|trigger)(\/|$|\?)/i,
  /\/task\/?(submit|start|create)?$/i,
];

/** URL 看着像 poll / status check */
const POLL_URL_PATTERNS = [
  /task[_-]?id=/i,
  /\/task\/(detail|status|progress|result)/i,
  /\/(status|progress|result)(\/|$|\?)/i,
];

function detectChain(
  download: { id: number; filename: string; at: number },
  reqs: CapturedRequest[]
): ApiChain | null {
  if (reqs.length === 0) return null;

  // 1. 找 final：最后一个看着像 binary download 的请求
  const finals = reqs.filter(isLikelyFinal);
  if (finals.length === 0) {
    console.warn(
      '[api-capture] download #' + download.id + ' (' + download.filename + ')',
      '— no plausible final request found in window'
    );
    return null;
  }
  const final = finals[finals.length - 1];
  const reasons: string[] = [];
  reasons.push(`final: ${final.method} ${shortUrl(final.url)} [${final.responseContentType ?? '?'}]`);

  // 2. 找 polls：final 之前的 GET，URL 含 task_id 或 status/detail pattern
  const polls = reqs
    .filter(r => r.requestId !== final.requestId)
    .filter(r => r.startedAt < final.startedAt)
    .filter(r => r.method === 'GET')
    .filter(r => POLL_URL_PATTERNS.some(p => p.test(r.url)))
    .sort((a, b) => a.startedAt - b.startedAt);

  if (polls.length > 0) {
    reasons.push(`polls: ${polls.length} GET(s) matching task_id/status pattern`);
  }

  // 3. 找 submit：在最早的 poll（或 final）之前的 POST，URL 含 submit/start/create
  const submitDeadline = polls.length > 0 ? polls[0].startedAt : final.startedAt;
  const submit = reqs
    .filter(r => r.requestId !== final.requestId)
    .filter(r => r.startedAt < submitDeadline)
    .filter(r => r.method === 'POST')
    .filter(r => SUBMIT_URL_PATTERNS.some(p => p.test(r.url)))
    .sort((a, b) => b.startedAt - a.startedAt)[0];

  if (submit) {
    reasons.push(`submit: POST ${shortUrl(submit.url)}`);
  }

  // 4. 信心评分
  let confidence: 'high' | 'medium' | 'low';
  if (submit && polls.length > 0) confidence = 'high'; // 完整三段
  else if (!submit && polls.length === 0) confidence = 'medium'; // 单步直返
  else if (polls.length > 0 && !submit) confidence = 'medium'; // 有 poll 没识别 submit
  else confidence = 'low';

  return {
    downloadId: download.id,
    downloadFilename: download.filename,
    submit,
    polls,
    final,
    confidence,
    reasons,
  };
}

function isLikelyFinal(r: CapturedRequest): boolean {
  if (r.responseStatus !== 200) return false;
  const ct = (r.responseContentType ?? '').toLowerCase();
  if (BINARY_CT_PATTERNS.some(p => p.test(ct))) return true;
  if (FINAL_URL_HINTS.some(p => p.test(r.url))) return true;
  return false;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const qs = u.search.length > 60 ? u.search.slice(0, 60) + '...' : u.search;
    return u.host + u.pathname + qs;
  } catch {
    return url.slice(0, 100);
  }
}

function logChains(chains: ApiChain[]): void {
  if (chains.length === 0) {
    console.log('[api-capture] no chains detected this session');
    return;
  }
  console.log(`[api-capture] detected ${chains.length} export chain(s):`);
  for (const c of chains) {
    console.log(
      `  📦 download #${c.downloadId} "${c.downloadFilename}" — confidence: ${c.confidence}`
    );
    if (c.submit) {
      console.log(`     ① submit: ${c.submit.method} ${shortUrl(c.submit.url)}`);
      const bodyPreview = c.submit.bodyText?.slice(0, 120) || JSON.stringify(c.submit.bodyFormData)?.slice(0, 120);
      if (bodyPreview) console.log(`        body: ${bodyPreview}`);
    }
    for (let i = 0; i < c.polls.length; i++) {
      console.log(`     ${c.polls.length > 1 ? '②.' + (i + 1) : '②'} poll: GET ${shortUrl(c.polls[i].url)}`);
    }
    console.log(`     ③ final: ${c.final.method} ${shortUrl(c.final.url)} [${c.final.responseContentType ?? '?'}]`);
    if (c.reasons.length) console.log(`     reasons: ${c.reasons.join(' | ')}`);
  }
}
