import type { NextConfig } from 'next';
import path from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(process.cwd(), '../..');
const require = createRequire(import.meta.url);
const { version } = require('./package.json') as { version: string };

/**
 * Panel tarayıcıda açılır ve çocuk verisi gösterir; API helmet ile sertleşmişken
 * panel çıplak kalıyordu. En kritik eksik `frame-ancestors`'tı: operatörün açık
 * oturumu, görünmez bir iframe içine alınıp tıklamaları çalınabiliyordu.
 *
 * CSP bilerek dar tutulmadı; Next satır içi runtime script'i ve Tailwind satır
 * içi stil ürettiği için `unsafe-inline` gerekiyor. Buradaki kazanç
 * çerçeveleme, form hedefi ve karışık içerik kapılarıdır — nonce'lu tam CSP
 * ayrı bir iştir.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Panel API'ye kendi /api proxy'si üzerinden gider; Supabase Auth doğrudan.
  "connect-src 'self' https://*.supabase.co",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@servisapp/contracts'],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Sürüm ve altyapı parmak izi vermeye gerek yok.
  poweredByHeader: false,
  // Sunucu, minimum sürümün altındaki istemciyi 426 ile geri çevirir. Panel
  // sabit '99.0.0' gönderdiği sürece bu kapı paneli hiç tutmuyordu: uyumsuz
  // bir panel sekmesi, en yıkıcı yetkilere sahip istemci olmasına rağmen
  // çalışmaya devam ediyordu.
  env: { NEXT_PUBLIC_ADMIN_VERSION: version },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
