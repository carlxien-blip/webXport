#!/usr/bin/env node
// 本地生成一段 webXport license（HMAC 签名，离线校验）。
//
// Usage:
//   npm run gen-license -- <email> [days=365]
//
// 例：
//   npm run gen-license -- carl@example.com 365
//
// license 字符串打印到 stdout，发码摘要打印到 stderr。把 license 微信发给用户即可。

import { signLicense } from './license.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    process.stderr.write('Usage: gen-license <email> [days=365]\n');
    process.stderr.write('  例：gen-license carl@example.com 365\n');
    process.exit(1);
  }
  const email = args[0];
  const days = args[1] ? Number(args[1]) : 365;
  if (!Number.isFinite(days) || days <= 0) {
    process.stderr.write(`bad days: ${args[1]}\n`);
    process.exit(1);
  }

  const now = Date.now();
  const expiresAt = now + days * 24 * 60 * 60 * 1000;
  const license = await signLicense({ email, tier: 'paid', issuedAt: now, expiresAt });

  const expiryDate = new Date(expiresAt).toISOString().slice(0, 10);
  process.stderr.write(`✓ ${email}  →  ${expiryDate}（${days} 天）\n\n`);
  process.stdout.write(license + '\n');
}

main().catch((e) => {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exit(1);
});
