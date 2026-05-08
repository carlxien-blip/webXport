import type { SelectorBundle } from './types';

const STABLE_ATTR_NAMES = ['name', 'role', 'aria-label', 'title', 'placeholder', 'type', 'href'];
const RANDOM_HASH_RE = /^[a-z]*[-_]?[a-z0-9]{6,}$/i;

// data-* prefixes used by tracking / framework runtime — values change per
// session or per render and must NOT be encoded into selectors.
const UNSTABLE_DATA_PREFIXES = [
  'data-spm-',     // Alibaba SPM tracking (taobao / sycm / 1688 / cainiao etc.)
  'data-track-',
  'data-tracker-',
  'data-trace-',
  'data-monitor-',
  'data-react-',   // React internal markers
  'data-reactid',
  'data-v-',       // Vue scoped CSS
  'data-aurelia-',
  'data-ng-',
];

function isUnstableDataAttr(name: string): boolean {
  return UNSTABLE_DATA_PREFIXES.some((p) => name.startsWith(p));
}

export function buildSelectorBundle(el: Element): SelectorBundle {
  return {
    css: buildCssPath(el),
    xpath: buildXPath(el),
    textContent: extractText(el),
    tagName: el.tagName.toLowerCase(),
    attributes: collectAttrs(el),
  };
}

export function findElement(bundle: SelectorBundle): Element | null {
  const byCss = tryCss(bundle);
  if (byCss) return byCss;

  const byXPath = tryXPath(bundle.xpath);
  if (byXPath) return byXPath;

  return tryByTextAndAttrs(bundle);
}

function tryCss(bundle: SelectorBundle): Element | null {
  const exact = querySelectorBest(bundle.css, bundle.textContent);
  if (exact) return exact;

  // Fallback for recordings made before unstable-attr filtering: strip any
  // [data-*="..."] segment and try again. Tracking attributes (data-spm-*)
  // were the most common cause of CSS misses on Alibaba-ecosystem sites.
  const stripped = bundle.css.replace(/\[data-[\w-]+="[^"]*"\]/g, '');
  if (stripped !== bundle.css && stripped.trim().length > 0) {
    return querySelectorBest(stripped, bundle.textContent);
  }
  return null;
}

function querySelectorBest(css: string, textContent: string | null): Element | null {
  try {
    const matches = document.querySelectorAll(css);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1 && textContent) {
      for (const el of Array.from(matches)) {
        if (extractText(el) === textContent) return el;
      }
    }
  } catch {}
  return null;
}

function tryXPath(xpath: string): Element | null {
  try {
    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue as Element | null;
  } catch {
    return null;
  }
}

function tryByTextAndAttrs(bundle: SelectorBundle): Element | null {
  const candidates = document.querySelectorAll(bundle.tagName);
  let best: { el: Element; score: number } | null = null;

  for (const el of Array.from(candidates)) {
    const score = scoreCandidate(el, bundle);
    if (score > 0 && (!best || score > best.score)) {
      best = { el, score };
    }
  }
  return best?.el ?? null;
}

function scoreCandidate(el: Element, bundle: SelectorBundle): number {
  let score = 0;
  if (bundle.textContent && extractText(el) === bundle.textContent) score += 5;
  for (const [k, v] of Object.entries(bundle.attributes)) {
    if (el.getAttribute(k) === v) score += 2;
  }
  return score;
}

function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let curr: Element | null = el;

  while (curr && curr !== document.body && curr.nodeType === Node.ELEMENT_NODE) {
    const piece = describeElement(curr);
    parts.unshift(piece);
    const path = parts.join(' > ');
    try {
      if (document.querySelectorAll(path).length === 1) return path;
    } catch {}
    curr = curr.parentElement;
  }
  return parts.join(' > ');
}

function describeElement(el: Element): string {
  if (el.id && /^[a-zA-Z_][\w-]*$/.test(el.id) && !RANDOM_HASH_RE.test(el.id)) {
    return `#${CSS.escape(el.id)}`;
  }

  let s = el.tagName.toLowerCase();

  const stableClasses = Array.from(el.classList)
    .filter(c => /^[a-z][a-z0-9_-]*$/i.test(c) && !RANDOM_HASH_RE.test(c) && c.length < 30)
    .slice(0, 2);
  if (stableClasses.length > 0) {
    s += '.' + stableClasses.map(c => CSS.escape(c)).join('.');
  }

  for (const attr of Array.from(el.attributes)) {
    if (
      attr.name.startsWith('data-') &&
      !isUnstableDataAttr(attr.name) &&
      attr.value &&
      attr.value.length < 40
    ) {
      s += `[${attr.name}="${attr.value.replaceAll('"', '\\"')}"]`;
      break;
    }
  }
  return s;
}

function buildXPath(el: Element): string {
  if (el.id && /^[a-zA-Z_][\w-]*$/.test(el.id)) {
    return `//*[@id="${el.id}"]`;
  }
  const parts: string[] = [];
  let curr: Element | null = el;
  while (curr && curr.nodeType === Node.ELEMENT_NODE && curr.parentElement) {
    let nth = 1;
    let sib = curr.previousElementSibling;
    while (sib) {
      if (sib.tagName === curr.tagName) nth++;
      sib = sib.previousElementSibling;
    }
    parts.unshift(`${curr.tagName.toLowerCase()}[${nth}]`);
    curr = curr.parentElement;
    if (curr === document.body) {
      parts.unshift('body');
      break;
    }
  }
  return '//' + parts.join('/');
}

function collectAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of STABLE_ATTR_NAMES) {
    const v = el.getAttribute(a);
    if (v) out[a] = v;
  }
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('data-') && !isUnstableDataAttr(a.name) && a.value) {
      out[a.name] = a.value;
    }
  }
  return out;
}

export function extractText(el: Element): string | null {
  const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return null;
  return t.slice(0, 100);
}
