import type { NextConfig } from 'next';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@servisapp/contracts'],
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
