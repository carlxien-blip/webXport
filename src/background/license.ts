import { verifyLicense, type LicensePayload } from '../shared/license';

const KEY = 'webxport.license';
const TRIAL_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface StoredLicense {
  /** 首次启动时记下，14 天试用从这里算 */
  trialStartedAt: number | null;
  /** 用户粘贴的付费 license 原文（验过签的） */
  paidLicense: string | null;
}

export type LicenseStatus =
  | { kind: 'trial'; daysLeft: number; expiresAt: number }
  | { kind: 'trial-expired'; trialEndedAt: number }
  | { kind: 'paid'; email: string; daysLeft: number; expiresAt: number }
  | { kind: 'paid-expired'; email: string; expiredAt: number };

export async function getLicenseStatus(): Promise<LicenseStatus> {
  const stored = await readStored();
  const now = Date.now();

  if (stored.paidLicense) {
    const result = await verifyLicense(stored.paidLicense);
    if (result.ok) {
      const { email, expiresAt } = result.payload;
      if (now < expiresAt) {
        return { kind: 'paid', email, daysLeft: ceilDays(expiresAt - now), expiresAt };
      }
      return { kind: 'paid-expired', email, expiredAt: expiresAt };
    }
    // 验签失败的 license 当作没有，但保留它在 storage 里直到用户清除——便于排查
  }

  // 没有有效付费 license → 看试用
  let trialStartedAt = stored.trialStartedAt;
  if (trialStartedAt === null) {
    trialStartedAt = now;
    await writeStored({ ...stored, trialStartedAt });
  }
  const trialEndsAt = trialStartedAt + TRIAL_DAYS * MS_PER_DAY;
  if (now < trialEndsAt) {
    return { kind: 'trial', daysLeft: ceilDays(trialEndsAt - now), expiresAt: trialEndsAt };
  }
  return { kind: 'trial-expired', trialEndedAt: trialEndsAt };
}

export async function applyLicense(license: string): Promise<{ ok: true; payload: LicensePayload } | { ok: false; reason: string }> {
  const result = await verifyLicense(license);
  if (!result.ok) {
    const msg =
      result.reason === 'malformed' ? 'license 格式不对' :
      result.reason === 'bad-signature' ? 'license 签名校验失败（可能是手抄错了，或者不是给你的）' :
      'license payload 解析失败';
    return { ok: false, reason: msg };
  }
  if (Date.now() >= result.payload.expiresAt) {
    return { ok: false, reason: 'license 已过期' };
  }
  const stored = await readStored();
  await writeStored({ ...stored, paidLicense: license.trim() });
  return { ok: true, payload: result.payload };
}

export async function clearPaidLicense(): Promise<void> {
  const stored = await readStored();
  await writeStored({ ...stored, paidLicense: null });
}

/** MCP gate. 试用 / 付费有效都允许；试用过期且无付费时拒绝。 */
export async function isMcpAllowed(): Promise<boolean> {
  const status = await getLicenseStatus();
  return status.kind === 'trial' || status.kind === 'paid';
}

async function readStored(): Promise<StoredLicense> {
  const out = await chrome.storage.local.get(KEY);
  const stored = out[KEY] as Partial<StoredLicense> | undefined;
  return {
    trialStartedAt: stored?.trialStartedAt ?? null,
    paidLicense: stored?.paidLicense ?? null,
  };
}

async function writeStored(s: StoredLicense): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

function ceilDays(ms: number): number {
  return Math.max(0, Math.ceil(ms / MS_PER_DAY));
}
