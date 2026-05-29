import { readFileSync } from "fs";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  env: {
    APP_VERSION: pkg.version,
  },
  // dev watcher가 런타임 쓰기 디렉토리(data/, workspaces/)를 감시하면
  // SQLite WAL/로그 파일 변경마다 Fast Refresh가 무한 rebuilding 됨 → watch 제외.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/data/**',
          '**/workspaces/**',
        ],
      }
    }
    return config
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // X-XSS-Protection 제거: 레거시 헤더이며 OAuth 콜백 HTML의 인라인 스크립트를
          // 일부 브라우저에서 차단할 수 있음. 현대 브라우저는 자체 XSS 보호 사용.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default withNextIntl(nextConfig);
