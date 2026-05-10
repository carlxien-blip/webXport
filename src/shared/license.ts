// HMAC-SHA256 签名的 license。格式：base64url(payload).base64url(signature)
//
// payload 是 base64url 编码的 JSON：{ email, tier, issuedAt, expiresAt }
//
// SECRET 硬编码 —— Stage 0 接受的风险。攻击者拿到 bundle 能反编译出 secret 伪造 license。
// 用户量 / 收入达到合理水平后切换到后端签发 + 公钥验签。文档：docs/p2-plan.md
//
// 这个文件 MUST 与 mcp-server/src/license.ts 内容完全一致（相同算法、相同 SECRET）。

export const LICENSE_SECRET =
  'wxp_v1_4f7a9c8b2e1d3f6c5a8e7b4d9c1f2a3b8e7d6c5f4a9b2e1d3f8c7a6b5e4d9c2f';

export type LicenseTier = 'paid';

export interface LicensePayload {
  email: string;
  tier: LicenseTier;
  issuedAt: number;
  expiresAt: number;
}

export async function signLicense(
  payload: LicensePayload,
  secret: string = LICENSE_SECRET
): Promise<string> {
  const payloadB64 = encodePayload(payload);
  const sig = await hmacSha256(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'malformed-payload' };

export async function verifyLicense(
  license: string,
  secret: string = LICENSE_SECRET
): Promise<VerifyResult> {
  const trimmed = license.trim();
  const dot = trimmed.indexOf('.');
  if (dot < 1 || dot === trimmed.length - 1) return { ok: false, reason: 'malformed' };

  const payloadB64 = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  const expectedSig = await hmacSha256(payloadB64, secret);
  if (!constantTimeEquals(expectedSig, sig)) return { ok: false, reason: 'bad-signature' };

  try {
    const payload = decodePayload(payloadB64);
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'malformed-payload' };
  }
}

function encodePayload(p: LicensePayload): string {
  const json = JSON.stringify(p);
  return base64UrlEncode(new TextEncoder().encode(json));
}

function decodePayload(b64: string): LicensePayload {
  const json = new TextDecoder().decode(base64UrlDecode(b64));
  const obj = JSON.parse(json) as LicensePayload;
  if (
    typeof obj.email !== 'string' ||
    typeof obj.tier !== 'string' ||
    typeof obj.issuedAt !== 'number' ||
    typeof obj.expiresAt !== 'number'
  ) {
    throw new Error('payload shape mismatch');
  }
  return obj;
}

async function hmacSha256(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
