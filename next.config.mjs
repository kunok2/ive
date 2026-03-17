import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  env: {
    APP_VERSION: pkg.version,
  },
};

export default nextConfig;
